import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CIRCLE_FAUCET_URL } from "../api/messages.js";

export function Card(props: {
  readonly title: string;
  readonly headingId: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={props.headingId}
      className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm"
    >
      <h2 id={props.headingId} className="mb-3 text-lg font-semibold text-slate-900">
        {props.title}
      </h2>
      <div className="space-y-3 text-slate-800">{props.children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "danger";
};

const VARIANTS = {
  primary: "bg-emerald-800 text-white hover:bg-emerald-900 disabled:bg-slate-400",
  secondary:
    "border border-slate-400 bg-white text-slate-900 hover:bg-slate-100 disabled:text-slate-500",
  danger: "bg-red-800 text-white hover:bg-red-900 disabled:bg-slate-400",
} as const;

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 font-medium disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

/** A message the reader should notice. Errors interrupt (`alert`); the rest wait (`status`). */
export function Notice(props: {
  readonly tone: "info" | "success" | "error" | "warning";
  readonly children: ReactNode;
}) {
  const tones = {
    info: "border-blue-300 bg-blue-50 text-blue-950",
    success: "border-emerald-400 bg-emerald-50 text-emerald-950",
    error: "border-red-400 bg-red-50 text-red-950",
    warning: "border-amber-400 bg-amber-50 text-amber-950",
  } as const;
  return (
    <div
      role={props.tone === "error" ? "alert" : "status"}
      className={`rounded-lg border p-3 text-sm ${tones[props.tone]}`}
    >
      {props.children}
    </div>
  );
}

/** The link next to "you need test USDC" messages. */
export function FaucetLink() {
  return (
    <a
      href={CIRCLE_FAUCET_URL}
      target="_blank"
      rel="noreferrer noopener"
      className="ml-1 font-medium text-blue-800 underline"
    >
      Abrir el faucet de Circle
    </a>
  );
}

export function Loading(props: { readonly label: string }) {
  return (
    <p role="status" className="py-6 text-center text-slate-700">
      {props.label}
    </p>
  );
}

/** A link to a transaction in the block explorer, or nothing if the template looks unsafe. */
export function ExplorerLink(props: { readonly template: string; readonly hash: string }) {
  const url = explorerUrl(props.template, props.hash);
  if (url === null) return <span className="break-all font-mono text-xs">{props.hash}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-blue-800 underline"
    >
      Ver la transacción en el explorador
    </a>
  );
}

export function explorerUrl(template: string, hash: string): string | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) return null;
  const url = template.replace("{hash}", hash);
  return url.startsWith("https://") || url.startsWith("http://") ? url : null;
}
