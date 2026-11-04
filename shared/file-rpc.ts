import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Removes a trailing line or column selector. Keeps spaces and punctuation in names. */
export function stripSelector(path: string): string {
  return path.trim().replace(/(?::\d+(?::\d+)?(?:-\d+(?::\d+)?)?|#L\d+(?:-L?\d+)?)$/, "");
}

/** The daemon checks the resolved target before the client offers an open. */
export interface OpenPathPolicy {
  path: string;
  risky: boolean;
  outsideWorkingFolder: boolean | null;
}

/** Reveal a path, inspect an open target, or open a confirmed target. */
export const revealPathRpc = defineRpc({
  // The host accepts lower-case, dotted RPC names only.
  name: "file.reveal",
  input: z.object({
    cwd: z.string(),
    path: z.string(),
    agentId: z.string().optional(),
    open: z.boolean().optional(),
    check: z.boolean().optional(),
    confirmed: z.boolean().optional(),
  }),
  output: z.object({
    revealed: z.string().nullable(),
    launch: z.enum(["started", "completed"]).nullable(),
    policy: z.object({
      path: z.string(),
      risky: z.boolean(),
      outsideWorkingFolder: z.boolean().nullable(),
    }).nullable(),
    error: z.string().nullable(),
  }),
});
