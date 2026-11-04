const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, resolve } = require("node:path");
const { runInThisContext } = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

// The real parser, renderer and link opener, with native primitives stubbed.
// `MarkdownImage` stays a named stub, so a drawn picture is a node of that type.
function harness() {
  const opened = [];
  const cache = new Map();
  function load(path) {
    const filename = resolve(__dirname, "..", path);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} }; cache.set(filename, mod);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = id => {
      if (id === "react") return { useMemo: fn => fn() };
      if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" };
      if (id === "react-native") {
        return {
          View: "View", Text: "Text", ScrollView: "ScrollView", Platform: { OS: "ios" }, StyleSheet: { create: x => x },
          Linking: { openURL: url => { opened.push(url); return Promise.resolve(); } },
        };
      }
      if (id === "../theme-tokens") return { radius: {}, withAlpha: value => value };
      if (id === "./parse") return load(resolve(dirname(filename), "parse.ts"));
      if (id === "../open-link") return load(resolve(dirname(filename), "../open-link.ts"));
      if (id.startsWith(".")) return new Proxy({}, { get: (_, key) => key === "pathTargetProps" ? () => null : key });
      return createRequire(filename)(id);
    };
    runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, mod, mod.exports);
    return mod.exports;
  }
  const { MarkdownView } = load("client/components/markdown/markdown-view.tsx");
  const parse = load("client/components/markdown/parse.ts");
  const tokens = new Proxy({ textScale: 1, codeFontSize: 12, codeLineHeight: 18 }, { get: (o, k) => o[k] ?? "#aaaaaa" });
  function render(text) {
    const revealed = [];
    const tree = MarkdownView({ text, tokens, variant: "document", cwd: "/work", onRevealFile: path => revealed.push(path) });
    return { tree, revealed };
  }
  function nodes(tree, predicate) {
    if (!tree || typeof tree !== "object") return [];
    if (Array.isArray(tree)) return tree.flatMap(t => nodes(t, predicate));
    return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
  }
  const images = tree => nodes(tree, n => n.type === "MarkdownImage").map(n => ({ src: n.props.src, alt: n.props.alt }));
  return { parse, render, nodes, images, opened };
}

const h = harness();

test("parser: a bare file URL is a link, its trailing full stop stays prose", () => {
  assert.deepEqual(h.parse.parseMarkdown("Saved to file:///tmp/out/a%20b.png.")[0].spans, [
    { kind: "text", text: "Saved to " },
    { kind: "link", href: "file:///tmp/out/a%20b.png", spans: [{ kind: "text", text: "file:///tmp/out/a%20b.png" }] },
    { kind: "text", text: "." },
  ]);
});

test("parser: an image target keeps its spaces, with or without angle brackets", () => {
  for (const text of ["![x](/tmp/my image.png)", "![x](</tmp/my image.png>)", "![x](/tmp/my image.png \"Title\")"]) {
    assert.deepEqual(h.parse.parseMarkdown(text)[0].spans, [{ kind: "image", src: "/tmp/my image.png", alt: "x" }], text);
  }
  assert.equal(h.parse.parseMarkdown("[t](https://a.com \"Title\")")[0].spans[0].href, "https://a.com");
});

test("parser: prose with slashes and equals signs stays prose", () => {
  for (const text of ["and/or 2024/01", "if a == b", "profile notes"]) {
    assert.deepEqual(h.parse.parseMarkdown(text)[0].spans, [{ kind: "text", text }], text);
  }
});

test("localPathFromHref: decodes file URLs and refuses every other scheme", () => {
  const { localPathFromHref } = h.parse;
  assert.equal(localPathFromHref("file:///tmp/a%20b.png"), "/tmp/a b.png");
  assert.equal(localPathFromHref("file://localhost/C:/Users/A%20B/x.webp"), "C:/Users/A B/x.webp");
  assert.equal(localPathFromHref("/abs/path.png"), "/abs/path.png");
  assert.equal(localPathFromHref("~/Pictures/out.JPEG"), "~/Pictures/out.JPEG");
  assert.equal(localPathFromHref("C:\\out\\x.png"), "C:\\out\\x.png");
  assert.equal(localPathFromHref("out/image.png"), "out/image.png");
  for (const href of ["javascript:alert(1)", "sandbox:/mnt/data/x.png", "https://e.com/a.png", "mailto:a@b.c", "#top", "notes"]) {
    assert.equal(localPathFromHref(href), null, href);
  }
});

test("render: a paragraph that is only an image path, file URL or file link draws the image", () => {
  const cases = [
    ["/tmp/out/image.png", { src: "/tmp/out/image.png", alt: "" }],
    ["file:///tmp/out/image.png", { src: "file:///tmp/out/image.png", alt: "" }],
    ["~/Pictures/OUT.JPEG", { src: "~/Pictures/OUT.JPEG", alt: "" }],
    ["[sunset.webp](/abs/sunset.webp)", { src: "/abs/sunset.webp", alt: "sunset.webp" }],
  ];
  for (const [text, image] of cases) assert.deepEqual(h.images(h.render(text).tree), [image], text);
});

test("render: an image path inside a sentence, or a web image link, stays a link", () => {
  for (const text of ["Saved to /tmp/out/image.png", "See https://e.com/a.png", "[a](https://e.com/a.png)"]) {
    assert.deepEqual(h.images(h.render(text).tree), [], text);
  }
});

test("render: a markdown image inside a list item or quote draws, not just its alt text", () => {
  const list = h.render("- First: ![gen](file:///tmp/a.png)\n- [x] ![done](/tmp/b.gif)").tree;
  assert.deepEqual(h.images(list), [{ src: "file:///tmp/a.png", alt: "gen" }, { src: "/tmp/b.gif", alt: "done" }]);
  const prose = h.nodes(list, n => n.type === "Text" && n.props.children?.[0] === "First: ");
  assert.equal(prose.length, 1, "the prose before the image is kept");
  assert.deepEqual(h.images(h.render("> ![q](/tmp/q.gif)").tree), [{ src: "/tmp/q.gif", alt: "q" }]);
});

test("render: a file URL or local path link reveals the file and never reaches the opener", () => {
  const { tree, revealed } = h.render("Open [the file](file:///tmp/a%20b.txt), [notes](docs/notes.md), [js](javascript:alert(1)) or [site](https://e.com).");
  const links = h.nodes(tree, n => n.type === "Text" && n.props.accessibilityRole === "link");
  assert.equal(links.length, 4);
  const event = { preventDefault() {} };
  for (const link of links) link.props.onPress(event);
  assert.deepEqual(revealed, ["/tmp/a b.txt", "docs/notes.md"]);
  assert.deepEqual(h.opened, ["https://e.com"], "only the web link reaches the opener");
  // The wording depends on the platform (a reveal on web, a path sheet on native).
  assert.match(links[0].props.accessibilityLabel, /\/tmp\/a b\.txt/);
});
