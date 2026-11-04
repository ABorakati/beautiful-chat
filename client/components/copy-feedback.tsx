import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Text } from "react-native";
import { copyText, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import type { ExtendedThemeTokens } from "./theme-tokens";

// Use real layout space: hitSlop alone is clipped by the small parent headers.
export const copyTouchTarget = Platform.OS === "web"
  ? {}
  : { minWidth: 44, minHeight: 44, justifyContent: "center" as const, alignItems: "center" as const };

export function useCopyText(text: string) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = useCallback(async () => {
    clearTimeout(timer.current);
    setCopied(false);
    try {
      // Start in the press handler to retain browser user activation. On native
      // the host uses expo-clipboard; no navigator API is available there.
      await copyText(text);
    } catch {
      // Keep a snapshot even if a streaming reply changes behind the dialog.
      setFallbackText(text);
      toast.error("Could not copy. Select all the text in the dialog and use Copy.");
      return;
    }
    setFallbackText(null);
    setCopied(true);
    toast.show("Copied to clipboard", { variant: "success" });
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [text, toast]);

  return { copied, handleCopy, fallbackText, setFallbackText };
}

export function CopyFallbackDialog({
  text,
  onClose,
  tokens,
}: {
  text: string | null;
  onClose(): void;
  tokens: ExtendedThemeTokens;
}) {
  if (text === null) return null;
  return (
    <Modal title="Copy text" open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Content>
        <Text style={{ color: tokens.foreground, fontSize: tokens.fs(13), lineHeight: tokens.fs(20) }}>
          Automatic copying failed. Touch and hold the text, choose Select All, then Copy.
        </Text>
        <TextInput
          accessibilityLabel="Text to copy"
          value={text}
          multiline
          readOnly
          selectTextOnFocus
          showSoftInputOnFocus={false}
          style={{
            color: tokens.foreground,
            backgroundColor: tokens.surface0,
            fontFamily: tokens.fontMono,
            fontSize: tokens.fs(13),
            lineHeight: tokens.fs(20),
            height: 240,
            padding: 12,
            textAlignVertical: "top",
          }}
        />
      </Modal.Content>
    </Modal>
  );
}
