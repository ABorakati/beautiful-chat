import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { revealPathRpc } from "./shared/file-rpc";

/** Strips the selector a tool appends to a path, such as `main.ts:55-85`. */
function stripSelector(path: string): string {
  const trimmed = path.trim();
  const windowsDrive = /^[a-zA-Z]:[\\/]/.test(trimmed);
  const head = windowsDrive ? trimmed.slice(0, 3) : "";
  const tail = windowsDrive ? trimmed.slice(3) : trimmed;
  const cut = tail.search(/[\s:?#]/);
  return cut === -1 ? trimmed : head + tail.slice(0, cut);
}

/**
 * Reveals a path with the platform shell. Windows Explorer selects the file
 * itself; macOS Finder does the same with `-R`; every other platform opens the
 * containing directory, because `xdg-open` on a file launches its editor.
 */
function revealWithShell(target: string, isDirectory: boolean): void {
  const child =
    process.platform === "win32"
      ? spawn("explorer.exe", isDirectory ? [target] : [`/select,${target}`], {
          detached: true,
          stdio: "ignore",
          windowsVerbatimArguments: true,
        })
      : process.platform === "darwin"
        ? spawn("open", isDirectory ? [target] : ["-R", target], {
            detached: true,
            stdio: "ignore",
          })
        : spawn("xdg-open", [isDirectory ? target : dirname(target)], {
            detached: true,
            stdio: "ignore",
          });
  // Explorer reports a non-zero exit even when it opened the window, so the
  // result is never read. Detaching keeps the daemon free of a zombie child.
  child.on("error", () => {});
  child.unref();
}

export default function contribute(server: PluginServerContext) {
  server.handle(revealPathRpc, async (input) => {
    const requested = stripSelector(input.path);
    if (!requested) return { revealed: null, error: "No path" };

    const target = isAbsolute(requested) ? requested : resolve(input.cwd, requested);
    try {
      const entry = await stat(target);
      revealWithShell(target, entry.isDirectory());
      return { revealed: target, error: null };
    } catch (error) {
      return {
        revealed: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return () => {};
}
