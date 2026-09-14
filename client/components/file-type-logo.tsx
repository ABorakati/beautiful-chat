import React from "react";
import { Image } from "react-native";
import { DEVICON_URIS } from "./devicon-data";

export type SupportedFileType =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "json"
  | "bash"
  | "markdown"
  | "html"
  | "css"
  | "sql"
  | "go"
  | "react"
  | "docker"
  | "yaml"
  | "generic";

interface FileTypeLogoProps {
  filename?: string;
  language?: string;
  size?: "sm" | "md" | "lg";
}

const LANGUAGE_ALIASES: Record<string, SupportedFileType> = {
  typescript: "typescript",
  ts: "typescript",
  tsx: "react",
  javascript: "javascript",
  js: "javascript",
  jsx: "react",
  python: "python",
  py: "python",
  rust: "rust",
  rs: "rust",
  json: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  markdown: "markdown",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "css",
  sql: "sql",
  go: "go",
  golang: "go",
  dockerfile: "docker",
  yaml: "yaml",
  yml: "yaml",
};

const EXTENSION_MAP: Record<string, SupportedFileType> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react",
  jsx: "react",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  json: "json",
  jsonc: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  sql: "sql",
  go: "go",
  yaml: "yaml",
  yml: "yaml",
};

export function detectFileType(filename?: string, language?: string): SupportedFileType {
  const lang = (language || "").toLowerCase();
  const languageAlias = LANGUAGE_ALIASES[lang];
  if (languageAlias) return languageAlias;
  if (!filename) return "generic";
  const lower = filename.toLowerCase().trim();

  // Dockerfile carries its identity in the name, not an extension.
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "docker";

  // A read carries its selector on the path (`main.ts:55-85`), and a code
  // block header appends the line range (`main.ts 55-85`). Either suffix
  // swallows the extension and the file falls back to a monogram.
  const base = (lower.split(/[/\\]/).pop() ?? lower).split(/[\s:?#]/)[0] ?? "";
  const ext = base.includes(".") ? (base.split(".").pop() ?? "") : "";
  return EXTENSION_MAP[ext] ?? "generic";
}

const DIMENSIONS = {
  sm: { box: 15 },
  md: { box: 17 },
  lg: { box: 21 },
} as const;

const GENERIC_FILE_PATH =
  "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5";
const FOLDER_PATH =
  "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z";
const genericUriCache = new Map<string, string>();

function genericUri(isDirectory: boolean): string {
  const key = isDirectory ? "folder" : "file";
  const cached = genericUriCache.get(key);
  if (cached) return cached;
  const color = isDirectory ? "#EAB308" : "#94A3B8";
  const path = isDirectory ? FOLDER_PATH : GENERIC_FILE_PATH;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round"><path d="${path}"/></svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  genericUriCache.set(key, uri);
  return uri;
}

function isDirectoryPath(filename?: string): boolean {
  const path = filename?.trim();
  return (
    path === "." || path === ".." || path?.endsWith("/") === true || path?.endsWith("\\") === true
  );
}

/**
 * The file's own brand mark. Unknown types use Lucide's document mark.
 * Explicit directory paths use Lucide's folder mark.
 */
export function FileTypeLogo({ filename, language, size = "md" }: FileTypeLogoProps) {
  const type = detectFileType(filename, language);
  const { box } = DIMENSIONS[size];
  const uri = DEVICON_URIS[type];

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: box, height: box }}
        resizeMode="contain"
        accessibilityLabel={`${type} file`}
      />
    );
  }

  const isDirectory = isDirectoryPath(filename);
  return (
    <Image
      source={{ uri: genericUri(isDirectory) }}
      style={{ width: box, height: box }}
      resizeMode="contain"
      accessibilityLabel={isDirectory ? "Folder" : "File"}
    />
  );
}
