const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve, dirname } = require("node:path");
const { runInThisContext } = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function loadTs(relPath, mocks = {}, globals = {}) {
  const cache = new Map();
  function load(target) {
    const filename = resolve(__dirname, "..", target);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
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
    const keys = Object.keys(globals);
    const values = keys.map((k) => globals[k]);
    runInThisContext(`(function(require,module,exports${keys.length ? "," + keys.join(",") : ""}){${source}\n})`, {
      filename,
    })(localRequire, mod, mod.exports, ...values);
    return mod.exports;
  }
  return load(relPath);
}

const {
  classifyMarkdownLink,
  isExternalLink,
  normalizeFileUrl,
} = loadTs("client/components/markdown/link-target.ts");

function renderMarkdown(
  markdown,
  {
    platform = "web",
    cwd = "/workspace/project",
    onRevealFile,
    menuAvailable = true,
  } = {},
) {
  const openedExternal = [];
  const menuCalls = [];
  const revealed = [];
  const revealHandler = onRevealFile ?? ((p) => revealed.push(p));

  const react = {
    useState: (initial) => [initial, () => {}],
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
    "../open-link": {
      openLink: (url) => openedExternal.push(url),
    },
    "../path-link-menu": {
      pathTargetProps: () => null,
      openPathLinkMenu: (path, event, linkCwd) => {
        menuCalls.push({ path, event, cwd: linkCwd });
        return menuAvailable && platform === "web";
      },
    },
    "./markdown-image": { MarkdownImage: "MarkdownImage" },
  });

  const tokens = new Proxy(
    {
      fs: (n) => n,
      textScale: 1,
      leading: 1,
      codeFontSize: 12,
      codeLineHeight: 18,
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
  const textOf = (node) => {
    if (typeof node === "string") return node;
    if (!node || typeof node !== "object") return "";
    if (Array.isArray(node)) return node.map(textOf).join("");
    return textOf(node.props?.children);
  };

  const tree = expand(
    MarkdownView({
      text: markdown,
      tokens,
      variant: "document",
      cwd,
      onRevealFile: revealHandler,
    }),
  );

  return { tree, findAll, textOf, openedExternal, menuCalls, revealed };
}

test("classifyMarkdownLink: external http, https, and mailto URLs", () => {
  assert.deepEqual(classifyMarkdownLink("https://example.com/docs?q=1"), {
    kind: "external",
    url: "https://example.com/docs?q=1",
  });
  assert.deepEqual(classifyMarkdownLink("http://localhost:8080/status"), {
    kind: "external",
    url: "http://localhost:8080/status",
  });
  assert.deepEqual(classifyMarkdownLink("mailto:user@example.com"), {
    kind: "external",
    url: "mailto:user@example.com",
  });
  assert.equal(isExternalLink("https://example.com"), true);
  assert.equal(isExternalLink("mailto:user@example.com"), true);
  assert.equal(isExternalLink("file:///tmp/a.md"), false);
});

test("classifyMarkdownLink & normalizeFileUrl: local paths and file:// URLs", () => {
  assert.deepEqual(classifyMarkdownLink("/tmp/guide.md"), {
    kind: "file",
    path: "/tmp/guide.md",
  });
  assert.deepEqual(classifyMarkdownLink("/tmp/guide.md#L10-L20"), {
    kind: "file",
    path: "/tmp/guide.md#L10-L20",
  });
  assert.deepEqual(classifyMarkdownLink("file:///tmp/my%20image.png"), {
    kind: "file",
    path: "/tmp/my image.png",
  });
  assert.deepEqual(classifyMarkdownLink("file:///tmp/guide.md#L10-L20"), {
    kind: "file",
    path: "/tmp/guide.md#L10-L20",
  });
  assert.deepEqual(classifyMarkdownLink("file://localhost/tmp/guide.md"), {
    kind: "file",
    path: "/tmp/guide.md",
  });
  assert.deepEqual(classifyMarkdownLink("file:///C:/Users/a/doc.md"), {
    kind: "file",
    path: "C:/Users/a/doc.md",
  });
  assert.deepEqual(classifyMarkdownLink("file:///C:/Users/a/my%20doc.md#L5-L9"), {
    kind: "file",
    path: "C:/Users/a/my doc.md#L5-L9",
  });
  assert.deepEqual(classifyMarkdownLink("C:\\foo\\bar.md"), {
    kind: "file",
    path: "C:\\foo\\bar.md",
  });
  assert.deepEqual(classifyMarkdownLink("./README.md"), {
    kind: "file",
    path: "./README.md",
  });
  assert.deepEqual(classifyMarkdownLink("../docs/guide.md:42"), {
    kind: "file",
    path: "../docs/guide.md:42",
  });
  assert.deepEqual(classifyMarkdownLink("~/notes.md"), {
    kind: "file",
    path: "~/notes.md",
  });
  assert.equal(normalizeFileUrl("file:///tmp/%ZZ"), null);
  assert.equal(normalizeFileUrl("file:///"), null);
});

test("classifyMarkdownLink: strictly rejects unsafe schemes and non-path targets", () => {
  const rejected = [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "blob:https://example.com/1234",
    "ftp://example.com/file.txt",
    "about:blank",
    "//evil.example/path",
    "#section-heading",
    "?query=1",
    "",
  ];
  for (const href of rejected) {
    assert.deepEqual(
      classifyMarkdownLink(href),
      { kind: "unsafe" },
      `expected ${JSON.stringify(href)} to be rejected`,
    );
  }
});

test("MarkdownView: external links open via openLink on left-click", () => {
  const md = "[Docs](https://example.com/docs) [Local](http://localhost:3000) [Email](mailto:a@b.com)";
  const h = renderMarkdown(md, { platform: "web" });
  const links = h.findAll(h.tree, (n) => n.type === "Text" && n.props?.accessibilityRole === "link");
  assert.equal(links.length, 3);
  assert.deepEqual(
    links.map((n) => n.props.href),
    ["https://example.com/docs", "http://localhost:3000", "mailto:a@b.com"],
  );

  let prevented = 0;
  for (const link of links) {
    link.props.onPress({ preventDefault: () => { prevented += 1; } });
  }
  assert.equal(prevented, 3);
  assert.deepEqual(h.openedExternal, [
    "https://example.com/docs",
    "http://localhost:3000",
    "mailto:a@b.com",
  ]);
  assert.equal(h.menuCalls.length, 0);
  assert.equal(h.revealed.length, 0);
});

test("MarkdownView: labeled local file links open path menu on web left-click and fall back to onRevealFile on native", () => {
  const cases = [
    ["[Guide](/tmp/guide.md)", "Guide", "/tmp/guide.md"],
    ["[Image](file:///tmp/my%20image.png)", "Image", "/tmp/my image.png"],
    ["[WinUrl](file:///C:/Users/a/doc.md)", "WinUrl", "C:/Users/a/doc.md"],
    ["[WinPath](C:\\foo\\bar.md)", "WinPath", "C:\\foo\\bar.md"],
    ["[README](./README.md)", "README", "./README.md"],
  ];

  for (const [md, label, expectedPath] of cases) {
    // Web with path menu installed: opens path menu at click position, sets bcpath, no href
    const web = renderMarkdown(md, { platform: "web", cwd: "/repo", menuAvailable: true });
    const webLink = web.findAll(web.tree, (n) => n.type === "Text" && n.props?.accessibilityRole === "link")[0];
    assert.ok(webLink, `web link rendered for ${md}`);
    assert.equal(web.textOf(webLink), label);
    assert.equal(webLink.props.href, undefined, "local file link must not emit a navigable href");
    assert.equal(webLink.props.dataSet?.bcpath, expectedPath);

    let prevented = false;
    const pressEvent = {
      preventDefault: () => { prevented = true; },
      nativeEvent: { clientX: 120, clientY: 240 },
    };
    webLink.props.onPress(pressEvent);
    assert.equal(prevented, true);
    assert.equal(web.openedExternal.length, 0);
    assert.equal(web.revealed.length, 0, "does not double-fire onRevealFile when path menu handled press");
    assert.deepEqual(web.menuCalls, [{ path: expectedPath, event: pressEvent, cwd: "/repo" }]);

    // Native (no path menu): falls back to onRevealFile with normalized path
    const native = renderMarkdown(md, { platform: "ios", cwd: "/repo", menuAvailable: false });
    const nativeLink = native.findAll(native.tree, (n) => n.type === "Text" && n.props?.accessibilityRole === "link")[0];
    assert.ok(nativeLink, `native link rendered for ${md}`);
    nativeLink.props.onPress({});
    assert.equal(native.openedExternal.length, 0);
    assert.deepEqual(native.revealed, [expectedPath]);
  }
});

test("MarkdownView: unsafe schemes render as inert text with no link role, href, bcpath, or onPress", () => {
  const md = "[Click](javascript:alert(1)) and [Html](data:text/html,<script>alert(1)</script>)";
  const h = renderMarkdown(md, { platform: "web" });
  const links = h.findAll(h.tree, (n) => n.props?.accessibilityRole === "link");
  const withHref = h.findAll(h.tree, (n) => n.props?.href !== undefined);
  const withBcpath = h.findAll(h.tree, (n) => n.props?.dataSet?.bcpath !== undefined);
  const withPress = h.findAll(h.tree, (n) => typeof n.props?.onPress === "function");

  assert.equal(links.length, 0);
  assert.equal(withHref.length, 0);
  assert.equal(withBcpath.length, 0);
  assert.equal(withPress.length, 0);
  assert.equal(h.textOf(h.tree), "Click and Html");
});

test("openLink: uses SDK openExternalUrl for http(s), falls back for mailto and rejections, and blocks unsafe schemes", async () => {
  const sdkCalls = [];
  const desktopCalls = [];
  const windowOpenCalls = [];
  let shouldReject = false;

  const prevDesktop = globalThis.paseoDesktop;
  const prevOpen = globalThis.open;
  globalThis.paseoDesktop = { opener: { openUrl: (u) => desktopCalls.push(u) } };
  globalThis.open = (u) => windowOpenCalls.push(u);

  try {
    const { openLink } = loadTs("client/components/open-link.ts", {
      "react-native": {
        Platform: { OS: "web" },
        Linking: { openURL: async () => {} },
      },
      "@getpaseo/plugin/client": {
        openExternalUrl: (url) => {
          sdkCalls.push(url);
          return shouldReject ? Promise.reject(new Error("unavailable")) : Promise.resolve();
        },
      },
    });

    openLink("https://example.com");
    openLink("http://localhost:4000");
    assert.deepEqual(sdkCalls, ["https://example.com", "http://localhost:4000"]);
    assert.deepEqual(desktopCalls, []);

    // mailto bypasses HTTP(S)-only openExternalUrl and uses desktop opener
    openLink("mailto:dev@example.com");
    assert.deepEqual(desktopCalls, ["mailto:dev@example.com"]);

    // Unsafe schemes never reach any sink
    openLink("javascript:alert(1)");
    openLink("data:text/html,hi");
    openLink("file:///tmp/secret.txt");
    assert.equal(sdkCalls.length, 2);
    assert.equal(desktopCalls.length, 1);
    assert.equal(windowOpenCalls.length, 0);

    // Rejected openExternalUrl falls back to desktop opener
    shouldReject = true;
    openLink("https://fallback.example");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(desktopCalls, ["mailto:dev@example.com", "https://fallback.example"]);
  } finally {
    if (prevDesktop === undefined) delete globalThis.paseoDesktop;
    else globalThis.paseoDesktop = prevDesktop;
    if (prevOpen === undefined) delete globalThis.open;
    else globalThis.open = prevOpen;
  }
});

test("installPathLinkMenu + openPathLinkMenu: opens path menu at pointer position on left-click and cleans up", () => {
  function makeEl(tag) {
    const props = new Map();
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      className: "",
      textContent: "",
      children: [],
      offsetWidth: 200,
      offsetHeight: 100,
      open: false,
      style: {
        display: "",
        setProperty: (k, v) => props.set(k, v),
        getPropertyValue: (k) => props.get(k) ?? "",
      },
      setAttribute: (k, v) => attrs.set(k, v),
      getAttribute: (k) => attrs.get(k) ?? null,
      appendChild: (child) => { el.children.push(child); return child; },
      append: (...kids) => { el.children.push(...kids); },
      replaceChildren: (...kids) => { el.children = [...kids]; },
      addEventListener: (ev, fn) => { listeners.set(ev, fn); },
      remove: () => {},
      close: () => { el.open = false; },
      attachShadow: () => ({
        children: [],
        append: (...kids) => { el.shadowChildren = kids; },
      }),
      closest: (sel) => (sel === "[data-bcagent]" ? el.surface ?? null : sel === "[data-bcpath]" ? el : null),
      _props: props,
    };
    return el;
  }

  const body = makeEl("body");
  const docListeners = new Map();
  const winListeners = new Map();
  const fakeDocument = {
    body,
    createElement: (tag) => makeEl(tag),
    getSelection: () => ({ isCollapsed: true, toString: () => "" }),
    addEventListener: (ev, fn) => docListeners.set(ev, fn),
    removeEventListener: (ev) => docListeners.delete(ev),
  };
  const fakeWindow = {
    innerWidth: 1024,
    innerHeight: 768,
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: (ev, fn) => winListeners.set(ev, fn),
    removeEventListener: (ev) => winListeners.delete(ev),
  };

  const { installPathLinkMenu, openPathLinkMenu } = loadTs(
    "client/components/path-link-menu.ts",
    {
      "react-native": { Platform: { OS: "web" } },
      "@getpaseo/plugin/client/ui": { copyText: async () => {} },
      "../preferences": {
        getEnhancerPreferences: () => ({ confirmOpenPath: true }),
        updateEnhancerPreferences: () => {},
      },
      "./theme-tokens": { radius: { block: 8, chip: 4 } },
    },
    {
      document: fakeDocument,
      window: fakeWindow,
      getComputedStyle: () => ({ color: "rgb(230, 230, 230)" }),
    },
  );

  // Before installation, openPathLinkMenu returns false so callers fall back
  assert.equal(openPathLinkMenu("/tmp/guide.md", {}), false);

  const dispose = installPathLinkMenu({ rpc: async () => ({ revealed: null, launch: null, policy: null, error: null }) });
  const surface = makeEl("div");
  surface.setAttribute("data-bcagent", "agent-1");
  surface.setAttribute("data-bccwd", "/workspace/repo");
  const linkEl = makeEl("span");
  linkEl.surface = surface;

  const handled = openPathLinkMenu("./README.md", {
    currentTarget: linkEl,
    nativeEvent: { clientX: 150, clientY: 220 },
  });
  assert.equal(handled, true);

  const host = body.children[0];
  const menu = host.shadowChildren[1];
  assert.equal(host._props.get("display"), "block");
  assert.equal(host._props.get("left"), "150px");
  assert.equal(host._props.get("top"), "220px");
  assert.deepEqual(
    menu.children.map((b) => b.textContent),
    ["Copy Path", "Open in Default App", "Show in File Manager"],
  );

  dispose();
  assert.equal(openPathLinkMenu("/tmp/guide.md", {}), false);
});
