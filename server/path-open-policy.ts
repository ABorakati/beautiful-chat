import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { isSafeOpenPath, requiresOpenConfirmation } from "../shared/path-open-policy";
import type { OpenPathPolicy } from "../shared/file-rpc";

const execFileAsync = promisify(execFile);

/** Inspect the resolved file and working folder before each open. */
export async function inspectOpenTarget(path: string, cwd: string | null): Promise<OpenPathPolicy> {
  const target = await realpath(path);
  const entry = await stat(target);
  let risky = !entry.isFile() || (entry.mode & 0o111) !== 0 || !isSafeOpenPath(target);
  if (!risky && process.platform === "darwin") {
    const { stdout } = await execFileAsync("/usr/bin/xattr", [target], { shell: false });
    // FinderInfo can mark a Finder alias, so any FinderInfo attribute requires confirmation.
    risky = stdout.split(/\r?\n/).some((name) =>
      name === "com.apple.LaunchServices.OpenWith" || name === "com.apple.FinderInfo");
  }
  let outsideWorkingFolder: boolean | null = null;
  if (cwd && isAbsolute(cwd)) {
    try {
      const folder = await realpath(cwd);
      if ((await stat(folder)).isDirectory()) {
        const fromFolder = relative(folder, target);
        outsideWorkingFolder = fromFolder === ".." || fromFolder.startsWith(`..${sep}`) || isAbsolute(fromFolder);
      }
    } catch {
      // An unavailable working folder requires confirmation for every open.
    }
  }
  return { path: target, risky, outsideWorkingFolder };
}

/** Resolve a relative path only when the caller supplied an absolute folder. */
export function resolveOpenPath(path: string, cwd: string | null): string {
  if (!isAbsolute(path) && (!cwd || !isAbsolute(cwd))) {
    throw new Error("The working folder is unknown. Use an absolute path.");
  }
  return resolve(cwd ?? "", path);
}

/** Direct RPC calls use the same confirmation rule as the client. */
export function enforceOpenPolicy(policy: OpenPathPolicy, confirmed?: boolean): void {
  if (requiresOpenConfirmation(policy) && confirmed !== true) {
    const reason = policy.risky ? "This file can run code"
      : policy.outsideWorkingFolder ? "The path is outside the working folder"
        : "The agent's working folder is unknown";
    throw new Error(`${reason}. Confirm this open first.`);
  }
}