import { useCallback, useSyncExternalStore } from "react";

/**
 * The newest plugin item for each agent.
 *
 * The host gives a renderer no row position. Each item reports its timestamp,
 * and the newest item owns the tail. Separate tails keep cards in each chat.
 */
interface Tail {
  key: string;
  at: number;
}

const tails = new Map<string, Tail>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Records an arrival. A later arrival owns the tail. Ties keep the current item. */
export function noteTimelineItem(agentId: string, key: string, at: number): void {
  const tail = tails.get(agentId);
  if (tail && (at < tail.at || (at === tail.at && key !== tail.key))) return;
  if (tail && tail.key === key && tail.at === at) return;
  tails.set(agentId, { key, at });
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while this item is the newest plugin item for `agentId`. */
export function useIsTimelineTail(agentId: string, key: string): boolean {
  const getSnapshot = useCallback(() => tails.get(agentId)?.key === key, [agentId, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
