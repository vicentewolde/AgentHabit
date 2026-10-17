import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { contentSecurityPolicy } from "./src/csp.js";

/**
 * Production builds get a restrictive Content-Security-Policy as a `<meta>` tag, built from the
 * API origin that `VITE_API_URL` names, plus a `_headers` file with the same policy and the
 * directives a `<meta>` cannot carry (`frame-ancestors`). The dev server gets neither: Vite's
 * hot reload needs inline scripts and styles.
 */
function securityHeaders(apiUrl: string): Plugin {
  const policy = contentSecurityPolicy(apiUrl);
  return {
    name: "agenthabit-security-headers",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: policy.meta },
        injectTo: "head-prepend",
      },
    ],
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: [
          "/*",
          `  Content-Security-Policy: ${policy.header}`,
          "  X-Content-Type-Options: nosniff",
          "  Referrer-Policy: no-referrer",
          "  X-Frame-Options: DENY",
          "",
        ].join("\n"),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), tailwindcss(), securityHeaders(env.VITE_API_URL ?? "http://localhost:3000")],
    // The web origin is part of what the wallet signs and of Strava's redirect (STRAVA_REDIRECT_URI),
    // so a busy port must fail loudly instead of moving to another one.
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { outDir: "dist/site", sourcemap: false },
  };
});
