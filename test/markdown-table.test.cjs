const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve, dirname } = require("node:path");
const { runInThisContext } = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function loadTs(relPath, mocks = {}) {
  const cache = new Map();
  function load(target) {
    const filename = resolve(__dirname, "..", target);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const localRequire = (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith(".")) {
        const base = resolve(dirname(filename), id);
        for (const ext of [".ts", ".tsx"]) {
          try {
            readFileSync(base + ext, "utf8");
            return load(base + ext);
          } catch {
            // Try next extension.
          }
        }
        return new Proxy({}, { get: (_, key) => key });
      }
      return createRequire(filename)(id);
    };
    runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(
      localRequire,
      mod,
      mod.exports,
    );
    return mod.exports;
  }
  return load(relPath);
}

const {
  fitColumnWidths,
  MIN_FIT_COLUMN,
  TABLE_END_PADDING,
} = loadTs("client/components/markdown/table-layout.ts");

function renderMarkdownTable(markdown, { platform = "web", textScale = 1, variant = "document" } = {}) {
  const state = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [
        state[i],
        (value) => {
          state[i] = typeof value === "function" ? value(state[i]) : value;
        },
      ];
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  };
  const { MarkdownView } = loadTs("client/components/markdown/markdown-view.tsx", {
    react,
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
      Fragment: "Fragment",
    },
    "react-native": {
      View: "View",
      Text: "Text",
      ScrollView: "ScrollView",
      Platform: { OS: platform },
      StyleSheet: { create: (x) => x },
    },
    "../glyph": { Glyph: "Glyph" },
    "../theme-tokens": { radius: { chip: 4 }, withAlpha: (value) => value },
    "../selection": { selectableSurface: {}, unselectable: {} },
    "../selection-actions": { selectionSurface: {} },
    "../syntax-highlight": { SyntaxHighlightBlock: "SyntaxHighlightBlock" },
    "../open-link": { isAllowedLink: () => false, openLink: () => {} },
    "../path-link-menu": { pathTargetProps: () => null },
    "./markdown-image": { MarkdownImage: "MarkdownImage" },
  });

  const fs = (n) => Math.round(n * textScale * 2) / 2;
  const tokens = new Proxy(
    {
      fs,
      textScale,
      leading: 1,
      codeFontSize: fs(12),
      codeLineHeight: Math.round(fs(12) * 1.5),
      isDark: true,
    },
    { get: (o, k) => o[k] ?? "#aaaaaa" },
  );

  const expand = (node) => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === "function") return expand(node.type(node.props));
    if (node.props && "children" in node.props) {
      return { ...node, props: { ...node.props, children: expand(node.props.children) } };
    }
    return node;
  };
  const findAll = (node, predicate) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((n) => findAll(n, predicate));
    return [...(predicate(node) ? [node] : []), ...findAll(node.props?.children, predicate)];
  };

  function render() {
    cursor = 0;
    return expand(MarkdownView({ text: markdown, tokens, variant }));
  }

  return { render, findAll };
}

test("fitColumnWidths: null width keeps natural widths and enables scroll to prevent frame-1 overflow", () => {
  const natural = [120, 240, 180];
  const result = fitColumnWidths(natural, null, 18);
  assert.deepEqual(result, { widths: [120, 240, 180], scroll: true });
  assert.notEqual(result.widths, natural, "does not return input array by reference");
});

test("fitColumnWidths: 0-column table returns empty widths without scrolling", () => {
  assert.deepEqual(fitColumnWidths([], null, 18), { widths: [], scroll: false });
  assert.deepEqual(fitColumnWidths([], 300, 18), { widths: [], scroll: false });
  assert.deepEqual(fitColumnWidths([], 0, 18), { widths: [], scroll: false });
});

test("fitColumnWidths: 1-column table fits wide column and scrolls when narrower than minimum", () => {
  // Fits naturally (usable = 300 - 6 = 294 >= 200)
  assert.deepEqual(fitColumnWidths([200], 300, 18), { widths: [200], scroll: false });
  // Shrinks to usable (usable = 120 - 6 = 114 >= 44)
  assert.deepEqual(fitColumnWidths([200], 120, 18), { widths: [114], scroll: false });
  // Falls back to scroll when usable < MIN_FIT_COLUMN (usable = 49 - 6 = 43 < 44)
  assert.deepEqual(fitColumnWidths([200], 49, 18), { widths: [200], scroll: true });
});

test("fitColumnWidths: natural fit keeps column widths unchanged with scroll disabled", () => {
  const natural = [60, 120, 90];
  // usable = 320 - 6 - 18 * 2 = 278 >= 270
  const result = fitColumnWidths(natural, 320, 18);
  assert.deepEqual(result, { widths: [60, 120, 90], scroll: false });
});

test("fitColumnWidths: water-fill keeps narrow columns intact while wide columns share remainder", () => {
  const natural = [40, 220, 220];
  // usable = 226 - 6 - 10 * 2 = 200; fair share = 66.67.
  // Column 0 (40 <= 66.67) keeps 40; remaining 160 splits evenly -> 80, 80.
  const result = fitColumnWidths(natural, 226, 10);
  assert.deepEqual(result, { widths: [40, 80, 80], scroll: false });
  assert.deepEqual(natural, [40, 220, 220], "input array is not mutated");

  // Multi-step water-fill: column 0 (50) fixes first -> remaining 250 / 3 = 83.33,
  // column 1 (75 <= 83.33) fixes second -> remaining 175 / 2 = 87.5 -> floored to 87.
  const multi = [50, 75, 240, 260];
  // usable = 336 - 6 - 10 * 3 = 300
  const multiResult = fitColumnWidths(multi, 336, 10);
  assert.deepEqual(multiResult, { widths: [50, 75, 87, 87], scroll: false });
});

test("fitColumnWidths: scroll fallback threshold boundary and non-positive usable width", () => {
  const natural = [120, 120, 120];
  const gap = 10;
  // Exact threshold: usable = 3 * 44 = 132 -> available = 132 + 6 + 20 = 158
  const exactAvailable = MIN_FIT_COLUMN * 3 + TABLE_END_PADDING + gap * 2;
  assert.deepEqual(fitColumnWidths(natural, exactAvailable, gap), {
    widths: [MIN_FIT_COLUMN, MIN_FIT_COLUMN, MIN_FIT_COLUMN],
    scroll: false,
  });

  // 1px below threshold -> scroll fallback preserves natural widths
  assert.deepEqual(fitColumnWidths(natural, exactAvailable - 1, gap), {
    widths: [120, 120, 120],
    scroll: true,
  });

  // Non-positive usable width -> scroll fallback
  assert.deepEqual(fitColumnWidths(natural, 20, gap), {
    widths: [120, 120, 120],
    scroll: true,
  });
});

test("fitColumnWidths: scales minimum fit width with textScale so large text scrolls instead of crushing", () => {
  const natural = [140, 140, 140];
  const gap = 12;
  // usable = 180 - 6 - 24 = 150 -> 50px per column
  const available = 180;

  // At 1x textScale (min = 44): 50 >= 44 -> fits
  assert.deepEqual(
    fitColumnWidths(natural, available, gap, Math.round(MIN_FIT_COLUMN * 1)),
    { widths: [50, 50, 50], scroll: false },
  );

  // At 1.3x textScale (min = 57): 50 < 57 -> scrolls
  assert.deepEqual(
    fitColumnWidths(natural, available, gap, Math.round(MIN_FIT_COLUMN * 1.3)),
    { widths: [140, 140, 140], scroll: true },
  );
});

test("fitColumnWidths: floors fractional widths to whole pixels so total never exceeds usable width", () => {
  const natural = [150, 150, 150];
  const gap = 10;
  // usable = 200 - 6 - 20 = 174; wait 175 -> 175 / 3 = 58.333... -> floor = 58
  const available = 201;
  const usable = available - TABLE_END_PADDING - gap * 2;
  const result = fitColumnWidths(natural, available, gap);
  assert.equal(result.scroll, false);
  assert.deepEqual(result.widths, [58, 58, 58]);
  assert.ok(result.widths.every((w) => Number.isInteger(w)));
  assert.ok(result.widths.reduce((a, b) => a + b, 0) <= usable);
});

test("MarkdownView table keeps a single ScrollView across layout transitions and scales min width with textScale", () => {
  const md = [
    "| Key | Description | Path |",
    "| --- | --- | --- |",
    "| id | A fairly long description of the setting | /very/long/path/to/configuration/file.ts |",
  ].join("\n");

  const h = renderMarkdownTable(md, { textScale: 1 });
  // Frame 1 (before onLayout): single ScrollView with scrollEnabled & indicator true
  const initialTree = h.render();
  const outer = h.findAll(initialTree, (n) => n.type === "View" && typeof n.props?.onLayout === "function")[0];
  const scrollBefore = h.findAll(initialTree, (n) => n.type === "ScrollView");
  assert.ok(outer, "table measures available width with onLayout");
  assert.equal(scrollBefore.length, 1);
  assert.equal(scrollBefore[0].props.scrollEnabled, true);
  assert.equal(scrollBefore[0].props.showsHorizontalScrollIndicator, true);

  // Card width 300: fits without scrolling, still the same single ScrollView
  outer.props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  const fittedTree = h.render();
  const scrollFitted = h.findAll(fittedTree, (n) => n.type === "ScrollView");
  assert.equal(scrollFitted.length, 1);
  assert.equal(scrollFitted[0].props.scrollEnabled, false);
  assert.equal(scrollFitted[0].props.showsHorizontalScrollIndicator, false);

  // Very narrow card width 150: falls back to scrolling with discoverable indicator
  outer.props.onLayout({ nativeEvent: { layout: { width: 150 } } });
  const narrowTree = h.render();
  const scrollNarrow = h.findAll(narrowTree, (n) => n.type === "ScrollView");
  assert.equal(scrollNarrow.length, 1);
  assert.equal(scrollNarrow[0].props.scrollEnabled, true);
  assert.equal(scrollNarrow[0].props.showsHorizontalScrollIndicator, true);

  // At 1.3x textScale, a 215px card (usable ~162, 54px/col < 57px min) scrolls
  const hLarge = renderMarkdownTable(md, { textScale: 1.3 });
  const largeOuter = hLarge.findAll(hLarge.render(), (n) => n.type === "View" && typeof n.props?.onLayout === "function")[0];
  largeOuter.props.onLayout({ nativeEvent: { layout: { width: 215 } } });
  const largeScroll = hLarge.findAll(hLarge.render(), (n) => n.type === "ScrollView")[0];
  assert.equal(largeScroll.props.scrollEnabled, true);
  assert.equal(largeScroll.props.showsHorizontalScrollIndicator, true);
});
