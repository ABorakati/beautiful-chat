import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { fontMono, radius } from "./theme-tokens";
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
  sm: { box: 15, font: 8.5 },
  md: { box: 17, font: 9.5 },
  lg: { box: 21, font: 11 },
} as const;

/**
 * The file's own brand mark. Devicon ships an authentic glyph for the languages
 * we care about; anything else falls back to a neutral two-letter monogram so
 * an unknown extension still reads as a file rather than a gap.
 */
export function FileTypeLogo({ filename, language, size = "md" }: FileTypeLogoProps) {
  const type = detectFileType(filename, language);
  const { box, font } = DIMENSIONS[size];
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

  const label = fallbackLabel(filename);
  return (
    <View style={[styles.fallback, { width: box, height: box }]}>
      <Text style={[styles.fallbackLabel, { fontSize: font }]}>{label}</Text>
    </View>
  );
}

/** First two characters of the extension, else a generic marker. */
function fallbackLabel(filename?: string): string {
  if (!filename) return "•";
  const base = filename.toLowerCase().split(/[/\\]/).pop() ?? "";
  if (!base.includes(".")) return "•";
  const ext = base.split(".").pop() ?? "";
  return ext.slice(0, 2).toUpperCase() || "•";
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.chip,
    backgroundColor: "rgba(148, 163, 184, 0.12)",
  },
  fallbackLabel: {
    fontFamily: fontMono,
    fontWeight: "600",
    color: "#94a3b8",
    letterSpacing: -0.3,
    textAlign: "center",
  },
});
