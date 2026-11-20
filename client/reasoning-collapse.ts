import { useSyncExternalStore } from "react";
import { hostAutoExpandReasoning } from "./host-settings";
import type { EnhancerPreferences } from "./preferences";

const listeners = new Set<() => void>();
let stopWatching: (() => void) | undefined;

function notify(): void {
  for (const listener of listeners) listener();
}

function watchHost(): () => void {
  const hostWindow = typeof window === "undefined" ? undefined : window;
  const hostDocument = typeof document === "undefined" ? undefined : document;
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === "@paseo:app-settings") notify();
  };
  hostWindow?.addEventListener?.("storage", onStorage);
  hostWindow?.addEventListener?.("focus", notify);
  hostDocument?.addEventListener?.("visibilitychange", notify);
  return () => {
    hostWindow?.removeEventListener?.("storage", onStorage);
    hostWindow?.removeEventListener?.("focus", notify);
    hostDocument?.removeEventListener?.("visibilitychange", notify);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopWatching) stopWatching = watchHost();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopWatching?.();
    stopWatching = undefined;
  };
}

/**
 * Tracks Paseo's `autoExpandReasoning` setting from `@paseo:app-settings`.
 * Returns `null` when unavailable (e.g. native clients without `localStorage`).
 */
export function useHostAutoExpandReasoning(): boolean | null {
  return useSyncExternalStore(subscribe, hostAutoExpandReasoning, hostAutoExpandReasoning);
}

/**
 * Whether a reasoning summary starts expanded.
 *
 * When `collapseReasoning` is disabled, every reasoning summary starts open.
 * When `collapseReasoning` is enabled (the default), reasoning starts collapsed
 * — including while streaming — unless Paseo's native `autoExpandReasoning`
 * setting is explicitly `true`.
 */
export function reasoningStartsExpanded(
  preferences: Pick<EnhancerPreferences, "collapseReasoning">,
  hostAutoExpand: boolean | null = hostAutoExpandReasoning(),
): boolean {
  if (!preferences.collapseReasoning) return true;
  return hostAutoExpand === true;
}
