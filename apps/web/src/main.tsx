import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { AppProvider } from "./app-context.js";
import { apiBaseUrl } from "./env.js";
import { takeStravaReturn } from "./pages/StravaCallback.js";
import { routeFor } from "./router.js";
import { createFreighterWallet } from "./wallet/freighter.js";
import "./styles.css";

// Strava's answer is read, and removed from the address bar, before anything renders.
const returned =
  routeFor(window.location.pathname) === "stravaCallback" ? takeStravaReturn() : undefined;

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(
    <StrictMode>
      <AppProvider
        deps={{
          baseUrl: apiBaseUrl(),
          wallet: createFreighterWallet(),
          redirect: (url) => window.location.assign(url),
        }}
      >
        <App returned={returned} />
      </AppProvider>
    </StrictMode>,
  );
}
