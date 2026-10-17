// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { AppProvider } from "../src/app-context.js";
import { takeStravaReturn } from "../src/pages/StravaCallback.js";
import { BASE_URL, makeHarness } from "./helpers.js";

function mount(
  harness: ReturnType<typeof makeHarness>,
  redirect: (url: string) => void = () => undefined,
) {
  return render(
    <AppProvider
      deps={{
        baseUrl: BASE_URL,
        wallet: harness.wallet,
        fetch: harness.fetch,
        redirect,
        poll: { intervalMs: 1, timeoutMs: 20, sleep: async () => undefined },
      }}
    >
      <App returned={takeStravaReturn()} />
    </AppProvider>,
  );
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Conectar Freighter y vincular" }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("link and session", () => {
  it("links the wallet, keeps the token in sessionStorage only and never in the URL or logs", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "debug", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
    const harness = makeHarness({ scenario: "no-position" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);

    expect(await screen.findByRole("heading", { name: "Esta semana" })).toBeTruthy();
    const stored = JSON.parse(window.sessionStorage.getItem("agenthabit.session") ?? "{}");
    const token: string = stored.sessionToken;
    expect(token).toMatch(/^[0-9a-f]{48}$/);

    expect(window.location.href).not.toContain(token);
    expect(window.localStorage.length).toBe(0);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(token);
    expect(harness.requestedUrls.every((url) => !url.includes(token))).toBe(true);
    expect(logs.join("\n")).not.toContain(token);
    expect(document.body.textContent).not.toContain(token);
  });

  it("shows a Spanish message when the user cancels in the wallet", async () => {
    const harness = makeHarness();
    harness.wallet.rejectNext = true;
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    expect((await screen.findByRole("alert")).textContent).toContain("Cancelaste la solicitud");
    expect(window.sessionStorage.getItem("agenthabit.session")).toBeNull();
  });

  it("on a 401 clears the session and asks to link again", async () => {
    const harness = makeHarness({ scenario: "session-expired" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);

    const notice = await screen.findByText(/Tu sesión terminó/);
    expect(notice).toBeTruthy();
    expect(window.sessionStorage.getItem("agenthabit.session")).toBeNull();
    expect(screen.getByRole("button", { name: "Conectar Freighter y vincular" })).toBeTruthy();
  });
});

describe("commit", () => {
  it("shows the confirmation sentences before signing, then commits", async () => {
    const harness = makeHarness({ scenario: "no-position" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);

    await user.type(await screen.findByLabelText("Monto a bloquear (USDC)"), "25");
    await user.type(screen.getByLabelText("Meta de la semana (km)"), "15");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const confirmation = await screen.findByRole("region", { name: "Revisa antes de firmar" });
    const text = confirmation.textContent ?? "";
    expect(text).toContain("25 USDC");
    expect(text).toContain("15 km");
    expect(text).toContain("quedan bloqueados en el contrato para siempre");
    expect(text).toContain("nadie los cobra, ni AgentHabit ni otros usuarios");
    expect(text).toContain(
      "Revocar el acceso de AgentHabit a Strava cuenta como no cumplir la meta",
    );
    // Nothing was signed yet.
    expect(harness.wallet.signedXdrs).toHaveLength(0);

    await user.click(
      within(confirmation).getByRole("button", { name: "Entiendo, firmar y bloquear" }),
    );
    expect(await screen.findByText(/Listo: bloqueaste 25 USDC/)).toBeTruthy();
    expect(harness.wallet.signedXdrs).toHaveLength(1);
    expect(window.sessionStorage.getItem("agenthabit.pendingCommit")).toBeNull();
    // The week reloaded and now shows the committed position with its explorer link.
    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: "Ver la transacción en el explorador" }).length,
      ).toBeGreaterThan(0),
    );
  });

  it("refuses values outside the limits without opening the confirmation", async () => {
    const harness = makeHarness({ scenario: "no-position" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);

    await user.type(await screen.findByLabelText("Monto a bloquear (USDC)"), "19.99");
    await user.type(screen.getByLabelText("Meta de la semana (km)"), "100.001");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    const alerts = (await screen.findAllByRole("alert")).map((a) => a.textContent);
    expect(alerts).toContain("El monto debe estar entre 20 y 50 USDC.");
    expect(alerts).toContain("La meta debe estar entre 1 y 100 km.");
    expect(screen.queryByRole("region", { name: "Revisa antes de firmar" })).toBeNull();
  });

  it("explains a FAILED transaction and lets the user try again", async () => {
    const harness = makeHarness({ scenario: "tx-failed" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await user.type(await screen.findByLabelText("Monto a bloquear (USDC)"), "20");
    await user.type(screen.getByLabelText("Meta de la semana (km)"), "5");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Entiendo, firmar y bloquear" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no se bloqueó tu depósito");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeTruthy();
  });

  it("waits through PENDING by polling and then confirms the commit", async () => {
    const harness = makeHarness({ scenario: "tx-pending" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await user.type(await screen.findByLabelText("Monto a bloquear (USDC)"), "20");
    await user.type(screen.getByLabelText("Meta de la semana (km)"), "5");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Entiendo, firmar y bloquear" }));
    expect(await screen.findByText(/Listo: bloqueaste 20 USDC/)).toBeTruthy();
  });

  it("tells the user to refresh when the transaction stays PENDING after the polling", async () => {
    const harness = makeHarness({ scenario: "tx-stuck" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await user.type(await screen.findByLabelText("Monto a bloquear (USDC)"), "20");
    await user.type(screen.getByLabelText("Meta de la semana (km)"), "5");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Entiendo, firmar y bloquear" }));
    expect(
      await screen.findByText(/aún no se confirma. Actualiza la página en un minuto/),
    ).toBeTruthy();
  });

  it("blocks the form until Strava is connected", async () => {
    const harness = makeHarness({ scenario: "fresh" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    const button = await screen.findByRole("button", { name: "Continuar" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Primero conecta Strava/)).toBeTruthy();
  });
});

describe("contract refusals explain themselves", () => {
  async function commitUntilRefused(scenario: "no-usdc" | "no-trustline") {
    const harness = makeHarness({ scenario });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await user.type(await screen.findByLabelText("Monto a bloquear (USDC)"), "25");
    await user.type(screen.getByLabelText("Meta de la semana (km)"), "15");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Entiendo, firmar y bloquear" }));
    return screen.findByRole("alert");
  }

  it("says there is no USDC and links to the Circle faucet", async () => {
    const alert = await commitUntilRefused("no-usdc");
    expect(alert.textContent).toContain("No tienes suficiente USDC de prueba en esta wallet");
    const link = within(alert).getByRole("link", { name: "Abrir el faucet de Circle" });
    expect(link.getAttribute("href")).toBe("https://faucet.circle.com/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("says the wallet cannot hold USDC yet and links to the faucet", async () => {
    const alert = await commitUntilRefused("no-trustline");
    expect(alert.textContent).toContain("Tu wallet todavía no puede guardar USDC");
    expect(within(alert).getByRole("link", { name: "Abrir el faucet de Circle" })).toBeTruthy();
  });
});

describe("a commit that cannot be lost", () => {
  it("asks to confirm again, and signs nothing, when the week changed under the user", async () => {
    let clock = Date.now();
    const harness = makeHarness({ scenario: "no-position", now: () => new Date(clock) });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await user.type(await screen.findByLabelText("Monto a bloquear (USDC)"), "25");
    await user.type(screen.getByLabelText("Meta de la semana (km)"), "15");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("region", { name: "Revisa antes de firmar" });

    clock += 7 * 24 * 60 * 60 * 1000; // Monday 00:00 (UTC-3) passes while the user reads.
    await user.click(screen.getByRole("button", { name: "Entiendo, firmar y bloquear" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "La semana cambió mientras confirmabas. Revisa las fechas y confirma de nuevo.",
    );
    expect(harness.wallet.signedXdrs).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeTruthy();
  });

  it("shows a waiting transaction instead of the form, also after a reload", async () => {
    const harness = makeHarness({ scenario: "tx-stuck" });
    const user = userEvent.setup();
    const first = mount(harness);
    await signIn(user);
    await user.type(await screen.findByLabelText("Monto a bloquear (USDC)"), "20");
    await user.type(screen.getByLabelText("Meta de la semana (km)"), "5");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Entiendo, firmar y bloquear" }));
    await screen.findByText(/aún no se confirma/);
    first.unmount();

    mount(harness); // a fresh page load: the session is still in this tab
    expect(await screen.findByText(/Tienes una transacción en espera/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continuar" })).toBeNull();
  });
});

describe("week status", () => {
  it("shows km against the goal, days left and the explorer link for an active position", async () => {
    const harness = makeHarness({ scenario: "active" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);

    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("6300");
    expect(bar.getAttribute("aria-valuemax")).toBe("15000");
    expect(screen.getByText("6,3 de 15 km")).toBeTruthy();
    expect(screen.getByText(/Quedan \d días|Termina hoy/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver la transacción en el explorador" })).toBeTruthy();
  });

  it("says plainly when there is no position", async () => {
    const harness = makeHarness({ scenario: "no-position" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    expect(await screen.findByText(/No tienes un compromiso esta semana/)).toBeTruthy();
  });

  it("warns, without alarm, when the commit is on-chain but not registered", async () => {
    const harness = makeHarness({ scenario: "unregistered" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    const notice = await screen.findByText(/todavía no quedó registrado en AgentHabit/);
    expect(notice.textContent).toContain("Lo seguimos intentando");
    expect(screen.queryByRole("link", { name: "Ver la transacción en el explorador" })).toBeNull();
  });
});

describe("release button", () => {
  it("is hidden for an active week still inside its window", async () => {
    const harness = makeHarness({ scenario: "active" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await screen.findByRole("progressbar");
    expect(screen.queryByRole("button", { name: "Recuperar mi depósito" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Semanas anteriores sin liquidar" })).toBeNull();
  });

  it("says an earlier week waits for the oracle, with both dates, and has no button yet", async () => {
    const harness = makeHarness({ scenario: "waiting-settlement" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    expect(
      await screen.findByRole("heading", { name: "Semanas anteriores sin liquidar" }),
    ).toBeTruthy();
    const notice = await screen.findByText(/Esperando la liquidación del oráculo/);
    expect(notice.textContent).toContain("puede hacerla desde el");
    expect(notice.textContent).toContain("podrás recuperar tu depósito desde el");
    expect(screen.queryByRole("button", { name: "Recuperar mi depósito" })).toBeNull();
  });

  it("is shown for an earlier week once its release window has passed, and returns the deposit", async () => {
    const harness = makeHarness({ scenario: "expired" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "Recuperar mi depósito" }));
    expect(await screen.findByText(/Listo: tu depósito volvió a tu billetera/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Actualizar mi semana" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Recuperar mi depósito" })).toBeNull(),
    );
    // The week is settled now, so it left the unsettled list.
    expect(screen.queryByRole("heading", { name: "Semanas anteriores sin liquidar" })).toBeNull();
  });

  it("is hidden when there is no position", async () => {
    const harness = makeHarness({ scenario: "no-position" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await screen.findByText(/No tienes un compromiso esta semana/);
    expect(screen.queryByRole("button", { name: "Recuperar mi depósito" })).toBeNull();
  });
});

describe("Strava", () => {
  it("redirects to the URL the API returns", async () => {
    const harness = makeHarness({ scenario: "fresh" });
    const redirect = vi.fn();
    const user = userEvent.setup();
    mount(harness, redirect);
    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "Conectar Strava" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    expect(redirect.mock.calls[0]?.[0]).toMatch(/\/strava\/callback\?state=[0-9a-f]{32}/);
  });

  it("strips code, scope and state from the address bar and forwards them with the session", async () => {
    const harness = makeHarness({ scenario: "fresh" });
    const redirect = vi.fn();
    const user = userEvent.setup();
    const first = mount(harness, redirect);
    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "Conectar Strava" }));
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    const target = new URL(redirect.mock.calls[0]?.[0] as string);
    first.unmount();

    window.history.pushState(null, "", `/strava/callback${target.search}`);
    expect(window.location.search).toContain("code=");
    mount(harness);
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("mock-code");
    expect(await screen.findByText("Listo: Strava quedó conectado a tu billetera.")).toBeTruthy();
    expect(harness.requestedUrls.some((url) => url.includes("code="))).toBe(false);
  });

  it("asks to link again when the session is gone (A-19: the state belongs to the wallet)", async () => {
    const harness = makeHarness({ scenario: "fresh" });
    window.history.pushState(
      null,
      "",
      `/strava/callback?code=abc&scope=read,activity:read_all&state=${"a".repeat(32)}`,
    );
    mount(harness);
    expect(window.location.search).toBe("");
    expect((await screen.findByRole("status")).textContent).toContain(
      "Vincula tu billetera de nuevo",
    );
    expect(harness.requestedUrls.filter((url) => url.includes("/strava/callback"))).toHaveLength(0);
  });

  it("explains a refusal in Strava", async () => {
    const harness = makeHarness();
    window.history.pushState(null, "", "/strava/callback?error=access_denied&state=x");
    mount(harness);
    expect(await screen.findByText(/No diste permiso en Strava/)).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("warns that disconnecting counts as failing the week before doing it", async () => {
    const harness = makeHarness({ scenario: "no-position" });
    const user = userEvent.setup();
    mount(harness);
    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "Desconectar Strava" }));
    expect(screen.getByText(/cuenta como no cumplir la meta/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sí, desconectar Strava" }));
    expect(await screen.findByRole("button", { name: "Conectar Strava" })).toBeTruthy();
  });
});

describe("rules page", () => {
  it("covers every point the spec lists", async () => {
    window.history.pushState(null, "", "/reglas");
    mount(makeHarness());
    const text =
      (await screen.findByRole("heading", { name: "Reglas y privacidad" })).closest("div")
        ?.textContent ?? "";
    for (const piece of [
      "Nadie lo cobra",
      "Run",
      "TrailRun",
      "7 días como máximo",
      "no los ve nadie más",
      "no se escriben en la cadena",
      "es público por naturaleza",
      "explorador de transacciones",
      "UTC-3",
      "no liquida tu semana",
      "Revocar el acceso de AgentHabit a Strava cuenta como no cumplir",
    ]) {
      expect(text.toLowerCase(), piece).toContain(piece.toLowerCase());
    }
  });
});
