import React, { useCallback, useState } from "react";
import { Platform, Pressable, Text } from "react-native";
import { Modal, useToast } from "@getpaseo/plugin/client/ui";
import { CopyFallbackDialog, copyTouchTarget, useCopyText } from "./copy-feedback";
import { radius, type ExtendedThemeTokens } from "./theme-tokens";

/** Shows a path in the daemon machine's file manager; resolves to an error message or null. */
export type RevealPath = (path: string) => Promise<string | null>;

const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

/**
 * What a press on a local path does: the one handler that path spans, inline
 * code paths and markdown links to local files all share.
 *
 * The plugin SDK offers no way to open a file in Paseo's own viewer (see the
 * first SDK limitation in the README), so on desktop and web a press shows the
 * file in the file manager, and the right-click path menu offers the rest. On
 * iOS and Android that file manager belongs to another computer, so a press
 * opens a small sheet instead: Copy Path, and Show in File Manager on the
 * daemon's computer. Neither platform opens a file without the path menu's
 * confirmation.
 */
export function usePathPress(reveal: RevealPath, cwd?: string | null) {
  const [path, setPath] = useState<string | null>(null);
  const press = useCallback(
    (target: string) => {
      if (Platform.OS === "web") void reveal(target);
      else setPath(target);
    },
    [reveal],
  );
  const close = useCallback(() => setPath(null), []);
  return { press, sheet: { path, cwd: cwd ?? null, reveal, onClose: close } };
}

export function PathActionSheet({
  path,
  cwd,
  reveal,
  onClose,
  tokens,
}: {
  path: string | null;
  cwd: string | null;
  reveal: RevealPath;
  onClose(): void;
  tokens: ExtendedThemeTokens;
}) {
  const toast = useToast();
  const { handleCopy, fallbackText, setFallbackText } = useCopyText(path ?? "");

  if (fallbackText !== null) {
    return <CopyFallbackDialog text={fallbackText} onClose={() => setFallbackText(null)} tokens={tokens} />;
  }
  // The showcase's Modal ignores `open`, so a closed sheet renders nothing.
  if (path === null) return null;

  const body = { color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: tokens.fs(13), lineHeight: tokens.fs(20) };
  const action = (label: string, run: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={run}
      style={{
        ...copyTouchTarget,
        alignItems: "flex-start",
        paddingHorizontal: 12,
        borderRadius: radius.block,
        backgroundColor: tokens.surface1,
      }}
    >
      <Text style={{ ...body, color: tokens.foreground, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
  // As in the path menu, a relative path without the agent folder is copy-only.
  const canReveal = ABSOLUTE_PATH.test(path) || Boolean(cwd);

  return (
    <Modal title="File path" open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Content>
        <Text selectable style={{ ...body, color: tokens.foreground, fontFamily: tokens.fontMono }}>
          {path}
        </Text>
        {action("Copy Path", () => {
          // Start the copy inside the press, then close.
          void handleCopy();
          onClose();
        })}
        {canReveal
          ? action("Show in File Manager", () => {
              onClose();
              void reveal(path).then((error) => {
                if (error) toast.error(`Could not show ${path}: ${error}`);
                else toast.show("Shown in the file manager on the daemon's computer", { variant: "success" });
              });
            })
          : null}
        {canReveal ? (
          <Text style={body}>Show in File Manager acts on the computer that runs the Paseo daemon.</Text>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
