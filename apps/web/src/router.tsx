import { type MouseEvent, type ReactNode, useCallback, useEffect, useState } from "react";

/**
 * A tiny router for three pages. Paths are plain: `/`, `/reglas`, `/strava/callback`. A static
 * host must answer every path with `index.html` (README).
 */

export type Route = "home" | "rules" | "stravaCallback";

export function routeFor(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/reglas") return "rules";
  if (path === "/strava/callback") return "stravaCallback";
  return "home";
}

export function useRoute(): { route: Route; navigate: (path: string) => void } {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setPathname(path);
    window.scrollTo?.(0, 0);
  }, []);

  return { route: routeFor(pathname), navigate };
}

export function NavLink(props: {
  readonly to: string;
  readonly navigate: (path: string) => void;
  readonly current?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    props.navigate(props.to);
  };
  return (
    <a
      href={props.to}
      onClick={onClick}
      aria-current={props.current ? "page" : undefined}
      className={props.className}
    >
      {props.children}
    </a>
  );
}
