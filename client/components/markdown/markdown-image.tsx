import React, { useCallback, useEffect, useState } from "react";
import { Image } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { revealPathRpc } from "../../../shared/file-rpc";
import { type ImageFile, isImagePath, useImageFile } from "../../image-file";
import { ImagePreview } from "../image-preview";
import type { ExtendedThemeTokens } from "../theme-tokens";

interface MarkdownImageProps {
  src: string;
  alt: string;
  tokens: ExtendedThemeTokens;
  /** The agent's working directory, for a relative path. */
  cwd: string | null;
}

/** Where the bytes of a markdown image come from. */
type ImageSource =
  /** A URL the client can hand straight to `<Image>`: http(s) or a data URI. */
  | { kind: "remote"; uri: string }
  /** A path on the daemon machine, which only the daemon-side RPC can read. */
  | { kind: "file"; path: string }
  | { kind: "none" };

const FILE_SCHEME = /^file:\/\//i;
const WINDOWS_DRIVE = /^\/[A-Za-z]:[\\/]/;

/**
 * Sorts a markdown image target into something drawable.
 *
 * The daemon writes a provider image (a screenshot a tool returned, a picture
 * Codex viewed or generated) as `![Image](file:///path)`, with each segment
 * percent-encoded. Anything else the model writes is taken at face value:
 * an absolute path counts as a file, and an http(s) or data URI goes straight
 * to the image view.
 */
export function resolveImageSource(src: string): ImageSource {
  const trimmed = src.trim();
  if (trimmed === "") return { kind: "none" };

  if (/^data:image\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return { kind: "remote", uri: trimmed };
  }

  if (FILE_SCHEME.test(trimmed)) {
    let path = trimmed.replace(FILE_SCHEME, "");
    try {
      path = decodeURIComponent(path);
    } catch {
      // A stray `%` that is not an escape: keep the raw path and let the
      // daemon report that it cannot find it.
    }
    // `file:///C:/x` carries a leading slash that is not part of the path.
    if (WINDOWS_DRIVE.test(path)) path = path.slice(1);
    return path === "" ? { kind: "none" } : { kind: "file", path };
  }

  if (isImagePath(trimmed)) return { kind: "file", path: trimmed };
  return { kind: "none" };
}

/** The last path segment, for the card header of a hashed temp file. */
function baseName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/**
 * Reads a remote image's pixel size so the frame can keep its aspect ratio.
 * Null until the size arrives; the preview falls back to a fixed box until then.
 */
function useRemoteImage(uri: string | null): ImageFile | null {
  const [file, setFile] = useState<ImageFile | null>(null);
  useEffect(() => {
    if (uri === null) {
      setFile(null);
      return;
    }
    let cancelled = false;
    setFile({ dataUri: uri, width: null, height: null, bytes: null, error: null });
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled) setFile({ dataUri: uri, width, height, bytes: null, error: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        setFile({
          dataUri: null,
          width: null,
          height: null,
          bytes: null,
          error: error instanceof Error ? error.message : "The image could not be loaded.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return uri === null ? null : file;
}

/**
 * A markdown image, drawn as the image.
 *
 * Both providers surface pictures this way: the daemon pulls image blocks out
 * of a Claude tool result, a Codex `view_image` or image generation, or any
 * MCP tool that returns one, and appends `![Image](file:///...)` as a reply.
 * The parser used to hand that to the link branch, so every screenshot read as
 * a bare underlined "Image". A file path goes through the plugin's `file.image`
 * RPC, exactly as a Read of a `.png` does; a URL or data URI is loaded by the
 * image view itself.
 */
export function MarkdownImage({ src, alt, tokens, cwd }: MarkdownImageProps) {
  const source = resolveImageSource(src);
  const filePath = source.kind === "file" ? source.path : undefined;
  const localFile = useImageFile(filePath, cwd);
  const remoteFile = useRemoteImage(source.kind === "remote" ? source.uri : null);
  const revealPath = useRpc(revealPathRpc);

  const reveal = useCallback(() => {
    if (filePath === undefined) return;
    void revealPath({ cwd: cwd ?? "", path: filePath }).catch(() => {});
  }, [cwd, filePath, revealPath]);

  if (source.kind === "none") {
    // Nothing drawable: the alt text is what a reader gets, as in plain markdown.
    return <ImagePreview path={alt || src} file={{ dataUri: null, width: null, height: null, bytes: null, error: "No image source" }} tokens={tokens} />;
  }

  // The daemon names a materialized image by its content hash, which tells a
  // reader nothing; the alt text is the better label when the model gave one.
  const generic = alt === "" || alt.toLowerCase() === "image";
  const label = source.kind === "file" ? (generic ? baseName(source.path) : alt) : alt || source.uri;

  return source.kind === "file" ? (
    <ImagePreview path={label} file={localFile} tokens={tokens} onReveal={reveal} />
  ) : (
    <ImagePreview path={label} file={remoteFile} tokens={tokens} />
  );
}
