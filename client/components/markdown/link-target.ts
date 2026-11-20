/**
 * Pure classification and normalization for markdown link destinations.
 *
 * Separates safe external URLs (`http:`, `https:`, `mailto:`), local file
 * paths (including `file://` URLs), and unsafe/unsupported schemes
 * (`javascript:`, `data:`, `vbscript:`, `blob:`, etc.).
 */

const ALLOWED_EXTERNAL = new Set(["http:", "https:", "mailto:"]);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const FILE_URL_PREFIX = /^file:\/\//i;
const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\[^\\]+[\\/][^\\/]+/;
const LINE_HASH_SELECTOR = /^#L\d+(?:-L?\d+)?$/;
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const RELATIVE_OR_HOME = /^(?:\.\.?[\\/]|~[\\/]).+/;
const BARE_FILENAME_WITH_EXT = /^[^:/\\?#]+\.[A-Za-z0-9]{1,10}(?:#L\d+(?:-L?\d+)?)?$/;

export type MarkdownLinkTarget =
  | { kind: "external"; url: string }
  | { kind: "file"; path: string }
  | { kind: "unsafe" };

/** True for the external schemes a plugin link is allowed to open. */
export function isExternalLink(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || CONTROL_CHARS.test(trimmed)) return false;
  try {
    return ALLOWED_EXTERNAL.has(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * Converts a `file://` URL into a local filesystem path, percent-decoding
 * escapes, stripping the extra leading slash on Windows drive paths
 * (`/C:/...` -> `C:/...`), and preserving `#L10-L20` line selectors.
 */
export function normalizeFileUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || CONTROL_CHARS.test(trimmed) || !FILE_URL_PREFIX.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "file:") return null;
    const decoded = decodeURIComponent(url.pathname);
    if (!decoded || decoded === "/") return null;
    let path: string;
    if (url.hostname && url.hostname.toLowerCase() !== "localhost") {
      path = `//${url.hostname}${decoded}`;
    } else {
      path = /^\/[a-zA-Z]:\//.test(decoded) ? decoded.slice(1) : decoded;
    }
    if (LINE_HASH_SELECTOR.test(url.hash)) {
      path += url.hash;
    }
    return path;
  } catch {
    return null;
  }
}

/**
 * Classifies a markdown link's `href` into a safe external URL, a normalized
 * local file path, or `unsafe` (which must neither navigate nor trigger file
 * actions).
 */
export function classifyMarkdownLink(href: string): MarkdownLinkTarget {
  const trimmed = href.trim();
  if (!trimmed || CONTROL_CHARS.test(trimmed)) return { kind: "unsafe" };

  if (isExternalLink(trimmed)) {
    return { kind: "external", url: trimmed };
  }

  if (FILE_URL_PREFIX.test(trimmed)) {
    const path = normalizeFileUrl(trimmed);
    return path ? { kind: "file", path } : { kind: "unsafe" };
  }

  // Windows drive paths (`C:\foo` or `C:/foo`) start with `<letter>:` and must
  // be recognised before rejecting generic URI schemes.
  if (WINDOWS_DRIVE_PATH.test(trimmed) || WINDOWS_UNC_PATH.test(trimmed)) {
    return { kind: "file", path: trimmed };
  }

  // Reject all other URI schemes (`javascript:`, `data:`, `vbscript:`, `blob:`,
  // `ftp:`, `about:`, etc.).
  if (URI_SCHEME.test(trimmed)) {
    return { kind: "unsafe" };
  }

  // Reject protocol-relative URLs, fragment-only anchors, and query-only refs.
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("?")) {
    return { kind: "unsafe" };
  }

  // Rooted POSIX path (`/tmp/guide.md`), explicit relative/home (`./README.md`,
  // `../docs/a.md`, `~/notes.md`), multi-segment relative (`docs/guide.md`),
  // or a bare filename with an extension (`README.md`).
  if (
    (trimmed.startsWith("/") && trimmed.length > 1) ||
    RELATIVE_OR_HOME.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    BARE_FILENAME_WITH_EXT.test(trimmed)
  ) {
    return { kind: "file", path: trimmed };
  }

  return { kind: "unsafe" };
}
