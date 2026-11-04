import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PaseoApi, PaseoAgentTimelineSubscription } from "@getpaseo/client";
import type { TaskItemData, TaskListData } from "../../shared/contracts";
import { useEnhancerPreferences } from "../preferences";

interface ChecklistEntry {
  at: number;
  key: string;
  seq?: number;
}

interface ChecklistSnapshot {
  newest?: ChecklistEntry;
  entries: ChecklistEntry[];
}

interface Feed {
  users: number;
  snapshot?: ChecklistSnapshot;
  stop: () => void;
}

const feeds = new Map<string, Feed>();
const listeners = new Set<() => void>();
const suppressionListeners = new Set<() => void>();
let superseded = new Set<string>();
let notifyQueued = false;

function subscribeChecklist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeSupersededChecklist(listener: () => void): () => void {
  suppressionListeners.add(listener);
  return () => {
    suppressionListeners.delete(listener);
  };
}

/** Protects content that remains current for any observed agent. */
export function isSupersededChecklist(key: string): boolean {
  return superseded.has(key);
}

function notify(): void {
  const next = new Set<string>();
  const current = new Set<string>();
  for (const feed of feeds.values()) {
    // An unanswered feed can own any list. Keep every source row until it answers.
    if (!feed.snapshot) {
      next.clear();
      break;
    }
    const newest = feed.snapshot.newest?.key;
    if (newest !== undefined) current.add(newest);
    for (const entry of feed.snapshot.entries) {
      if (entry.key !== newest) next.add(entry.key);
    }
  }
  for (const key of current) next.delete(key);
  let changed = next.size !== superseded.size;
  for (const key of next) {
    if (!superseded.has(key)) {
      changed = true;
      break;
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

/** Uses a fixed field order for host and feed task content. */
export function checklistKey(items: unknown): string {
  return JSON.stringify((Array.isArray(items) ? items : []).map((raw) => {
    const task = (raw ?? {}) as Record<string, unknown>;
    return [task.id ?? null, task.text, task.completed, task.status ?? null, task.activeForm ?? null];
  }));
}

function isNewer(next: ChecklistEntry, previous: ChecklistEntry): boolean {
  return next.seq !== undefined && previous.seq !== undefined
    ? next.seq > previous.seq
    : next.at > previous.at;
}

/** Host row timestamps do not identify todo updates. Compare observed task content only. */
function checklistRowVisible(snapshot: ChecklistSnapshot | undefined, key: string): boolean {
  return !snapshot || snapshot.newest?.key === key || !snapshot.entries.some((entry) => entry.key === key);
}

export function useChecklistRowVisible(
  agentId: string,
  key: string,
  enabled: boolean,
): boolean {
  const paseo = usePaseo();
  useEffect(() => (enabled ? acquireFeed(paseo, agentId) : undefined), [enabled, paseo, agentId]);
  const readSnapshot = useCallback(() => feeds.get(agentId)?.snapshot, [agentId]);
  const snapshot = useSyncExternalStore(subscribeChecklist, readSnapshot, readSnapshot);
  return !enabled || checklistRowVisible(snapshot, key);
}

export function toTaskListData(items: unknown): TaskListData {
  const tasks: TaskItemData[] = (Array.isArray(items) ? items : []).map((raw, idx) => {
    const task = (raw ?? {}) as Record<string, unknown>;
    return {
      id: typeof task.id === "string" ? task.id : `todo-${idx}`,
      title: typeof task.text === "string" ? task.text : "Untitled task",
      phase: "Execution",
      status:
        task.completed === true
          ? "completed"
          : task.status === "in_progress"
            ? "in_progress"
            : "pending",
    };
  });
  return { id: "live-todo", phaseName: "Checklist Progress", tasks };
}

const PAGE = 200;
// ponytail: scan at most 1,000 entries. Keep unmatched cards visible beyond this limit.
const MAX_PAGES = 5;
type NoteItem = (item: { type: string; items?: unknown }, timestamp: string, seq?: number) => void;

/** Reads older pages until this scan finds a checklist. */
async function backfill(paseo: PaseoApi, agentId: string, live: () => boolean, note: NoteItem): Promise<boolean> {
  const timeline = paseo.agents.ref(agentId).timeline;
  let page = await timeline.refetch({ direction: "tail", limit: PAGE });
  for (let pages = 1, found = false; live(); pages++) {
    for (const entry of page.entries) {
      note(entry.item, entry.timestamp, entry.seqEnd);
      if (entry.item.type === "todo") found = true;
    }
    if (found || !page.hasOlder) return !found;
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
      const entries = new Map<number | string, ChecklistEntry>();
      let newest: ChecklistEntry | undefined;
      let ready = false;
      let scanned = false;
      let complete = false;
      let scan = 0;

      const publish = () => {
        created.snapshot = scanned && (newest || complete) ? { newest, entries: [...entries.values()] } : undefined;
        notify();
      };
      const note: NoteItem = (item, timestamp, seq) => {
        if (!active() || item.type !== "todo") return;
        const at = Date.parse(timestamp);
        if (!Number.isFinite(at)) return;
        const key = checklistKey(item.items);
        const id = seq ?? `${at}:${key}`;
        const previous = entries.get(id);
        if (previous?.at === at && previous.key === key) return;
        const entry = { at, key, seq };
        entries.set(id, entry);
        if (!newest || isNewer(entry, newest) || newest === previous) newest = entry;
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
        newest = undefined;
        scanned = false;
        complete = false;
        publish();
        if (!ready) return;
        void backfill(paseo, agentId, () => active() && scan === currentScan, note).then((done) => {
          if (!active() || scan !== currentScan) return;
          scanned = true;
          complete = done;
          retryDelay = 500;
          publish();
        }).catch(() => {
          if (scan === currentScan) fail();
        });
      };

      try {
        const observation = timeline.subscribe((event) => {
          if (!active()) return;
          if (event.event.type === "error") {
            fail();
          } else if (event.event.type === "replacement") {
            rescan();
          } else if (event.event.type === "subscription_restored") {
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
          void observation.ready.then(() => {
            if (!active()) return;
            ready = true;
            rescan();
          }).catch(fail);
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

/** Keeps the checklist feed open while another plugin row is visible. */
export function ChecklistFeed({ agentId }: { agentId: string }) {
  return useEnhancerPreferences().liveChecklist ? <OpenFeed agentId={agentId} /> : null;
}

function OpenFeed({ agentId }: { agentId: string }) {
  const paseo = usePaseo();
  useEffect(() => acquireFeed(paseo, agentId), [paseo, agentId]);
  return null;
}
