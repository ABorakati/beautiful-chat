/** Private Paseo settings. The plugin SDK does not expose this record. */
export interface HostAppSettings {
  uiFontFamily?: unknown;
  monoFontFamily?: unknown;
  codeFontSize?: unknown;
  chatDisplay?: unknown;
  toolCallDetailLevel?: unknown;
  compactToolCalls?: unknown;
}

export function readHostAppSettings(): HostAppSettings {
  try {
    // Native clients lack localStorage and keep the plugin's font defaults.
    const store = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    const raw = store?.getItem("@paseo:app-settings");
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as HostAppSettings) : {};
  } catch {
    return {};
  }
}

export function hostFoldsToolCalls(): boolean {
  const settings = readHostAppSettings();
  if (settings.chatDisplay !== undefined) {
    return settings.chatDisplay === "collapseToolCalls" || settings.chatDisplay === "collapseTurns";
  }
  const level = settings.toolCallDetailLevel;
  if (level === "overview" || level === "concise") return true;
  return level === undefined && settings.compactToolCalls === true;
}

export function observeHostToolFolding(check: () => void): () => void {
  try {
    if (!(globalThis as typeof globalThis & { localStorage?: Storage }).localStorage) return () => {};
  } catch {
    return () => {};
  }

  // ponytail: Polls can lag by 2 s. Use a supported SDK settings API when one exists.
  const interval = setInterval(check, 2_000);
  const hostWindow = typeof window === "undefined" ? undefined : window;
  const hostDocument = typeof document === "undefined" ? undefined : document;
  hostWindow?.addEventListener("focus", check);
  hostDocument?.addEventListener("visibilitychange", check);
  return () => {
    clearInterval(interval);
    hostWindow?.removeEventListener("focus", check);
    hostDocument?.removeEventListener("visibilitychange", check);
  };
}
