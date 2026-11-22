const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { runInThisContext } = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function loadReasoningLive({ paseo, latestReasoningOnly = true } = {}) {
  const filename = resolve(__dirname, "../client/components/reasoning-live.tsx");
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

  const cleanups = [];
  const react = {
    useCallback: (fn) => fn,
    useEffect(effect) {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };

  const mod = { exports: {} };
  const realRequire = createRequire(filename);
  const localRequire = (id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") {
      return {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
        Fragment: "Fragment",
      };
    }
    if (id === "@getpaseo/plugin/client") {
      return { usePaseo: () => paseo };
    }
    if (id === "../preferences") {
      return { useEnhancerPreferences: () => ({ latestReasoningOnly }) };
    }
    return realRequire(id);
  };

  runInThisContext(`(function(require,module,exports){${compiled}\n})`, {
    filename,
  })(localRequire, mod, mod.exports);

  return {
    mod: mod.exports,
    cleanup() {
      while (cleanups.length > 0) cleanups.pop()();
    },
  };
}

function flush() {
  return new Promise((resolvePromise) => setImmediate(resolvePromise));
}

function createMockPaseo(agents) {
  const listenersByAgent = new Map();
  return {
    emit(agentId, event) {
      for (const listener of listenersByAgent.get(agentId) ?? []) listener(event);
    },
    api: {
      agents: {
        ref(agentId) {
          const config = agents[agentId];
          return {
            timeline: {
              subscribe(listener) {
                let set = listenersByAgent.get(agentId);
                if (!set) {
                  set = new Set();
                  listenersByAgent.set(agentId, set);
                }
                set.add(listener);
                const release = () => {
                  set.delete(listener);
                };
                release.ready = config.ready ?? Promise.resolve();
                return release;
              },
              async refetch({ direction, cursor }) {
                if (typeof config.refetch === "function") {
                  return config.refetch({ direction, cursor });
                }
                return { entries: config.entries ?? [], hasOlder: false };
              },
            },
          };
        },
      },
    },
  };
}

test("computeReasoningSnapshot keeps only the final reasoning per turn", () => {
  const { mod } = loadReasoningLive();
  const snapshot = mod.computeReasoningSnapshot([
    { kind: "user_message", at: 1000, seq: 1, order: 0 },
    { kind: "reasoning", at: 1100, seq: 2, order: 1, key: "t1-step-1" },
    { kind: "reasoning", at: 1200, seq: 3, order: 2, key: "t1-step-2" },
    { kind: "reasoning", at: 1300, seq: 4, order: 3, key: "t1-final" },
    { kind: "user_message", at: 2000, seq: 5, order: 4 },
    { kind: "reasoning", at: 2100, seq: 6, order: 5, key: "t2-step-1" },
    { kind: "reasoning", at: 2200, seq: 7, order: 6, key: "t2-final" },
  ]);

  assert.deepEqual([...snapshot.currentKeys].sort(), ["t1-final", "t2-final"]);
  assert.deepEqual([...snapshot.supersededKeys].sort(), ["t1-step-1", "t1-step-2", "t2-step-1"]);
  assert.equal(mod.reasoningRowVisible(snapshot, "t1-final"), true);
  assert.equal(mod.reasoningRowVisible(snapshot, "t2-final"), true);
  assert.equal(mod.reasoningRowVisible(snapshot, "t1-step-1"), false);
  assert.equal(mod.reasoningRowVisible(snapshot, "t2-step-1"), false);
});

test("computeReasoningSnapshot protects identical text that is current in another turn", () => {
  const { mod } = loadReasoningLive();
  const snapshot = mod.computeReasoningSnapshot([
    { kind: "user_message", at: 1000, seq: 1, order: 0 },
    { kind: "reasoning", at: 1100, seq: 2, order: 1, key: "Checking files" },
    { kind: "reasoning", at: 1200, seq: 3, order: 2, key: "Done inspecting" },
    { kind: "user_message", at: 2000, seq: 4, order: 3 },
    { kind: "reasoning", at: 2100, seq: 5, order: 4, key: "Checking files" },
  ]);

  assert.equal(snapshot.currentKeys.has("Checking files"), true);
  assert.equal(snapshot.supersededKeys.has("Checking files"), false);
  assert.equal(mod.reasoningRowVisible(snapshot, "Checking files"), true);
});

test("reasoningRowVisible fails open when snapshot is missing or key is unseen", () => {
  const { mod } = loadReasoningLive();
  assert.equal(mod.reasoningRowVisible(undefined, "anything"), true);
  const snapshot = mod.computeReasoningSnapshot([
    { kind: "reasoning", at: 1000, seq: 1, order: 0, key: "old" },
    { kind: "reasoning", at: 1100, seq: 2, order: 1, key: "new" },
  ]);
  assert.equal(mod.reasoningRowVisible(snapshot, "outside-scan-window"), true);
});

test("feed backfills history, tracks live turn updates, and fails open on error", async () => {
  const mock = createMockPaseo({
    "agent-1": {
      entries: [
        { item: { type: "user_message" }, timestamp: "2026-11-21T10:00:00Z", seqEnd: 1 },
        { item: { type: "reasoning", text: "step 1" }, timestamp: "2026-11-21T10:00:01Z", seqEnd: 2 },
        { item: { type: "reasoning", text: "step 2" }, timestamp: "2026-11-21T10:00:02Z", seqEnd: 3 },
      ],
    },
  });

  const { mod, cleanup } = loadReasoningLive({ paseo: mock.api });
  try {
    let suppressionEvents = 0;
    const stopWatch = mod.subscribeSupersededReasoning(() => {
      suppressionEvents += 1;
    });

    // Before backfill completes, rows stay visible.
    assert.equal(mod.useReasoningRowVisible("agent-1", "step 1", true), true);
    await flush();

    assert.equal(mod.isSupersededReasoning("step 1"), true);
    assert.equal(mod.isSupersededReasoning("step 2"), false);
    assert.equal(suppressionEvents, 1);

    // A live reasoning item in the same turn supersedes step 2.
    mock.emit("agent-1", {
      event: { type: "timeline", item: { type: "reasoning", text: "step 3" } },
      timestamp: "2026-11-21T10:00:03Z",
      seq: 4,
    });
    assert.equal(mod.isSupersededReasoning("step 2"), true);
    assert.equal(mod.isSupersededReasoning("step 3"), false);

    // A new user_message starts a new turn; step 3 remains current for turn 1.
    mock.emit("agent-1", {
      event: { type: "timeline", item: { type: "user_message" } },
      timestamp: "2026-11-21T10:01:00Z",
      seq: 5,
    });
    mock.emit("agent-1", {
      event: { type: "timeline", item: { type: "reasoning", text: "turn 2 step 1" } },
      timestamp: "2026-11-21T10:01:01Z",
      seq: 6,
    });
    assert.equal(mod.isSupersededReasoning("step 3"), false);
    assert.equal(mod.isSupersededReasoning("turn 2 step 1"), false);

    // Feed error clears snapshot and fails open.
    mock.emit("agent-1", { event: { type: "error" } });
    assert.equal(mod.isSupersededReasoning("step 1"), false);

    stopWatch();
  } finally {
    cleanup();
  }
});

test("an unanswered sibling agent feed blocks global transformer suppression", async () => {
  let resolveAgent2;
  const mock = createMockPaseo({
    "agent-1": {
      entries: [
        { item: { type: "reasoning", text: "draft" }, timestamp: "2026-11-21T10:00:01Z", seqEnd: 1 },
        { item: { type: "reasoning", text: "final" }, timestamp: "2026-11-21T10:00:02Z", seqEnd: 2 },
      ],
    },
    "agent-2": {
      ready: new Promise((r) => {
        resolveAgent2 = r;
      }),
      entries: [
        { item: { type: "reasoning", text: "other" }, timestamp: "2026-11-21T10:00:03Z", seqEnd: 1 },
      ],
    },
  });

  const { mod, cleanup } = loadReasoningLive({ paseo: mock.api });
  try {
    mod.useReasoningRowVisible("agent-1", "draft", true);
    mod.useReasoningRowVisible("agent-2", "other", true);
    await flush();

    // agent-2 has not answered yet, so global suppression must stay empty.
    assert.equal(mod.isSupersededReasoning("draft"), false);

    resolveAgent2();
    await flush();

    // Once agent-2 answers, agent-1's superseded reasoning can be suppressed.
    assert.equal(mod.isSupersededReasoning("draft"), true);
    assert.equal(mod.isSupersededReasoning("final"), false);
  } finally {
    cleanup();
  }
});

test("incomplete backfill past MAX_PAGES fails open so unscanned turns stay protected", async () => {
  let pagesRequested = 0;
  const mock = createMockPaseo({
    "agent-1": {
      refetch({ direction, cursor }) {
        pagesRequested += 1;
        if (direction === "tail") {
          return {
            entries: [
              { item: { type: "user_message" }, timestamp: "2026-11-21T10:05:00Z", seqEnd: 1001 },
              { item: { type: "reasoning", text: "Checking files" }, timestamp: "2026-11-21T10:05:01Z", seqEnd: 1002 },
              { item: { type: "reasoning", text: "Done" }, timestamp: "2026-11-21T10:05:02Z", seqEnd: 1003 },
            ],
            hasOlder: true,
            startCursor: "page-2",
          };
        }
        return {
          entries: [],
          hasOlder: true,
          startCursor: `${cursor}-older`,
        };
      },
    },
  });

  const { mod, cleanup } = loadReasoningLive({ paseo: mock.api });
  try {
    assert.equal(mod.useReasoningRowVisible("agent-1", "Checking files", true), true);
    await flush();
    await flush();

    assert.equal(pagesRequested, 5);
    // Because older history was truncated at MAX_PAGES, an unscanned turn may end
    // with "Checking files"; both renderer and transformer must fail open.
    assert.equal(mod.useReasoningRowVisible("agent-1", "Checking files", true), true);
    assert.equal(mod.isSupersededReasoning("Checking files"), false);
  } finally {
    cleanup();
  }
});
