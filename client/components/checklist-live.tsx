import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PaseoApi } from "@getpaseo/client";
import type { TaskItemData, TaskListData } from "../../shared/contracts";
import { useEnhancerPreferences } from "../preferences";

/**
 * The transformer has no agent or timestamp. It compares list contents instead.
 * Each agent's timeline feed supplies its newest list, even outside the visible rows.
 */
const newest = new Map<string, { at: number; key: string }>();
const superseded = new Set<string>();
const listeners = new Set<() => void>();
let notifyQueued = false;

/** Calls `listener` when a newest list or a superseded list changes. */
export function subscribeNewestChecklist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Combines notifications so each task registers the todo transformer once. */
function notify(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const listener of listeners) listener();
  });
}

/**
 * Drops known older lists. Unknown lists keep a row so their renderers can open
 * the agent's feed. A list that remains newest for another agent also stays.
 */
export function isSupersededChecklist(items: unknown): boolean {
  const key = JSON.stringify(items ?? null);
  if (!superseded.has(key)) return false;
  for (const entry of newest.values()) if (entry.key === key) return false;
  return true;
}

/** Selects the agent's newest checklist by its contents and source timestamp. */
export function useIsNewestChecklist(
  agentId: string,
  items: unknown,
  at: number,
  enabled: boolean,
): boolean {
  const paseo = usePaseo();
  useEffect(() => (enabled ? acquireFeed(paseo, agentId) : undefined), [enabled, paseo, agentId]);
  const key = JSON.stringify(items ?? null);
  const readNewest = useCallback(() => newest.get(agentId), [agentId]);
  const current = useSyncExternalStore(subscribeNewestChecklist, readNewest, readNewest);
  // Remove the host's row gap once the feed identifies an unknown list as older.
  useEffect(() => {
    if (enabled && current !== undefined && current.key !== key && !superseded.has(key)) {
      superseded.add(key);
      notify();
    }
  }, [enabled, current, key]);
  return current !== undefined && current.key === key && current.at === at;
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

/** Records one todo item. An older list never replaces a newer list. */
function noteItem(agentId: string, item: { type: string; items?: unknown }, timestamp: string): void {
  if (item.type !== "todo") return;
  const at = Date.parse(timestamp);
  const current = newest.get(agentId);
  if (Number.isNaN(at) || (current && at <= current.at)) return;
  const key = JSON.stringify(item.items ?? null);
  if (current && current.key !== key) superseded.add(current.key);
  newest.set(agentId, { at, key });
  notify();
}

const PAGE = 200;
// ponytail: the scan stops after five pages. Raise this limit if long sessions lose their checklist.
const MAX_PAGES = 5;

/** Reads older pages until this scan finds a checklist. */
async function backfill(paseo: PaseoApi, agentId: string, live: () => boolean): Promise<void> {
  const timeline = paseo.agents.ref(agentId).timeline;
  let page = await timeline.refetch({ direction: "tail", limit: PAGE });
  // A cached list can predate the last feed release. Stop only on a list this scan finds.
  for (let pages = 1, found = false; live(); pages++) {
    for (const entry of page.entries) {
      noteItem(agentId, entry.item, entry.timestamp);
      if (entry.item.type === "todo") found = true;
    }
    if (found || !page.hasOlder || !page.startCursor || pages >= MAX_PAGES) return;
    page = await timeline.refetch({ direction: "before", cursor: page.startCursor, limit: PAGE });
  }
}

interface Feed {
  users: number;
  stop: () => void;
}

const feeds = new Map<string, Feed>();

/** Opens one feed per agent and closes it after its last reader leaves. */
function acquireFeed(paseo: PaseoApi, agentId: string): () => void {
  let feed = feeds.get(agentId);
  if (!feed) {
    let live = true;
    let scan = 0;
    const rescan = () => {
      const current = ++scan;
      void backfill(paseo, agentId, () => live && scan === current).catch(() => {});
    };
    const timeline = paseo.agents.ref(agentId).timeline;
    const release = timeline.subscribe((event) => {
      if (event.event.type === "replacement") {
        newest.delete(agentId);
        notify();
        rescan();
      } else if (event.event.type === "subscription_restored") {
        rescan();
      } else if (event.event.type === "timeline" && "timestamp" in event) {
        noteItem(agentId, event.event.item, event.timestamp);
      }
    });
    // Subscribe before the scan so updates cannot fall between history and live delivery.
    void release.ready.then(() => {
      if (live) rescan();
    }).catch(() => {});
    const created: Feed = {
      users: 0,
      stop: () => {
        live = false;
        release();
      },
    };
    feed = created;
    feeds.set(agentId, created);
  }
  feed.users += 1;
  const owned = feed;
  return () => {
    owned.users -= 1;
    if (owned.users > 0) return;
    owned.stop();
    feeds.delete(agentId);
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
