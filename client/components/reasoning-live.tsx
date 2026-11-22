import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PaseoApi, PaseoAgentTimelineSubscription } from "@getpaseo/client";
import { useEnhancerPreferences } from "../preferences";

export interface ReasoningFeedEntry {
  kind: "user_message" | "reasoning";
  at: number;
  seq?: number;
  order: number;
  key?: string;
}

export interface ReasoningSnapshot {
  currentKeys: Set<string>;
  supersededKeys: Set<string>;
  knownKeys: Set<string>;
}

interface Feed {
  users: number;
  snapshot?: ReasoningSnapshot;
  stop: () => void;
}

const feeds = new Map<string, Feed>();
const listeners = new Set<() => void>();
const suppressionListeners = new Set<() => void>();
let superseded = new Set<string>();
let notifyQueued = false;

function subscribeReasoning(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeSupersededReasoning(listener: () => void): () => void {
  suppressionListeners.add(listener);
  return () => {
    suppressionListeners.delete(listener);
  };
}

/** Protects reasoning content that remains current in any turn of any observed agent. */
export function isSupersededReasoning(key: string): boolean {
  return superseded.has(key);
}

/** Normalizes reasoning text into a stable comparison key across host and feed items. */
export function reasoningKey(text: unknown): string {
  return typeof text === "string" ? text : "";
}

function compareEntries(a: ReasoningFeedEntry, b: ReasoningFeedEntry): number {
  if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  if (a.at !== b.at) return a.at - b.at;
  return a.order - b.order;
}

/**
 * Partitions observed timeline entries into turns separated by `user_message`
 * rows and keeps only the newest reasoning item in each turn as current.
 */
export function computeReasoningSnapshot(entries: Iterable<ReasoningFeedEntry>): ReasoningSnapshot {
  const ordered = [...entries].sort(compareEntries);
  const turns = new Map<number, string[]>();
  let turnIndex = 0;

  for (const entry of ordered) {
    if (entry.kind === "user_message") {
      turnIndex += 1;
      continue;
    }
    if (entry.key === undefined) continue;
    let list = turns.get(turnIndex);
    if (!list) {
      list = [];
      turns.set(turnIndex, list);
    }
    list.push(entry.key);
  }

  const currentKeys = new Set<string>();
  const olderKeys = new Set<string>();
  const knownKeys = new Set<string>();

  for (const keys of turns.values()) {
    const newest = keys[keys.length - 1];
    if (newest === undefined) continue;
    currentKeys.add(newest);
    knownKeys.add(newest);
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key === undefined) continue;
      olderKeys.add(key);
      knownKeys.add(key);
    }
  }
  const supersededKeys = new Set<string>();
  for (const key of olderKeys) {
    if (!currentKeys.has(key)) supersededKeys.add(key);
  }

  return { currentKeys, supersededKeys, knownKeys };
}

/** Keeps a reasoning row visible unless the feed identifies a newer one in the same turn. */
export function reasoningRowVisible(
  snapshot: ReasoningSnapshot | undefined,
  key: string,
): boolean {
  return !snapshot || snapshot.currentKeys.has(key) || !snapshot.knownKeys.has(key);
}

function notify(): void {
  const next = new Set<string>();
  const current = new Set<string>();
  for (const feed of feeds.values()) {
    // An unanswered feed can own any reasoning row. Keep every source row until it answers.
    if (!feed.snapshot) {
      next.clear();
      break;
    }
    for (const key of feed.snapshot.currentKeys) current.add(key);
    for (const key of feed.snapshot.supersededKeys) next.add(key);
  }
  for (const key of current) next.delete(key);
  let changed = next.size !== superseded.size;
  if (!changed) {
    for (const key of next) {
      if (!superseded.has(key)) {
        changed = true;
        break;
      }
    }
  }
  if (changed) {
    superseded = next;
    for (const listener of suppressionListeners) listener();
  }
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const listener of listeners) listener();
  });
}

export function useReasoningRowVisible(
  agentId: string,
  key: string,
  enabled: boolean,
): boolean {
  const paseo = usePaseo();
  useEffect(() => (enabled ? acquireFeed(paseo, agentId) : undefined), [enabled, paseo, agentId]);
  const readSnapshot = useCallback(() => feeds.get(agentId)?.snapshot, [agentId]);
  const snapshot = useSyncExternalStore(subscribeReasoning, readSnapshot, readSnapshot);
  return !enabled || reasoningRowVisible(snapshot, key);
}

const PAGE = 200;
// Scan at most 1,000 entries. Keep unmatched older cards visible beyond this limit.
const MAX_PAGES = 5;
type NoteItem = (
  item: { type: string; text?: unknown },
  timestamp: string,
  seq?: number,
) => void;

/** Reads up to MAX_PAGES of recent history to partition reasoning rows by turn. */
async function backfill(
  paseo: PaseoApi,
  agentId: string,
  live: () => boolean,
  note: NoteItem,
): Promise<boolean> {
  const timeline = paseo.agents.ref(agentId).timeline;
  let page = await timeline.refetch({ direction: "tail", limit: PAGE });
  for (let pages = 1; live(); pages++) {
    for (const entry of page.entries) {
      note(entry.item, entry.timestamp, entry.seqEnd);
    }
    if (!page.hasOlder) return true;
    if (!page.startCursor || pages >= MAX_PAGES) return false;
    page = await timeline.refetch({ direction: "before", cursor: page.startCursor, limit: PAGE });
  }
  return false;
}

/** Shares one observation per agent and retries failed observations while readers remain. */
function acquireFeed(paseo: PaseoApi, agentId: string): () => void {
  let feed = feeds.get(agentId);
  if (!feed) {
    const timeline = paseo.agents.ref(agentId).timeline;
    const created: Feed = { users: 0, stop: () => {} };
    feeds.set(agentId, created);
    notify();
    let live = true;
    let attempt = 0;
    let retryDelay = 500;
    let retry: NodeJS.Timeout | undefined;
    let release: PaseoAgentTimelineSubscription | undefined;

    const connect = () => {
      retry = undefined;
      const current = ++attempt;
      const active = () => live && attempt === current;
      const entries = new Map<number | string, ReasoningFeedEntry>();
      let order = 0;
      let ready = false;
      let scanned = false;
      let complete = false;
      let scan = 0;

      const publish = () => {
        created.snapshot = scanned && complete ? computeReasoningSnapshot(entries.values()) : undefined;
        notify();
      };
      const note: NoteItem = (item, timestamp, seq) => {
        if (!active() || (item.type !== "reasoning" && item.type !== "user_message")) return;
        const at = Date.parse(timestamp);
        if (!Number.isFinite(at)) return;
        const kind = item.type;
        const key = kind === "reasoning" ? reasoningKey(item.text) : undefined;
        const id = seq ?? `${kind}:${at}:${key ?? ""}`;
        const previous = entries.get(id);
        if (previous && previous.kind === kind && previous.at === at && previous.key === key) {
          return;
        }
        entries.set(id, {
          kind,
          at,
          seq,
          order: previous?.order ?? order++,
          key,
        });
        if (scanned) publish();
      };
      const fail = () => {
        if (!active()) return;
        attempt += 1;
        release?.();
        release = undefined;
        created.snapshot = undefined;
        notify();
        retry = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10_000);
      };
      const rescan = () => {
        const currentScan = ++scan;
        entries.clear();
        order = 0;
        scanned = false;
        complete = false;
        publish();
        if (!ready) return;
        void backfill(paseo, agentId, () => active() && scan === currentScan, note)
          .then((done) => {
            if (!active() || scan !== currentScan) return;
            scanned = true;
            complete = done;
            retryDelay = 500;
            publish();
          })
          .catch(() => {
            if (scan === currentScan) fail();
          });
      };

      try {
        const observation = timeline.subscribe((event) => {
          if (!active()) return;
          if (event.event.type === "error") {
            fail();
          } else if (
            event.event.type === "replacement" ||
            event.event.type === "subscription_restored"
          ) {
            rescan();
          } else if (event.event.type === "timeline" && "timestamp" in event) {
            note(event.event.item, event.timestamp, event.seq);
          }
        });
        // A subscription can fail before subscribe returns its release function.
        if (!active()) {
          observation();
          void observation.ready.catch(() => {});
        } else {
          release = observation;
          void observation.ready
            .then(() => {
              if (!active()) return;
              ready = true;
              rescan();
            })
            .catch(fail);
        }
      } catch {
        fail();
      }
    };

    created.stop = () => {
      live = false;
      attempt += 1;
      clearTimeout(retry);
      release?.();
    };
    feed = created;
    connect();
  }
  feed.users += 1;
  const owned = feed;
  return () => {
    owned.users -= 1;
    if (owned.users > 0) return;
    owned.stop();
    feeds.delete(agentId);
    notify();
  };
}

/** Keeps the reasoning feed open while another plugin row is visible. */
export function ReasoningFeed({ agentId }: { agentId: string }) {
  return useEnhancerPreferences().latestReasoningOnly ? <OpenFeed agentId={agentId} /> : null;
}

function OpenFeed({ agentId }: { agentId: string }) {
  const paseo = usePaseo();
  useEffect(() => acquireFeed(paseo, agentId), [paseo, agentId]);
  return null;
}
