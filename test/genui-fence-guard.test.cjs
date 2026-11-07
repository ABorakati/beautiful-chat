// The assistant transformer must hand messages carrying generative-UI fences
// back to the host, so the generative-UI plugin's timeline items can render.
// Equivalence with that plugin's fence detection was verified against its
// findFences implementation (19 cases) — this locks the guard's behavior in.
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Load the transformer's guard the same way the bundle does: extract the
// GENUI_FENCE constant from index.client.tsx and evaluate it.
const source = fs.readFileSync(path.join(__dirname, "..", "index.client.tsx"), "utf8");
const match = source.match(/const GENUI_FENCE = (\/.+\/[a-z]*);/);
assert.ok(match, "GENUI_FENCE constant not found in index.client.tsx");
const GENUI_FENCE = eval(match[1]);

const claims = (text) => GENUI_FENCE.test(text);

test("assistant transformer guard hands generative-UI fences to the host", () => {
  assert.equal(claims('Sure:\n```ui\nCard("T",[Text("hi")])\n```'), true);
  assert.equal(claims('```app\n<b>hi</b>\n```'), true);
  assert.equal(claims("   ```ui\nCard()\n```"), true); // three spaces of indent
  assert.equal(claims("~~~ui\nCard()\n~~~"), true); // tilde fences
  assert.equal(claims("```UI\nCard()\n```"), true); // case-insensitive language
});

test("guard keeps ordinary replies and ordinary code fences", () => {
  assert.equal(claims("Just a normal answer."), false);
  assert.equal(claims("run `ui` inline"), false);
  assert.equal(claims("```bash\nls\n```"), false);
  assert.equal(claims("```uix\nCard()\n```"), false); // longer language name
  assert.equal(claims("    ```ui\nCard()\n```"), false); // four spaces: not a fence open
  assert.equal(claims(""), false);
});
