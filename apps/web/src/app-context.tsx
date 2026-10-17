import { AgentHabitError, type VerifyResponse } from "@agenthabit/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ApiClient, createApiClient } from "./api/client.js";
import { linkWallet } from "./flows.js";
import { clearSession, loadSession, saveSession } from "./session.js";
import type { WalletPort } from "./wallet/port.js";

export interface AppDeps {
  readonly baseUrl: string;
  readonly wallet: WalletPort;
  /** Injected for tests; defaults to the browser's `fetch`. */
  readonly fetch?: typeof fetch;
  /** Sends the browser to another site (Strava's authorization page). */
  readonly redirect: (url: string) => void;
}

interface AppState {
  readonly api: ApiClient;
  readonly wallet: WalletPort;
  readonly redirect: (url: string) => void;
  readonly session: VerifyResponse | null;
  /** The session ended by itself (a 401), as opposed to the user never having linked. */
  readonly sessionLost: boolean;
  readonly link: () => Promise<void>;
  readonly logout: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider(props: { readonly deps: AppDeps; readonly children: ReactNode }) {
  const { deps } = props;
  const [session, setSession] = useState<VerifyResponse | null>(() => loadSession());
  const [sessionLost, setSessionLost] = useState(false);
  // The API client reads the token through a ref so it never holds a stale session.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const dropSession = useCallback((lost: boolean) => {
    clearSession();
    sessionRef.current = null;
    setSession(null);
    setSessionLost(lost);
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: deps.baseUrl,
        fetch: deps.fetch,
        getToken: () => sessionRef.current?.sessionToken ?? null,
        onUnauthorized: () => {
          if (sessionRef.current !== null) dropSession(true);
        },
      }),
    [deps.baseUrl, deps.fetch, dropSession],
  );

  const link = useCallback(async () => {
    const opened = await linkWallet({ api, wallet: deps.wallet });
    saveSession(opened);
    sessionRef.current = opened;
    setSession(opened);
    setSessionLost(false);
  }, [api, deps.wallet]);

  const value = useMemo<AppState>(
    () => ({
      api,
      wallet: deps.wallet,
      redirect: deps.redirect,
      session,
      sessionLost,
      link,
      logout: () => dropSession(false),
    }),
    [api, deps.wallet, deps.redirect, session, sessionLost, link, dropSession],
  );

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (value === null) {
    throw new AgentHabitError("ConfigError", "useApp must be used inside AppProvider");
  }
  return value;
}
