import { Linking, Platform } from "react-native";

/**
 * Opens an http(s) link the way the host does.
 *
 * Three sinks, in the host's own order of preference
 * (`app/src/utils/open-external-url.ts`):
 *
 * 1. On Electron the desktop bridge (`window.paseoDesktop.opener.openUrl`,
 *    read in `desktop/electron/host.ts:7`) hands the URL to the OS browser.
 *    Without it a link opens inside the app window, which has no chrome to
 *    navigate back from.
 * 2. On plain web, `window.open` with `noopener,noreferrer`.
 * 3. On native, `Linking.openURL`.
 *
 * The scheme allowlist mirrors the host's: a link in a model's reply is
 * untrusted input, and `javascript:` or `file:` must never reach a sink.
 */
const ALLOWED = new Set(["http:", "https:", "mailto:"]);

interface DesktopOpener {
  opener?: { openUrl?: (url: string) => unknown };
}

/** Use the same scheme check for the opener and web anchors. */
export function isAllowedLink(url: string): boolean {
  try {
    return ALLOWED.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function openLink(url: string): void {
  if (!isAllowedLink(url)) return;

  if (Platform.OS === "web") {
    const bridge = (globalThis as { paseoDesktop?: DesktopOpener }).paseoDesktop;
    const openUrl = bridge?.opener?.openUrl;
    if (typeof openUrl === "function") {
      void openUrl(url);
      return;
    }
    globalThis.open?.(url, "_blank", "noopener,noreferrer");
    return;
  }

  void Linking.openURL(url).catch(() => {
    // No handler for the scheme on this device; nothing useful to show.
  });
}

/**
 * The local path a `file://` URL names, or null. Parsed by hand, not with
 * `URL`, because React Native's `URL` does not implement `pathname`. A host
 * other than `localhost` is a UNC share.
 */
export function fileUrlToPath(href: string): string | null {
  const match = /^file:\/\/([^/?#]*)([^?#]*)/i.exec(href.trim());
  if (match === null) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[2] || "/");
  } catch {
    return null;
  }
  const host = match[1] ?? "";
  if (host && host.toLowerCase() !== "localhost") return `//${host}${path}`;
  return /^\/[a-zA-Z]:\//.test(path) ? path.slice(1) : path;
}

const SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

/**
 * The local path a markdown link points at, or null when the target is a web
 * URL, a heading anchor or any other scheme. `file://` URLs, absolute, home
 * and relative paths count; `javascript:`, `data:` and the like never do, so a
 * press on them stays with `openLink`, which drops them. A `#L12` selector is
 * kept for the daemon to strip; any other fragment is a heading, not a file.
 */
export function localPathFromHref(href: string): string | null {
  const target = href.trim();
  if (/^file:/i.test(target)) return fileUrlToPath(target);
  // A Windows drive reads like a one-letter scheme, so test it first.
  const drive = /^[a-zA-Z]:[\\/]/.test(target);
  if (!drive && SCHEME.test(target)) return null;
  // `//host/x` is a scheme-relative web URL in markdown.
  if (target === "" || /^[#?]/.test(target) || target.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(target)) return null;
  const hash = target.indexOf("#");
  let path = hash >= 0 && !/#L\d+(?:-L?\d+)?$/.test(target) ? target.slice(0, hash) : target;
  path = path.replace(/\?.*$/, "");
  try {
    path = decodeURI(path);
  } catch {
    // A stray `%` is part of the name.
  }
  return path === "" ? null : path;
}
