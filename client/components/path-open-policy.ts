const EXECUTABLE_EXTENSIONS: Record<string, true> = {
  exe: true, com: true, bat: true, cmd: true, ps1: true, psm1: true, vbs: true, vbe: true,
  js: true, jse: true, wsf: true, wsh: true, msi: true, msp: true, scr: true, pif: true,
  lnk: true, url: true, reg: true, hta: true, cpl: true, jar: true, sh: true, bash: true,
  zsh: true, command: true, app: true, appimage: true, run: true, desktop: true,
  py: true, pl: true, rb: true,
};

/** Resolve dot segments before the path reaches the dialog or extension check. */
export function normalizeOpenPath(path: string): string {
  const windows = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\");
  const separator = windows ? "\\" : "/";
  const prefix = windows
    ? /^[a-zA-Z]:[\\/]/.test(path) ? path.slice(0, 2) + separator : path.startsWith("\\\\") ? "\\\\" : separator
    : "/";
  const parts: string[] = [];
  for (const part of path.slice(prefix.length).split(windows ? /[\\/]/ : /\//)) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return prefix + parts.join(separator);
}

/** Check the target file name, including dots that Windows ignores at the end. */
export function isExecutablePath(path: string): boolean {
  const name = (normalizeOpenPath(path).split(/[\\/]/).at(-1) ?? "").replace(/[. ]+$/, "");
  const extension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  return extension !== undefined && EXECUTABLE_EXTENSIONS[extension] === true;
}
