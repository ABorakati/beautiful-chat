import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Removes a trailing line or column selector. Keeps spaces and punctuation in names. */
export function stripSelector(path: string): string {
  return path.trim().replace(/(?::\d+(?::\d+)?(?:-\d+(?::\d+)?)?|#L\d+(?:-L?\d+)?)$/, "");
}

/**
 * Shows a path in the machine's own file manager.
 *
 * The client cannot reach the operating system, and Paseo exposes no file
 * navigation to plugins, so the daemon side does the work: it resolves the
 * path against the agent's working directory and asks the platform shell to
 * reveal it.
 */
export const revealPathRpc = defineRpc({
  // The host accepts lower-case, dotted RPC names only.
  name: "file.reveal",
  input: z.object({
    cwd: z.string(),
    path: z.string(),
  }),
  output: z.object({
    revealed: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
