/**
 * Client-side router — Phase 3.
 *
 * Its real job is negative: it must never let the browser load a document.
 * A document load takes the WebGL context with it, and with it the sand, the
 * focus pull, and the continuity §10 is built on. Everything below — the click
 * interception, the History API calls, the popstate handling — exists to keep
 * navigation inside one document.
 *
 * That is also why this is hand-written rather than pulled from a package. The
 * requirement is not "match URLs to views", which is twenty lines; it is
 * "match URLs to views without ever remounting the canvas", and that is a
 * property of how the swap is done, not of the matching.
 */

export type RouteMode = "full" | "focus";

export interface RouteMatch {
  route: RouteDef;
  params: Record<string, string>;
  path: string;
}

export interface RouteDef {
  /** Pattern with `:name` segments, e.g. `/work/:slug`. */
  path: string;
  mode: RouteMode;
  /** Document title. Prerendered, so it matters for search results. */
  title: (params: Record<string, string>) => string;
  description: (params: Record<string, string>) => string;
  /** Inner HTML for the app container. Must contain exactly one `<h1>`. */
  render: (params: Record<string, string>) => string;
  /** Rejects a syntactically valid match, e.g. an unknown project slug. */
  valid?: (params: Record<string, string>) => boolean;
}

export interface RouterOptions {
  routes: RouteDef[];
  notFound: RouteDef;
  container: HTMLElement;
  /** Fired after the DOM is swapped. Drives the focus pull. */
  onNavigate?: (to: RouteMatch, from: RouteMatch | null) => void;
}

interface Compiled {
  def: RouteDef;
  re: RegExp;
  keys: string[];
}

function compile(path: string): Omit<Compiled, "def"> {
  const keys: string[] = [];
  const source = path
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      if (!seg.startsWith(":")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      keys.push(seg.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { re: new RegExp(`^/${source}/?$`), keys };
}

export class Router {
  private readonly compiled: Compiled[];
  private readonly opts: RouterOptions;
  private current: RouteMatch | null = null;
  /** Scroll offset per history entry, so Back returns you where you were. */
  private scrollMemory = new Map<string, number>();
  private live: HTMLElement;

  constructor(opts: RouterOptions) {
    this.opts = opts;
    this.compiled = opts.routes.map((def) => ({ def, ...compile(def.path) }));

    // §12 wants route changes announced. One live region, created once and
    // reused: screen readers only announce mutations to a region that was
    // already in the accessibility tree, so creating it per navigation would
    // silently announce nothing.
    this.live = document.createElement("div");
    this.live.setAttribute("aria-live", "polite");
    this.live.setAttribute("aria-atomic", "true");
    this.live.className = "visually-hidden";
    document.body.appendChild(this.live);

    document.addEventListener("click", this.onClick);
    addEventListener("popstate", this.onPopState);
  }

  get match(): RouteMatch | null {
    return this.current;
  }

  resolve(pathname: string): RouteMatch {
    for (const { def, re, keys } of this.compiled) {
      const m = re.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? "")));
      if (def.valid && !def.valid(params)) continue;
      return { route: def, params, path: pathname };
    }
    return { route: this.opts.notFound, params: {}, path: pathname };
  }

  /** Renders whatever the address bar already says. Used once, at boot. */
  start(): void {
    this.commit(this.resolve(location.pathname), { restoreScroll: true });
  }

  navigate(to: string, opts: { replace?: boolean } = {}): void {
    const url = new URL(to, location.href);
    if (url.pathname === location.pathname && !url.hash) return;
    this.rememberScroll();
    history[opts.replace ? "replaceState" : "pushState"]({}, "", url);
    this.commit(this.resolve(url.pathname), { restoreScroll: false });
  }

  private rememberScroll(): void {
    if (this.current) this.scrollMemory.set(this.current.path, scrollY);
  }

  private commit(next: RouteMatch, o: { restoreScroll: boolean }): void {
    const from = this.current;
    const { route, params } = next;

    this.opts.container.innerHTML = route.render(params);
    document.title = route.title(params);
    setMeta("description", route.description(params));
    document.documentElement.dataset.mode = route.mode;

    this.current = next;

    // Scroll before the focus move: focusing an element scrolls it into view,
    // and doing it in the other order fights itself.
    const remembered = o.restoreScroll ? 0 : this.scrollMemory.get(next.path);
    scrollTo({ top: remembered ?? 0, behavior: "instant" as ScrollBehavior });

    // §12: move focus to the heading so keyboard and screen-reader users land
    // on the new content instead of back at the top of the document with no
    // indication anything happened.
    const heading = this.opts.container.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      this.live.textContent = `${heading.textContent ?? route.title(params)} — page loaded`;
    }

    this.opts.onNavigate?.(next, from);
  }

  /**
   * Intercepts in-app links. The bail-outs matter as much as the interception:
   * a modified click is the user explicitly asking for a new tab or a download,
   * and swallowing that would be worse than a full page load.
   */
  private onClick = (e: MouseEvent): void => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const a = (e.target as Element | null)?.closest?.("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || a.hasAttribute("download") || a.target === "_blank") return;
    // Anything off-origin, and any explicit protocol like mailto: or tel:.
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    // A bare hash is in-page navigation; let the browser do it.
    if (url.pathname === location.pathname && url.hash) return;
    // Nothing claims it — let the browser 404 honestly rather than rendering
    // our not-found page at a URL the server does not know about.
    if (this.resolve(url.pathname).route === this.opts.notFound) return;

    e.preventDefault();
    this.navigate(url.href);
  };

  private onPopState = (): void => {
    // Back and forward are where a naive router reloads. Nothing here touches
    // location beyond reading it, so the document — and the canvas — survives.
    this.commit(this.resolve(location.pathname), { restoreScroll: false });
  };

  dispose(): void {
    document.removeEventListener("click", this.onClick);
    removeEventListener("popstate", this.onPopState);
    this.live.remove();
  }
}

function setMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}
