const SAFE_OPEN_EXTENSIONS: Record<string, true> = {
  png: true, jpg: true, jpeg: true, gif: true, webp: true, avif: true, bmp: true, ico: true,
  tif: true, tiff: true, heic: true, heif: true,
  txt: true, text: true, md: true, markdown: true, rst: true, log: true, csv: true, tsv: true,
  json: true, jsonl: true, ndjson: true, yaml: true, yml: true, toml: true, ini: true, pdf: true,
  mp3: true, wav: true, ogg: true, oga: true, flac: true, aac: true, m4a: true, opus: true,
  aif: true, aiff: true, wma: true,
  mp4: true, webm: true, mkv: true, mov: true, m4v: true, avi: true, mpg: true, mpeg: true,
  ogv: true, "3gp": true, wmv: true,
};

/** Resolve dot segments and keep namespace, drive, and UNC roots. */
export function normalizeOpenPath(path: string): string {
  const namespace = /^(?:\\\\[.?]\\|\/\/[.?]\/)/.test(path) ? path.slice(0, 4) : "";
  const drive = /^[a-zA-Z]:[\\/]/.test(path.slice(namespace.length));
  const windows = namespace ? namespace.startsWith("\\") : drive || path.startsWith("\\");
  const separator = windows ? "\\" : "/";
  const unc = !namespace && (path.startsWith("\\\\") || path.startsWith("//"));
  const prefix = namespace + (drive ? path.slice(namespace.length, namespace.length + 2) + separator
    : namespace ? "" : unc ? separator + separator : path.startsWith(separator) ? separator : "");
  const rootDepth = namespace && !drive ? (/^UNC(?:[\\/]|$)/i.test(path.slice(namespace.length)) ? 3 : 1)
    : unc ? 2 : 0;
  const parts: string[] = [];
  for (const part of path.slice(prefix.length).split(windows ? /[\\/]/ : /\//)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > rootDepth && parts.at(-1) !== "..") parts.pop();
      else if (!prefix) parts.push(part);
    } else parts.push(part);
  }
  return prefix + parts.join(separator);
}

/** Only these file extensions can open without the code warning. */
export function isSafeOpenPath(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const extension = name.slice(dot + 1);
  return dot > 0 && !name.includes(":") && /^[a-zA-Z0-9]+$/.test(extension)
    && SAFE_OPEN_EXTENSIONS[extension.toLowerCase()] === true;
}

/** An unknown working folder also requires confirmation. */
export function requiresOpenConfirmation(policy: { risky: boolean; outsideWorkingFolder: boolean | null }): boolean {
  return policy.risky || policy.outsideWorkingFolder !== false;
}
