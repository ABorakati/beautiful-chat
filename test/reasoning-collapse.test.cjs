const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, resolve } = require("node:path");
const { runInThisContext } = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const HOST_SETTINGS_KEY = "@paseo:app-settings";

function createStorage(rawOrError) {
  if (rawOrError === undefined) return undefined;
  return {
    getItem(key) {
      if (key !== HOST_SETTINGS_KEY) return null;
      if (rawOrError instanceof Error) throw rawOrError;
      return rawOrError;
    },
    setItem() {},
    removeItem() {},
  };
}

function createHarness({
  hostSettingsRaw = undefined,
  collapseReasoning = true,
  platform = "web",
  scale = 1,
} = {}) {
  const hooksByComponent = new Map();
  let activeKey = "root";
  let cursor = 0;

  function currentSlot() {
    let slots = hooksByComponent.get(activeKey);
    if (!slots) {
      slots = [];
      hooksByComponent.set(activeKey, slots);
    }
    return slots;
  }

  const react = {
    useState(initial) {
      const slots = currentSlot();
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      const key = activeKey;
      return [
        slots[i],
        (value) => {
          const target = hooksByComponent.get(key);
          target[i] = typeof value === "function" ? value(target[i]) : value;
        },
      ];
    },
    useRef(value) {
      const slots = currentSlot();
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useEffect() {},
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };

  let currentPreferences = {
    collapseReasoning,
    selectionActions: false,
    pointerGlow: false,
    frostedGlass: false,
    textScale: scale,
  };

  const fs = (n) => Math.round(n * scale * 2) / 2;
  const tokens = new Proxy(
    {
      fs,
      textScale: scale,
      leading: 1,
      isDark: true,
      boxShadow: {},
      fontUi: "Inter",
      fontMono: "Iosevka",
      fontCode: "Iosevka",
      codeFontSize: fs(12),
      codeLineHeight: Math.round(fs(12) * 1.5),
    },
    { get: (o, k) => (k in o ? o[k] : "#aaaaaa") },
  );

  const storage = createStorage(hostSettingsRaw);
  const cache = new Map();

  function resolveModule(base) {
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      try {
        readFileSync(candidate, "utf8");
        return candidate;
      } catch {
        // try next extension
      }
    }
    return base;
  }

  function load(relative) {
    const filename = resolveModule(resolve(__dirname, "..", relative));
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;

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
      if (id === "react-native") {
        return {
          View: "View",
          Text: "Text",
          Pressable: "Pressable",
          Platform: { OS: platform },
          StyleSheet: { create: (styles) => styles },
          Animated: {
            Value: class AnimatedValue {
              constructor(initial) {
                this.value = initial;
              }
            },
            View: "Animated.View",
            timing: () => ({ start() {}, stop() {} }),
          },
        };
      }
      if (id === "@getpaseo/plugin/client") {
        return {
          useAgent: () => undefined,
          usePaseo: () => ({}),
          useRpc: () => async () => {},
        };
      }
      if (id === "@getpaseo/plugin/client/react-native") {
        return {
          useRevealedText: (text) => text,
        };
      }
      if (id.endsWith("/preferences") || id === "./preferences") {
        return {
          useEnhancerPreferences: () => currentPreferences,
        };
      }
      if (id.endsWith("/theme-tokens") || id === "./theme-tokens") {
        return {
          radius: { card: 12, block: 8, chip: 4 },
          useThemeTokens: () => tokens,
        };
      }
      if (
        id === "./host-settings" ||
        id === "./reasoning-collapse" ||
        id === "./components/reasoning-trace" ||
        id === "./components/selection" ||
        id === "./selection"
      ) {
        return load(resolve(dirname(filename), id));
      }
      if (id === "./components/reasoning-live") {
        return {
          ReasoningFeed: () => null,
          reasoningKey: (text) => (typeof text === "string" ? text : ""),
          useReasoningRowVisible: () => true,
        };
      }
      if (id.startsWith(".")) {
        return new Proxy(
          {},
          {
            get: (_, key) => {
              if (key === "surfaceProps" || key === "glowing" || key === "pathContextProps" || key === "promptRowAnchor") {
                return () => ({});
              }
              if (key === "hostFontEscape" || key === "frosted" || key === "selectionSurface") {
                return {};
              }
              if (key === "useSelectionActions" || key === "usePointerGlow" || key === "useFrostedGlass") {
                return () => {};
              }
              return key;
            },
          },
        );
      }
      return realRequire(id);
    };

    const fakeGlobal = { localStorage: storage };
    runInThisContext(`(function(require,module,exports,globalThis,window,document){${compiled}\n})`, {
      filename,
    })(localRequire, mod, mod.exports, fakeGlobal, undefined, undefined);
    return mod.exports;
  }

  function renderTree(element, path = "root") {
    if (!element || typeof element !== "object") return element;
    if (Array.isArray(element)) return element.map((child, idx) => renderTree(child, `${path}[${idx}]`));
    if (typeof element.type === "function") {
      const prevKey = activeKey;
      const prevCursor = cursor;
      activeKey = `${path}:${element.type.name || "anon"}`;
      cursor = 0;
      const rendered = element.type(element.props);
      const expanded = renderTree(rendered, activeKey);
      activeKey = prevKey;
      cursor = prevCursor;
      return expanded;
    }
    if (element.props && "children" in element.props) {
      return {
        ...element,
        props: {
          ...element.props,
          children: renderTree(element.props.children, `${path}/${String(element.type)}`),
        },
      };
    }
    return element;
  }

  function findNodes(tree, predicate) {
    if (!tree || typeof tree !== "object") return [];
    if (Array.isArray(tree)) return tree.flatMap((child) => findNodes(child, predicate));
    return [
      ...(predicate(tree) ? [tree] : []),
      ...findNodes(tree.props?.children, predicate),
    ];
  }

  return {
    load,
    tokens,
    renderTree,
    findNodes,
    setPreferences(patch) {
      currentPreferences = { ...currentPreferences, ...patch };
    },
  };
}

function collectText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) return node.map(collectText).join("");
  return collectText(node.props?.children);
}

test("hostAutoExpandReasoning reads boolean values and safely returns null otherwise", () => {
  const cases = [
    [JSON.stringify({ autoExpandReasoning: true }), true],
    [JSON.stringify({ autoExpandReasoning: false }), false],
    [JSON.stringify({}), null],
    [JSON.stringify({ autoExpandReasoning: "true" }), null],
    [JSON.stringify({ autoExpandReasoning: 1 }), null],
    [JSON.stringify({ autoExpandReasoning: null }), null],
    [null, null],
    ["", null],
    ["{invalid-json", null],
    ["null", null],
    ["[]", null],
    [undefined, null],
    [new Error("Storage unavailable"), null],
  ];

  for (const [raw, expected] of cases) {
    const h = createHarness({ hostSettingsRaw: raw });
    const { hostAutoExpandReasoning } = h.load("client/host-settings.ts");
    assert.equal(hostAutoExpandReasoning(), expected, `input=${String(raw)}`);
  }
});

test("reasoningStartsExpanded respects collapseReasoning and Paseo's autoExpandReasoning", () => {
  const h = createHarness();
  const { reasoningStartsExpanded } = h.load("client/reasoning-collapse.ts");

  assert.equal(reasoningStartsExpanded({ collapseReasoning: true }, false), false);
  assert.equal(reasoningStartsExpanded({ collapseReasoning: true }, null), false);
  assert.equal(reasoningStartsExpanded({ collapseReasoning: true }, true), true);

  assert.equal(reasoningStartsExpanded({ collapseReasoning: false }, false), true);
  assert.equal(reasoningStartsExpanded({ collapseReasoning: false }, null), true);
  assert.equal(reasoningStartsExpanded({ collapseReasoning: false }, true), true);
});

test("LiveReasoningRenderer starts collapsed while streaming when collapse is active", () => {
  for (const [label, hostSettingsRaw] of [
    ["autoExpandReasoning=false", JSON.stringify({ autoExpandReasoning: false })],
    ["missing key", null],
    ["invalid JSON", "{broken"],
    ["no localStorage (native)", undefined],
  ]) {
    const h = createHarness({ hostSettingsRaw, collapseReasoning: true });
    const { LiveReasoningRenderer } = h.load("client/live-renderers.tsx");
    const tree = h.renderTree({
      type: LiveReasoningRenderer,
      props: {
        agentId: "agent-1",
        item: { data: { text: "Inspecting the codebase", phase: "streaming" } },
        theme: { colors: {} },
        timestamp: new Date(1_700_000_000_000),
      },
    });

    assert.equal(
      collectText(tree).includes("Inspecting the codebase"),
      false,
      `${label}: body should stay hidden while streaming`,
    );
    const collapseButtons = h.findNodes(
      tree,
      (n) => n.type === "Pressable" && n.props.accessibilityLabel === "Collapse reasoning summary",
    );
    assert.equal(collapseButtons.length, 0, `${label}: bottom collapse button hidden while collapsed`);
  }
});

test("LiveReasoningRenderer starts expanded when Paseo autoExpandReasoning is true or collapseReasoning is false", () => {
  const scenarios = [
    { name: "Paseo autoExpandReasoning=true", hostSettingsRaw: JSON.stringify({ autoExpandReasoning: true }), collapseReasoning: true },
    { name: "collapseReasoning=false with Paseo false", hostSettingsRaw: JSON.stringify({ autoExpandReasoning: false }), collapseReasoning: false },
    { name: "collapseReasoning=false without localStorage", hostSettingsRaw: undefined, collapseReasoning: false },
  ];

  for (const scenario of scenarios) {
    const h = createHarness(scenario);
    const { LiveReasoningRenderer } = h.load("client/live-renderers.tsx");
    const tree = h.renderTree({
      type: LiveReasoningRenderer,
      props: {
        agentId: "agent-1",
        item: { data: { text: "Checking tool output", phase: "streaming" } },
        theme: { colors: {} },
        timestamp: new Date(1_700_000_000_000),
      },
    });

    assert.equal(
      collectText(tree).includes("Checking tool output"),
      true,
      `${scenario.name}: body should be visible`,
    );
    const collapseButtons = h.findNodes(
      tree,
      (n) => n.type === "Pressable" && n.props.accessibilityLabel === "Collapse reasoning summary",
    );
    assert.equal(collapseButtons.length, 1, `${scenario.name}: bottom collapse button rendered`);
  }
});

test("manual expand persists across streaming updates and streaming -> complete transition", () => {
  const h = createHarness({
    hostSettingsRaw: JSON.stringify({ autoExpandReasoning: false }),
    collapseReasoning: true,
  });
  const { LiveReasoningRenderer } = h.load("client/live-renderers.tsx");
  const timestamp = new Date(1_700_000_000_000);

  const renderPhase = (text, phase) =>
    h.renderTree({
      type: LiveReasoningRenderer,
      props: {
        agentId: "agent-1",
        item: { data: { text, phase } },
        theme: { colors: {} },
        timestamp,
      },
    });

  // 1. Starts collapsed while streaming.
  let tree = renderPhase("First thought", "streaming");
  assert.equal(collectText(tree).includes("First thought"), false);

  // 2. Reader manually expands via the header.
  const header = h.findNodes(
    tree,
    (n) => n.type === "Pressable" && n.props.accessibilityRole === "button",
  )[0];
  assert.ok(header, "header toggle button exists");
  assert.equal(header.props.accessibilityState.expanded, false);
  header.props.onPress();

  // 3. Expanded body and bottom collapse button appear.
  tree = renderPhase("First thought", "streaming");
  assert.equal(collectText(tree).includes("First thought"), true);
  assert.equal(
    h.findNodes(
      tree,
      (n) => n.type === "Pressable" && n.props.accessibilityLabel === "Collapse reasoning summary",
    ).length,
    1,
  );

  // 4. Subsequent streaming update keeps it expanded.
  tree = renderPhase("First thought\n\nSecond thought", "streaming");
  assert.equal(collectText(tree).includes("Second thought"), true);

  // 5. Transition from streaming -> complete preserves manual expand (does not snap shut).
  tree = renderPhase("First thought\n\nSecond thought", "complete");
  assert.equal(collectText(tree).includes("Second thought"), true);
});

test("manual collapse via bottom button persists across streaming updates and streaming -> complete", () => {
  const h = createHarness({
    hostSettingsRaw: JSON.stringify({ autoExpandReasoning: true }),
    collapseReasoning: true,
  });
  const { LiveReasoningRenderer } = h.load("client/live-renderers.tsx");
  const timestamp = new Date(1_700_000_000_000);

  const renderPhase = (text, phase) =>
    h.renderTree({
      type: LiveReasoningRenderer,
      props: {
        agentId: "agent-1",
        item: { data: { text, phase } },
        theme: { colors: {} },
        timestamp,
      },
    });

  // 1. Starts expanded while streaming because Paseo's autoExpandReasoning is true.
  let tree = renderPhase("Working through steps", "streaming");
  assert.equal(collectText(tree).includes("Working through steps"), true);

  // 2. Press bottom collapse button.
  const collapseButton = h.findNodes(
    tree,
    (n) => n.type === "Pressable" && n.props.accessibilityLabel === "Collapse reasoning summary",
  )[0];
  assert.ok(collapseButton, "bottom collapse button renders when expanded");
  assert.equal(collapseButton.props.accessibilityRole, "button");
  assert.equal(collapseButton.props.accessibilityState.expanded, true);
  collapseButton.props.onPress();

  // 3. Collapsed immediately and bottom button disappears.
  tree = renderPhase("Working through steps", "streaming");
  assert.equal(collectText(tree).includes("Working through steps"), false);
  assert.equal(
    h.findNodes(
      tree,
      (n) => n.type === "Pressable" && n.props.accessibilityLabel === "Collapse reasoning summary",
    ).length,
    0,
  );

  // 4. Streaming updates keep it collapsed.
  tree = renderPhase("Working through steps\n\nMore reasoning", "streaming");
  assert.equal(collectText(tree).includes("More reasoning"), false);

  // 5. Completion preserves manual collapse (does not snap open).
  tree = renderPhase("Working through steps\n\nMore reasoning", "complete");
  assert.equal(collectText(tree).includes("More reasoning"), false);
});

test("ReasoningTrace hides bottom collapse control when body is empty and scales label with textScale", () => {
  const emptyHarness = createHarness({ scale: 1 });
  const { ReasoningTrace: EmptyTrace } = emptyHarness.load("client/components/reasoning-trace.tsx");
  const emptyTree = emptyHarness.renderTree({
    type: EmptyTrace,
    props: {
      data: {
        id: "empty",
        agentModel: "",
        durationMs: 0,
        totalTokens: 0,
        status: "thinking",
        steps: [{ id: "s1", number: 1, status: "active", content: "   " }],
      },
      tokens: emptyHarness.tokens,
      defaultExpanded: true,
    },
  });
  assert.equal(
    emptyHarness.findNodes(
      emptyTree,
      (n) => n.type === "Pressable" && n.props.accessibilityLabel === "Collapse reasoning summary",
    ).length,
    0,
    "no bottom collapse button when body content is empty",
  );

  const renderScaled = (scale) => {
    const h = createHarness({ scale });
    const { ReasoningTrace } = h.load("client/components/reasoning-trace.tsx");
    const tree = h.renderTree({
      type: ReasoningTrace,
      props: {
        data: {
          id: "trace",
          agentModel: "",
          durationMs: 1200,
          totalTokens: 42,
          status: "completed",
          steps: [{ id: "s1", number: 1, status: "completed", content: "Detailed reasoning" }],
        },
        tokens: h.tokens,
        defaultExpanded: true,
      },
    });
    const button = h.findNodes(
      tree,
      (n) => n.type === "Pressable" && n.props.accessibilityLabel === "Collapse reasoning summary",
    )[0];
    assert.ok(button);
    const labelNode = h.findNodes(button, (n) => n.type === "Text")[0];
    const iconNode = h.findNodes(button, (n) => n.type === "Glyph")[0];
    return { fontSize: labelNode.props.style.fontSize, iconSize: iconNode.props.size };
  };

  const base = renderScaled(1);
  const xl = renderScaled(1.3);
  assert.ok(xl.fontSize > base.fontSize, "bottom collapse text scales with textScale");
  assert.equal(xl.iconSize, base.iconSize, "bottom collapse chevron stays fixed size");
});
