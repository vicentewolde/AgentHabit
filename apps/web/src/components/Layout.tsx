import type { ReactNode } from "react";
import { useApp } from "../app-context.js";
import { NavLink, type Route } from "../router.js";
import { Button } from "./ui.js";

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-5)}` : address;
}

export function Layout(props: {
  readonly route: Route;
  readonly navigate: (path: string) => void;
  readonly children: ReactNode;
}) {
  const { session, logout } = useApp();
  const link = (current: boolean) =>
    `rounded px-2 py-1 font-medium underline-offset-4 hover:underline ${current ? "text-emerald-900 underline" : "text-slate-800"}`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2"
      >
        Saltar al contenido
      </a>
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <NavLink to="/" navigate={props.navigate} className="text-xl font-bold text-emerald-900">
            AgentHabit
          </NavLink>
          <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
            <NavLink
              to="/"
              navigate={props.navigate}
              current={props.route === "home"}
              className={link(props.route === "home")}
            >
              Mi semana
            </NavLink>
            <NavLink
              to="/reglas"
              navigate={props.navigate}
              current={props.route === "rules"}
              className={link(props.route === "rules")}
            >
              Reglas y privacidad
            </NavLink>
          </nav>
          {session !== null && (
            <div className="flex items-center gap-2 text-sm">
              <span title={session.address} className="font-mono text-slate-700">
                {shortAddress(session.address)}
              </span>
              <Button variant="secondary" className="min-h-9 px-3 py-1" onClick={logout}>
                Cerrar sesión
              </Button>
            </div>
          )}
        </div>
      </header>
      <main id="contenido" className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        {props.children}
      </main>
      <footer className="mx-auto max-w-2xl px-4 pb-8 text-sm text-slate-700">
        Versión de prueba en la red de pruebas de Stellar, con USDC de prueba. No es dinero real.
      </footer>
    </div>
  );
}
