/** Paseo's private storage record is not part of the plugin SDK. */
export interface HostAppSettings {
  uiFontFamily?: unknown;
  monoFontFamily?: unknown;
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
