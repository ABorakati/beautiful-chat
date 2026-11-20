import { Linking, Platform } from "react-native";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { isExternalLink } from "./markdown/link-target";

/**
 * Opens an external link (`http:`, `https:`, `mailto:`) the way the host does.
 *
 * Order of preference:
 *
 * 1. For `http:`/`https:`, `@getpaseo/plugin/client`'s `openExternalUrl` when
 *    provided by the Paseo >=0.16 host (hands URLs to the OS browser cleanly
 *    on Desktop and mobile).
 * 2. On Electron web, the desktop bridge (`window.paseoDesktop.opener.openUrl`).
 * 3. On plain web, `window.open` with `noopener,noreferrer`.
 * 4. On native, `Linking.openURL`.
 *
 * The scheme allowlist mirrors the host's: a link in a model's reply is
 * untrusted input, and `javascript:`, `data:`, or `file:` must never reach a
 * browser navigation sink.
 */
interface DesktopOpener {
  opener?: { openUrl?: (url: string) => unknown };
}

/** Use the same scheme check for the opener and web anchors. */
export function isAllowedLink(url: string): boolean {
  return isExternalLink(url);
}

function fallbackOpenLink(url: string): void {
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

export function openLink(url: string): void {
  if (!isAllowedLink(url)) return;

  if (/^https?:/i.test(url) && typeof openExternalUrl === "function") {
    try {
      void Promise.resolve(openExternalUrl(url)).catch(() => {
        fallbackOpenLink(url);
      });
      return;
    } catch {
      // Fall through to the direct opener below.
    }
  }

  fallbackOpenLink(url);
}
