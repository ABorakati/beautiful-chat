import { spawn } from "node:child_process";
import { dirname } from "node:path";

/** The time allowed to wait for a launcher to exit. */
const LAUNCH_GRACE_MS = 3000;

function launch(
  command: string,
  args: string[],
  explorer = false,
): Promise<"started" | "completed"> {
  // The ES2023 library does not include Promise.withResolvers.
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      shell: false,
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: explorer,
    });
    let timer: NodeJS.Timeout | undefined;
    child.once("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.once("spawn", () => {
      child.unref();
      // Explorer can return a nonzero exit code after success. Report only process start.
      if (explorer) return done("started");
      timer = setTimeout(() => {
        // xdg-open can wait for the selected app to exit.
        if (command === "xdg-open") return done("started");
        fail(new Error(`${command} did not exit within ${LAUNCH_GRACE_MS} ms`));
      }, LAUNCH_GRACE_MS);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (explorer) return;
      if (code === 0 && signal === null) done("completed");
      else fail(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

/**
 * Reveals a path with the platform shell.
 * macOS always uses -R so Reveal cannot launch an app bundle.
 * Other Unix platforms open the target's parent directory.
 */
export function revealWithShell(target: string): Promise<"started" | "completed"> {
  if (process.platform === "win32") {
    return launch("explorer.exe", [`/select,"${target}"`], true);
  }
  if (process.platform === "darwin") return launch("open", ["-R", target]);
  return launch("xdg-open", [dirname(target)]);
}

/** Opens a path with its default app. */
export function openWithShell(target: string): Promise<"started" | "completed"> {
  if (process.platform === "win32") return launch("explorer.exe", [`"${target}"`], true);
  return launch(process.platform === "darwin" ? "open" : "xdg-open", [target]);
}
