const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve, dirname } = require("node:path");
const { runInThisContext } = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

// Run the actual components/handlers, with native primitives and hooks supplied
// by a tiny host. No navigator exists: a native copy must go through the SDK.
function harness(file, name, copyText, platform = "ios", scale = 1) {
  const state = [], timers = new Map(), cleanups = [], calls = [], toasts = [];
  let cursor = 0, timerId = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }];
    },
    useRef(value) {
      const i = cursor++;
      return state[i] ??= { current: value };
    },
    useMemo: fn => fn(), useCallback: fn => fn,
    useEffect(fn) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
  };
  const sdk = {
    copyText(text) { calls.push(text); return copyText(text); },
    useToast: () => ({ show: (message, options) => toasts.push({ message, ...options }), error: message => toasts.push({ message, variant: "error" }) }),
    Modal: Object.assign(props => ({ type: "Modal", props }), { Content: "Modal.Content" }), TextInput: "SDK.TextInput",
  };
  const cache = new Map();
  function load(path) {
    const filename = resolve(__dirname, "..", path);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} }; cache.set(filename, mod);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = id => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" };
      if (id === "react-native") return { View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", Image: "Image", Platform: { OS: platform }, StyleSheet: { create: x => x } };
      if (id === "@getpaseo/plugin/client/ui") return sdk;
      if (id === "./copy-feedback") return load(resolve(dirname(filename), id + ".tsx"));
      if (id === "./theme-tokens" || id === "../theme-tokens") return { radius: {}, withAlpha: value => value };
      if (id === "./parse") return load(resolve(dirname(filename), "parse.ts"));
      if (id === "../highlight") return { useHighlightedLines: () => null };
      if (id.startsWith(".")) return new Proxy({}, { get: (_, key) => key === "surfaceProps" ? () => ({}) : key === "detectFileType" ? () => ({}) : key });
      return createRequire(filename)(id);
    };
    runInThisContext(`(function(require,module,exports,setTimeout,clearTimeout,navigator){${source}\n})`, { filename })(
      localRequire, mod, mod.exports, fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id), undefined,
    );
    return mod.exports;
  }
  const Component = load(file)[name];
  const fs = n => Math.round(n * scale * 2) / 2;
  // Mirrors buildThemeTokens: one code size (12, scaled) at 1.5 leading.
  const tokens = new Proxy({ fs, textScale: scale, leading: 1, codeFontSize: fs(12), codeLineHeight: Math.round(fs(12) * 1.5) }, { get: (o, k) => o[k] ?? (k === "syntax" ? {} : "#aaaaaa") });
  const text = "Full text\n日本語 / 中文\n```ts\nconst a = 1;\n```\n  ";
  const props = { text, code: text, language: "typescript", tokens, at: new Date() };
  function render() { cursor = 0; return Component(props); }
  function nodes(tree, predicate) {
    if (!tree || typeof tree !== "object") return [];
    if (Array.isArray(tree)) return tree.flatMap(t => nodes(t, predicate));
    if (typeof tree.type === "function") return nodes(tree.type(tree.props), predicate);
    return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
  }
  return { render, nodes, calls, toasts, text, props, timers, cleanups };
}

const components = [
  ["client/components/turn-footer.tsx", "AssistantFooter", "Copy reply"],
  ["client/components/user-message.tsx", "UserMessage", "Copy prompt"],
  ["client/components/syntax-highlight.tsx", "SyntaxHighlightBlock", "Copy code"],
];
for (const [file, name, label] of components) {
  test(`${name}: native press copies verbatim, reports success only after SDK resolves`, async () => {
    let finish;
    const h = harness(file, name, () => new Promise(resolve => { finish = resolve; }));
    const button = h.nodes(h.render(), n => n.type === "Pressable" && n.props.accessibilityLabel === label)[0];
    assert.ok(button, "accessible copy control exists");
    const style = Object.assign({}, ...[button.props.style].flat());
    assert.ok(style.minWidth >= 44 && style.minHeight >= 44, "native touch target is at least 44 points");
    const pending = button.props.onPress();
    assert.deepEqual(h.calls, [h.text]);
    assert.equal(h.toasts.length, 0);
    finish(); await pending;
    assert.equal(h.toasts[0]?.variant, "success");
    assert.match(h.toasts[0]?.message, /copied/i);
    assert.equal(h.nodes(h.render(), n => n.type === "Modal").length, 0);
  });
  for (const synchronous of [false, true]) {
    test(`${name}: ${synchronous ? "throw" : "rejection"} shows error and readonly full-text fallback`, async () => {
      const h = harness(file, name, () => { if (synchronous) throw new Error("Unavailable"); return Promise.reject(new Error("Denied")); });
      const button = h.nodes(h.render(), n => n.type === "Pressable" && n.props.accessibilityLabel === label)[0];
      assert.ok(button);
      await button.props.onPress();
      assert.deepEqual(h.calls, [h.text]);
      assert.equal(h.toasts[0]?.variant, "error");
      assert.match(h.toasts[0]?.message, /could not copy/i);
      assert.equal(h.toasts.some(t => t.variant === "success"), false);
      const tree = h.render();
      const modal = h.nodes(tree, n => n.type === "Modal")[0];
      assert.equal(modal?.props.open, true);
      const input = h.nodes(tree, n => n.type === "SDK.TextInput")[0];
      assert.equal(input?.props.value, h.text, "includes unicode, markdown and trailing whitespace");
      assert.equal(input?.props.multiline, true);
      assert.equal(input?.props.readOnly, true);
      assert.equal(input?.props.selectTextOnFocus, true);
      h.props.text = h.props.code = "Changed during streaming";
      assert.equal(h.nodes(h.render(), n => n.type === "SDK.TextInput")[0]?.props.value, h.text, "fallback keeps the pressed text");
      modal.props.onOpenChange(false);
      assert.equal(h.nodes(h.render(), n => n.type === "Modal").length, 0);
    });
  }
}


for (const [file, name] of components) {
  test(`${name}: Large and XL enlarge visible text and line heights without enlarging icons`, () => {
    const rendered = scale => {
      const h = harness(file, name, async () => {}, "ios", scale);
      const tree = h.render();
      const styles = h.nodes(tree, n => n.type === "Text").map(n => Object.assign({}, ...[n.props.style].flat())).filter(s => s.fontSize);
      const icons = h.nodes(tree, n => n.type === "Glyph").map(n => n.props.size);
      return { styles, icons };
    };
    const base = rendered(1);
    assert.ok(base.styles.length > 0);
    assert.ok(base.icons.length > 0);
    for (const scale of [1.15, 1.3]) {
      const large = rendered(scale);
      assert.deepEqual(large.icons, base.icons);
      assert.equal(large.styles.length, base.styles.length);
      large.styles.forEach((style, i) => {
        assert.ok(style.fontSize > base.styles[i].fontSize);
        if (base.styles[i].lineHeight) assert.ok(style.lineHeight > base.styles[i].lineHeight);
      });
    }
  });
}

for (const variant of ["document", "compact", "terminal"]) {
  test(`markdown ${variant}: body, heading and line heights scale, task icon stays the same size`, () => {
    const rendered = scale => {
      const h = harness("client/components/markdown/markdown-view.tsx", "MarkdownView", async () => {}, "ios", scale);
      h.props.variant = variant;
      h.props.text = "# Heading\n\nBody text\n\n- [x] Task text";
      const tree = h.render();
      const styles = h.nodes(tree, n => n.type === "Text").map(n => Object.assign({}, ...[n.props.style].flat())).filter(s => s.fontSize);
      return { styles, icons: h.nodes(tree, n => n.type === "Glyph").map(n => n.props.size) };
    };
    const base = rendered(1);
    assert.ok(base.styles.length >= 3);
    assert.ok(base.icons.length > 0);
    for (const scale of [1.15, 1.3]) {
      const large = rendered(scale);
      assert.deepEqual(large.icons, base.icons);
      large.styles.forEach((style, i) => {
        assert.ok(style.fontSize > base.styles[i].fontSize);
        if (base.styles[i].lineHeight) assert.ok(style.lineHeight > base.styles[i].lineHeight);
      });
    }
  });
}
