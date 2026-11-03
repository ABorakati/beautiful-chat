import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Removes a trailing line or column selector. Keeps spaces and punctuation in names. */
export function stripSelector(path: string): string {
  return path.trim().replace(/(?::\d+(?::\d+)?(?:-\d+(?::\d+)?)?|#L\d+(?:-L?\d+)?)$/, "");
}

/**
 * Shows a path in the daemon's file manager, or opens it with its default app when `open` is true.
 * The daemon resolves the path against the agent's current directory and asks the platform shell to reveal or open it.
 */
export const revealPathRpc = defineRpc({
  // The host accepts lower-case, dotted RPC names only.
  name: "file.reveal",
  input: z.object({
    cwd: z.string(),
    path: z.string(),
    open: z.boolean().optional(),
  }),
  output: z.object({
    revealed: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
