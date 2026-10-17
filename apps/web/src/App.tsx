import { useState } from "react";
import { useApp } from "./app-context.js";
import { Layout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { LinkPanel } from "./pages/LinkPanel.js";
import { Rules } from "./pages/Rules.js";
import { StravaCallback, type StravaReturn } from "./pages/StravaCallback.js";
import { useRoute } from "./router.js";

/**
 * `returned` is what Strava put in the URL, already read and stripped from the address bar by
 * `main.tsx` before the first render (it must be read exactly once).
 */
export function App(props: { readonly returned?: StravaReturn }) {
  const { route, navigate } = useRoute();
  const { session } = useApp();
  const [returned] = useState<StravaReturn>(props.returned ?? { kind: "invalid" });

  return (
    <Layout route={route} navigate={navigate}>
      {route === "rules" && <Rules />}
      {route === "stravaCallback" && <StravaCallback returned={returned} navigate={navigate} />}
      {route === "home" && (session === null ? <LinkPanel /> : <Dashboard />)}
    </Layout>
  );
}
