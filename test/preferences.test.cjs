const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, resolve } = require("node:path");
const test = require("node:test");
const { runInThisContext } = require("node:vm");
const ts = require("typescript");

const STORAGE_KEY = "paseo/beautiful-chat/preferences/v1";

// Compile with the existing TypeScript dependency; only host UI/runtime modules
// are stubbed. Preferences, settings contracts and transformers run unchanged.
function harness(platform = "ios", legacy) {
  const cache = new Map();
  const transformers = new Map();
  const storage = legacy === undefined ? undefined : {
    getItem(key) {
      assert.equal(key, STORAGE_KEY);
      if (legacy instanceof Error) throw legacy;
      return legacy;
    },
    setItem() { throw new Error("Legacy storage must not receive new writes"); },
    removeItem() {},
  };
  function load(relative) {
    const filename = resolve(__dirname, "..", relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const realRequire = createRequire(filename);
    const localRequire = (id) => {
      if (id === "react-native") return { Platform: { OS: platform } };
      if (id.endsWith("/settings-page") || id.endsWith("/live-renderers")) return {};
      if (id.includes("/components/")) return new Proxy({}, { get: () => () => () => {} });
      if (id.startsWith(".")) {
        const base = resolve(dirname(filename), id);
        return load(base + (base.endsWith(".tsx") || base.endsWith(".ts") ? "" : ".ts"));
      }
      return realRequire(id);
    };
    runInThisContext(`(function(require,module,exports,globalThis){${compiled}\n})`, { filename })(
      localRequire, mod, mod.exports, { localStorage: storage },
    );
    return mod.exports;
  }
  const preferences = load("client/preferences.ts");
  return {
    preferences,
    load,
    transformers,
    contribute(rpc) {
      return load("index.client.tsx").default({
        rpc,
        addSettingsScreen() { return () => {}; },
        addTimelineTransformer(contribution) {
          transformers.set(contribution.id, contribution);
          return () => {};
        },
        addTimelineRenderer() { return () => {}; },
      });
    },
  };
}

function host(initial = {}) {
  let values = { preferences: {}, legacyMigrated: false, ...initial };
  let revision = 0;
  const calls = [];
  const state = {
    calls,
    failWrites: false,
    failReads: false,
    conflictOnce: false,
    get values() { return values; },
    async rpc(contract, input) {
      calls.push({ name: contract.name, input: structuredClone(input) });
      if (contract.name.endsWith(".read")) {
        if (state.failReads) throw new Error("Host unavailable");
        return { status: "ready", revision: String(revision), values: structuredClone(values) };
      }
      if (state.failWrites) throw new Error("Host unavailable");
      if (state.conflictOnce) {
        state.conflictOnce = false;
        values.preferences.accent = "rose";
        revision++;
      }
      if (input.revision !== String(revision)) return { status: "conflict", error: "Changed elsewhere" };
      values = structuredClone(input.values);
      revision++;
      return { status: "saved", revision: String(revision), values: structuredClone(values) };
    },
  };
  return state;
}

test("iOS defaults enable both styled text renderers", () => {
  const { preferences: p } = harness("ios");
  assert.equal(p.getEnhancerPreferences().assistantMarkdown, true);
  assert.equal(p.getEnhancerPreferences().enhancedUserBubble, true);
  assert.equal(p.getEnhancerPreferences().frostedGlass, true);
});

for (const platform of ["android", "web"]) {
  test(`${platform} keeps the existing defaults`, () => {
    const { preferences: p } = harness(platform);
    assert.equal(p.getEnhancerPreferences().assistantMarkdown, true);
    assert.equal(p.getEnhancerPreferences().enhancedUserBubble, true);
  });
}

test("native writes survive a fresh client without localStorage", async () => {
  const server = host();
  const first = harness("ios").preferences;
  await first.initializeEnhancerPreferences(server.rpc);
  await first.updateEnhancerPreferences({ assistantMarkdown: true, enhancedUserBubble: true, accent: "jade" });
  const second = harness("ios").preferences;
  await second.initializeEnhancerPreferences(server.rpc);
  assert.equal(second.getEnhancerPreferences().assistantMarkdown, true);
  assert.equal(second.getEnhancerPreferences().enhancedUserBubble, true);
  assert.equal(second.getEnhancerPreferences().accent, "jade");
  await second.updateEnhancerPreferences({ assistantMarkdown: false, enhancedUserBubble: false });
  const third = harness("ios").preferences;
  await third.initializeEnhancerPreferences(server.rpc);
  assert.equal(third.getEnhancerPreferences().assistantMarkdown, false);
  assert.equal(third.getEnhancerPreferences().enhancedUserBubble, false);
});

test("saving an unrelated preference does not turn platform defaults into explicit choices", async () => {
  const server = host();
  const ios = harness("ios").preferences;
  await ios.initializeEnhancerPreferences(server.rpc);
  await ios.updateEnhancerPreferences({ accent: "violet" });
  assert.equal(server.values.preferences.assistantMarkdown, undefined);
  assert.equal(server.values.preferences.enhancedUserBubble, undefined);
  const web = harness("web").preferences;
  await web.initializeEnhancerPreferences(server.rpc);
  assert.equal(web.getEnhancerPreferences().assistantMarkdown, true);
  assert.equal(web.getEnhancerPreferences().enhancedUserBubble, true);
});

test("legacy web settings migrate once, preserving explicit booleans and stored SDK choices", async () => {
  const legacy = JSON.stringify({ assistantMarkdown: true, enhancedUserBubble: false, accent: "jade", uiFont: "system" });
  const server = host({ preferences: { accent: "rose" } });
  const first = harness("web", legacy).preferences;
  await first.initializeEnhancerPreferences(server.rpc);
  assert.equal(server.values.legacyMigrated, true);
  assert.deepEqual(server.values.preferences, { assistantMarkdown: true, enhancedUserBubble: false, accent: "rose", uiFont: "system" });
  await first.updateEnhancerPreferences({ assistantMarkdown: false, uiFont: "inter" });
  const next = harness("web", legacy).preferences;
  await next.initializeEnhancerPreferences(server.rpc);
  assert.equal(next.getEnhancerPreferences().assistantMarkdown, false);
  assert.equal(next.getEnhancerPreferences().uiFont, "inter");
});

test("a native first load leaves legacy migration available to the web client", async () => {
  const server = host();
  const native = harness("ios").preferences;
  await native.initializeEnhancerPreferences(server.rpc);
  assert.equal(server.values.legacyMigrated, false);
  const web = harness("web", JSON.stringify({ accent: "jade", assistantMarkdown: false })).preferences;
  await web.initializeEnhancerPreferences(server.rpc);
  assert.equal(server.values.legacyMigrated, true);
  assert.equal(web.getEnhancerPreferences().accent, "jade");
  assert.equal(web.getEnhancerPreferences().assistantMarkdown, false);
});

test("partial legacy data uses platform defaults for missing or invalid fields", async () => {
  const server = host();
  const { preferences: p } = harness("ios", JSON.stringify({ accent: "constructor", uiFont: "system", assistantMarkdown: "true" }));
  await p.initializeEnhancerPreferences(server.rpc);
  assert.equal(p.getEnhancerPreferences().accent, "host");
  assert.equal(p.getEnhancerPreferences().uiFont, "system");
  assert.equal(p.getEnhancerPreferences().assistantMarkdown, true);
  assert.equal(p.getEnhancerPreferences().enhancedUserBubble, true);
});

for (const legacy of ["{broken", "null", "[]", new Error("Storage disabled")]) {
  test(`unusable legacy storage is ignored: ${String(legacy)}`, async () => {
    const server = host();
    const { preferences: p } = harness("web", legacy);
    await p.initializeEnhancerPreferences(server.rpc);
    assert.equal(p.getEnhancerPreferences().assistantMarkdown, true);
    assert.deepEqual(server.values.preferences, {});
  });
}

test("reset restores platform defaults durably without replaying legacy data", async () => {
  const server = host();
  const legacy = JSON.stringify({ assistantMarkdown: true, accent: "jade" });
  const { preferences: p } = harness("ios", legacy);
  await p.initializeEnhancerPreferences(server.rpc);
  await p.resetEnhancerPreferences();
  assert.equal(p.getEnhancerPreferences().assistantMarkdown, true);
  assert.equal(server.values.legacyMigrated, true);
  const next = harness("ios", legacy).preferences;
  await next.initializeEnhancerPreferences(server.rpc);
  assert.equal(next.getEnhancerPreferences().assistantMarkdown, true);
  assert.equal(next.getEnhancerPreferences().accent, "host");
});

test("queued writes and revision conflicts preserve other settings", async () => {
  const server = host();
  const { preferences: p } = harness();
  await p.initializeEnhancerPreferences(server.rpc);
  server.conflictOnce = true;
  await Promise.all([
    p.updateEnhancerPreferences({ assistantMarkdown: true }),
    p.updateEnhancerPreferences({ enhancedUserBubble: true }),
  ]);
  assert.deepEqual(server.values.preferences, { accent: "rose", assistantMarkdown: true, enhancedUserBubble: true });
  assert.equal(p.getEnhancerPreferences().accent, "rose");
});

test("write errors are visible and a later edit retries", async () => {
  const server = host();
  const { preferences: p } = harness();
  await p.initializeEnhancerPreferences(server.rpc);
  server.failWrites = true;
  await p.updateEnhancerPreferences({ assistantMarkdown: true });
  assert.match(p.getEnhancerPreferencesError(), /Host unavailable/);
  server.failWrites = false;
  await p.updateEnhancerPreferences({ assistantMarkdown: true });
  assert.equal(p.getEnhancerPreferencesError(), null);
  assert.equal(server.values.preferences.assistantMarkdown, true);
});

test("edits made before initial storage load are saved", async () => {
  const server = host({ preferences: { accent: "amber" } });
  const { preferences: p } = harness();
  const initialize = p.initializeEnhancerPreferences(server.rpc);
  const edit = p.updateEnhancerPreferences({ assistantMarkdown: true });
  await Promise.all([initialize, edit]);
  assert.equal(p.getEnhancerPreferences().assistantMarkdown, true);
  assert.equal(p.getEnhancerPreferences().accent, "amber");
});

test("contribution loads preferences and iOS transformers honor explicit opt-out", async () => {
  const server = host();
  const h = harness();
  const cleanup = h.contribute(server.rpc);
  await new Promise(setImmediate);
  assert.ok(server.calls.some(({ name }) => name === "settings.presentation.read"));
  const assistant = h.transformers.get("omp-enhanced-assistant");
  const user = h.transformers.get("omp-enhanced-user-message");
  const reply = { item: { type: "assistant_message", text: "Hello" } };
  const prompt = { item: { type: "user_message", text: "Hi" } };
  assert.equal(assistant.transform(reply).items[0].kind, "omp-assistant");
  assert.equal(user.transform(prompt).items[0].kind, "omp-user-message");
  await h.preferences.updateEnhancerPreferences({ assistantMarkdown: false, enhancedUserBubble: false });
  assert.equal(assistant.transform(reply), undefined);
  assert.equal(user.transform(prompt), undefined);
  cleanup();
});

test("text transformers defer to the host while saved preferences are unavailable", async () => {
  const server = host();
  server.failReads = true;
  const h = harness("web");
  const cleanup = h.contribute(server.rpc);
  await new Promise(setImmediate);
  assert.equal(h.transformers.get("omp-enhanced-assistant").transform({ item: { type: "assistant_message", text: "Hi" } }), undefined);
  assert.equal(h.transformers.get("omp-enhanced-user-message").transform({ item: { type: "user_message", text: "Hi" } }), undefined);
  assert.match(h.preferences.getEnhancerPreferencesError(), /Host unavailable/);
  cleanup();
});

for (const platform of ["android", "web"]) {
  test(`${platform} transformers keep rendering by default and honor explicit opt-out`, async () => {
    const server = host();
    const h = harness(platform);
    const cleanup = h.contribute(server.rpc);
    await new Promise(setImmediate);
    const assistant = h.transformers.get("omp-enhanced-assistant");
    const user = h.transformers.get("omp-enhanced-user-message");
    const reply = { item: { type: "assistant_message", text: "Hello" } };
    const prompt = { item: { type: "user_message", text: "Hi" } };
    assert.equal(assistant.transform(reply).items[0].kind, "omp-assistant");
    assert.equal(user.transform(prompt).items[0].kind, "omp-user-message");
    await h.preferences.updateEnhancerPreferences({ assistantMarkdown: false, enhancedUserBubble: false });
    assert.equal(assistant.transform(reply), undefined);
    assert.equal(user.transform(prompt), undefined);
    cleanup();
  });
}

test("server registers an SDK settings schema without platform-dependent defaults", () => {
  const h = harness();
  let definition;
  const cleanup = h.load("index.server.ts").default({
    registerSettings(value) { definition = value; },
    handle() {},
  });
  assert.equal(definition.id, "presentation");
  assert.equal(definition.scope, "host");
  assert.deepEqual(definition.schema.parse({}), { preferences: {}, legacyMigrated: false });
  assert.equal(definition.schema.safeParse({ preferences: { assistantMarkdown: "true" } }).success, false);
  cleanup();
});

test("failed migration is retried rather than marked complete", async () => {
  const server = host();
  server.failWrites = true;
  const { preferences: p } = harness("web", JSON.stringify({ assistantMarkdown: false }));
  await p.initializeEnhancerPreferences(server.rpc);
  assert.equal(server.values.legacyMigrated, false);
  assert.equal(p.areEnhancerPreferencesReady(), false);
  assert.match(p.getEnhancerPreferencesError(), /Host unavailable/);
  server.failWrites = false;
  await p.initializeEnhancerPreferences(server.rpc);
  assert.equal(server.values.legacyMigrated, true);
  assert.equal(p.getEnhancerPreferences().assistantMarkdown, false);
});

test("repeated revision conflicts stop with a visible error", async () => {
  const server = host({ legacyMigrated: true });
  const { preferences: p } = harness();
  await p.initializeEnhancerPreferences(server.rpc);
  await p.initializeEnhancerPreferences(async (contract, input) => {
    if (contract.name.endsWith(".write")) return { status: "conflict", error: "Changed elsewhere" };
    return server.rpc(contract, input);
  });
  const readsBefore = server.calls.length;
  await p.updateEnhancerPreferences({ assistantMarkdown: true });
  assert.equal(server.calls.length - readsBefore, 3);
  assert.match(p.getEnhancerPreferencesError(), /another client/);
  assert.equal(server.values.preferences.assistantMarkdown, undefined);
});

test("invalid SDK settings stay visible as an error and do not take over text rows", async () => {
  const { preferences: p } = harness("web");
  await p.initializeEnhancerPreferences(async () => ({ status: "invalid", revision: "0", error: "Invalid settings" }));
  assert.equal(p.areEnhancerPreferencesReady(), false);
  assert.match(p.getEnhancerPreferencesError(), /Invalid settings/);
});


test("text size has four reading presets and scales fonts in half points", () => {
  const h = harness();
  const p = h.preferences;
  assert.deepEqual(p.TEXT_SIZE_OPTIONS, [
    { value: "0.9", label: "Small" },
    { value: "1", label: "Default" },
    { value: "1.15", label: "Large" },
    { value: "1.3", label: "XL" },
  ]);
  const { buildThemeTokens } = h.load("client/components/theme-tokens.ts");
  const colors = { surface0: "#111111", foreground: "#eeeeee", foregroundMuted: "#aaaaaa", accent: "#00ff00", statusDanger: "#ff0000" };
  for (const scale of [0.85, 0.9, 1, 1.15, 1.3, 1.35]) {
    const tokens = buildThemeTokens(colors, { ...p.DEFAULT_PREFERENCES, textScale: scale });
    assert.equal(tokens.textScale, scale);
    assert.equal(tokens.fs(13.5), Math.round(13.5 * scale * 2) / 2);
    assert.equal(tokens.fs(20), Math.round(20 * scale * 2) / 2);
  }
});

test("text size clamps finite values and persists across iOS and web host clients", async () => {
  const server = host();
  const p = harness("ios").preferences;
  await p.initializeEnhancerPreferences(server.rpc);
  assert.equal(p.getEnhancerPreferences().textScale, 1);
  for (const [input, expected] of [[0.1, 0.85], [4, 1.35], [1.15, 1.15], [1.3, 1.3]]) {
    await p.updateEnhancerPreferences({ textScale: input });
    assert.equal(p.getEnhancerPreferences().textScale, expected);
    assert.equal(server.values.preferences.textScale, expected);
    const web = harness("web").preferences;
    await web.initializeEnhancerPreferences(server.rpc);
    assert.equal(web.getEnhancerPreferences().textScale, expected);
  }
  for (const input of [NaN, Infinity, -Infinity]) {
    assert.throws(() => p.updateEnhancerPreferences({ textScale: input }));
  }
  await p.resetEnhancerPreferences();
  assert.equal(p.getEnhancerPreferences().textScale, 1);
  assert.deepEqual(server.values.preferences, {});
});

test("text size ignores legacy localStorage and clamps host values", async () => {
  const p = harness("web", JSON.stringify({ textScale: 1.3 })).preferences;
  await p.initializeEnhancerPreferences(host().rpc);
  assert.equal(p.getEnhancerPreferences().textScale, 1);
  const native = harness().preferences;
  await native.initializeEnhancerPreferences(host({ preferences: { textScale: 10 } }).rpc);
  assert.equal(native.getEnhancerPreferences().textScale, 1.35);
});
