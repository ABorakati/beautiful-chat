/**
 * Builds unified-diff text from an edit's old and new strings, for providers
 * that ship the before and after instead of a patch. The host's own tool view
 * makes the same computation, so a card shows the same change native does.
 *
 * The similarity table is bounded: an edit whose sides multiply past the cap
 * is emitted as one whole replacement rather than stalled over.
 */

const MAX_TABLE_CELLS = 400_000;
const CONTEXT = 3;

type Op = { type: "same" | "del" | "add"; text: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function lcsOps(a: string[], b: string[]): Op[] {
  const cols = b.length + 1;
  const table = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i]! === b[j]!
          ? (table[(i + 1) * cols + (j + 1)] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + (j + 1)] ?? 0);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]! === b[j]!) {
      ops.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + (j + 1)] ?? 0)) {
      ops.push({ type: "del", text: a[i]! });
      i++;
    } else {
      ops.push({ type: "add", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) {
    ops.push({ type: "del", text: a[i]! });
    i++;
  }
  while (j < b.length) {
    ops.push({ type: "add", text: b[j]! });
    j++;
  }
  return ops;
}

export function buildUnifiedDiffText(oldText: string, newText: string): string {
  if (oldText === newText) return "";
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops: Op[] =
    a.length * b.length > MAX_TABLE_CELLS
      ? [
          ...a.map((text) => ({ type: "del" as const, text })),
          ...b.map((text) => ({ type: "add" as const, text })),
        ]
      : lcsOps(a, b);

  // hunks: runs of changes whose gap stays within twice the context merge
  // into one; each hunk grows its context on both edges.
  const changeIndexes = ops
    .map((op, index) => (op.type === "same" ? -1 : index))
    .filter((index) => index >= 0);
  if (changeIndexes.length === 0) return "";

  const groups: number[][] = [[changeIndexes[0]!]];
  for (let k = 1; k < changeIndexes.length; k++) {
    const group = groups[groups.length - 1]!;
    if (changeIndexes[k]! - group[group.length - 1]! <= CONTEXT * 2 + 1) {
      group.push(changeIndexes[k]!);
    } else {
      groups.push([changeIndexes[k]!]);
    }
  }

  // Line positions are global: aPos[k] is the 1-based old-file line op k sits
  // on, so a hunk's header can be read straight off its first op.
  const aPos: number[] = new Array(ops.length);
  const bPos: number[] = new Array(ops.length);
  let aLine = 1;
  let bLine = 1;
  for (let k = 0; k < ops.length; k++) {
    aPos[k] = aLine;
    bPos[k] = bLine;
    if (ops[k]!.type !== "add") aLine++;
    if (ops[k]!.type !== "del") bLine++;
  }

  const out: string[] = [];
  for (const group of groups) {
    const from = Math.max(0, group[0]! - CONTEXT);
    const to = Math.min(ops.length, group[group.length - 1]! + CONTEXT + 1);
    let aCount = 0;
    let bCount = 0;
    for (let k = from; k < to; k++) {
      if (ops[k]!.type !== "add") aCount++;
      if (ops[k]!.type !== "del") bCount++;
    }
    out.push(
      `@@ -${aPos[from]!},${aCount} +${bPos[from]!},${bCount} @@`,
    );
    for (let k = from; k < to; k++) {
      out.push(
        `${ops[k]!.type === "same" ? " " : ops[k]!.type === "del" ? "-" : "+"}${ops[k]!.text}`,
      );
    }
  }

  return out.join("\n");
}
