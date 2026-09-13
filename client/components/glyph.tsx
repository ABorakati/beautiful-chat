import React, { type ReactElement } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { fontMono } from "./theme-tokens";

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

/**
 * Lucide `zap`, verbatim from lucide-static. `currentColor` does not resolve
 * inside an <Image>, so the stroke is substituted and the result memoised —
 * the same bolt renders on every reasoning row in the stream.
 */
const ZAP_PATH =
  "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z";

const zapCache = new Map<string, string>();

/**
 * Lucide `copy`, verbatim from lucide-static: a front sheet plus the back
 * sheet's exposed corner. A single square reads as a stop button or a
 * checkbox; the two overlapping sheets are what make it legible as copy.
 */
const COPY_BODY =
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
  '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>';

const copyCache = new Map<string, string>();

function copyUri(color: string): string {
  const cached = copyCache.get(color);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round">${COPY_BODY}</svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  copyCache.set(color, uri);
  return uri;
}

function zapUri(color: string): string {
  const cached = zapCache.get(color);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round"><path d="${ZAP_PATH}"/></svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  zapCache.set(color, uri);
  return uri;
}

/**
 * Universal zero-dependency stroke and geometric glyphs.
 * Runs in any Paseo plugin sandbox without requiring react-native-svg or external icon packages.
 */
export function Icon({ name, size = 13, color = "#94a3b8" }: IconProps): ReactElement {
  const safeColor = color === "currentColor" ? "#94a3b8" : color;
  const glyph = renderGlyph(name, size, safeColor);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {glyph}
    </View>
  );
}

export { Icon as Glyph };

function renderGlyph(name: string, size: number, color: string): ReactElement {
  const stroke = Math.max(1.2, size / 8.5);

  switch (name) {
    // A stroked chevron, not the `▾` character. A text triangle fills only a
    // fraction of its em box, so it reads far smaller than its nominal size;
    // two borders on a rotated box scale exactly with `size`.
    case "ChevronDown":
    case "ChevronUp":
    case "ChevronRight": {
      const side = size * 0.46;
      const rotation =
        name === "ChevronDown" ? "45deg" : name === "ChevronUp" ? "-135deg" : "-45deg";
      // The turned box sits off-centre on the axis it points along.
      const nudge = size * 0.11;
      return (
        <View
          style={{
            width: size,
            height: size,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: side,
              height: side,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderColor: color,
              transform: [{ rotate: rotation }],
              marginTop: name === "ChevronDown" ? -nudge : 0,
              marginBottom: name === "ChevronUp" ? -nudge : 0,
              marginRight: name === "ChevronRight" ? -nudge : 0,
            }}
          />
        </View>
      );
    }

    case "Check":
      return (
        <Text style={[styles.symbol, { fontSize: size + 1, color, fontWeight: "700" }]}>✓</Text>
      );

    case "X":
      return <Text style={[styles.symbol, { fontSize: size, color, fontWeight: "600" }]}>✕</Text>;

    case "Dot":
      return (
        <View
          style={{
            width: Math.max(4, size * 0.45),
            height: Math.max(4, size * 0.45),
            borderRadius: Math.round(size / 2),
            backgroundColor: color,
          }}
        />
      );

    case "Circle":
      return (
        <View
          style={{
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size * 0.35,
            borderWidth: stroke,
            borderColor: color,
          }}
        />
      );

    case "CircleDot":
      return (
        <View
          style={{
            width: size * 0.75,
            height: size * 0.75,
            borderRadius: size * 0.375,
            borderWidth: stroke,
            borderColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: size * 0.3,
              height: size * 0.3,
              borderRadius: size * 0.15,
              backgroundColor: color,
            }}
          />
        </View>
      );

    case "Play":
      return <Text style={[styles.arrow, { fontSize: size - 2, color, marginLeft: 1 }]}>▶</Text>;

    case "Terminal":
      return <Text style={[styles.mono, { fontSize: Math.max(8.5, size - 2), color }]}>&gt;_</Text>;

    // A completion marker: filled disc in the status colour with a white
    // tick on top. The tick is two borders on a rotated box, so it stays
    // crisp at any size without a font glyph or an SVG.
    case "CheckCircle": {
      const tickWidth = size * 0.44;
      const tickHeight = size * 0.24;
      const tickStroke = Math.max(1.25, size * 0.11);
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: tickWidth,
              height: tickHeight,
              borderLeftWidth: tickStroke,
              borderBottomWidth: tickStroke,
              borderColor: "#FFFFFF",
              transform: [{ rotate: "-45deg" }],
              marginTop: -size * 0.08,
            }}
          />
        </View>
      );
    }

    // Reasoning is a bolt: Lucide's `zap`, stroked in the caller's colour.
    // The path is the vendor's own, inlined as a data URI because the plugin
    // sandbox exposes no SVG renderer.
    case "Zap":
    case "Brain":
      return (
        <Image
          source={{ uri: zapUri(color) }}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      );

    case "Sparkles":
      return <Text style={[styles.symbol, { fontSize: size - 1, color }]}>✦</Text>;

    case "Shield":
    case "ShieldAlert":
      return <Text style={[styles.symbol, { fontSize: size - 1, color }]}>⛨</Text>;

    case "ListChecks":
    case "ListTodo":
      return (
        <Text style={[styles.symbol, { fontSize: size - 1, color, fontWeight: "700" }]}>≡</Text>
      );

    case "AlertTriangle":
    case "AlertCircle":
      return <Text style={[styles.bold, { fontSize: size, color }]}>!</Text>;

    case "HelpCircle":
      return (
        <View
          style={{
            width: size * 0.85,
            height: size * 0.85,
            borderRadius: size * 0.425,
            borderWidth: stroke,
            borderColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              fontSize: size * 0.65,
              fontWeight: "700",
              color,
              lineHeight: size * 0.7,
            }}
          >
            ?
          </Text>
        </View>
      );

    case "Copy":
      return (
        <Image
          source={{ uri: copyUri(color) }}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      );

    case "Bot":
      return (
        <Text style={[styles.mono, { fontSize: size - 2, color, fontWeight: "700" }]}>[•]</Text>
      );

    case "Server":
    case "Layers":
      return <Text style={[styles.symbol, { fontSize: size - 1, color }]}>☵</Text>;

    case "Radio":
      return (
        <View
          style={{
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size * 0.35,
            borderWidth: stroke,
            borderColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: size * 0.25,
              height: size * 0.25,
              borderRadius: size * 0.125,
              backgroundColor: color,
            }}
          />
        </View>
      );

    case "Plug":
      return (
        <View
          style={{
            width: size,
            height: size,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              gap: Math.max(2.5, size * 0.24),
              marginBottom: 0.5,
            }}
          >
            <View
              style={{
                width: 1.5,
                height: size * 0.28,
                backgroundColor: color,
                borderRadius: 0.5,
              }}
            />
            <View
              style={{
                width: 1.5,
                height: size * 0.28,
                backgroundColor: color,
                borderRadius: 0.5,
              }}
            />
          </View>
          <View
            style={{
              width: size * 0.65,
              height: size * 0.44,
              backgroundColor: color,
              borderRadius: 3,
            }}
          />
          <View
            style={{
              width: 1.5,
              height: size * 0.2,
              backgroundColor: color,
            }}
          />
        </View>
      );

    case "Pencil":
    case "Edit":
      return (
        <Text
          style={[
            styles.symbol,
            {
              fontSize: size + 1,
              color,
              fontWeight: "600",
              lineHeight: size + 2,
            },
          ]}
        >
          ✎
        </Text>
      );

    case "Book":
    case "BookOpen":
      return (
        <View
          style={{
            width: size,
            height: size * 0.75,
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <View
            style={{
              width: size * 0.44,
              height: size * 0.72,
              borderWidth: stroke,
              borderColor: color,
              borderTopLeftRadius: 1,
              borderBottomLeftRadius: 3,
              borderRightWidth: 0.5,
            }}
          />
          <View
            style={{
              width: size * 0.44,
              height: size * 0.72,
              borderWidth: stroke,
              borderColor: color,
              borderTopRightRadius: 1,
              borderBottomRightRadius: 3,
              borderLeftWidth: 0.5,
            }}
          />
        </View>
      );

    case "FileCode":
      return (
        <Text style={[styles.mono, { fontSize: size - 3, color, fontWeight: "700" }]}>
          &lt;/&gt;
        </Text>
      );

    case "FileDiff":
      return <Text style={[styles.mono, { fontSize: size - 1, color, fontWeight: "700" }]}>±</Text>;

    case "Wrench":
      return <Text style={[styles.symbol, { fontSize: size - 1, color }]}>⚙</Text>;

    case "MessageSquare":
      return <Text style={[styles.symbol, { fontSize: size - 1, color }]}>💬</Text>;

    default:
      return (
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 3,
            backgroundColor: color,
          }}
        />
      );
  }
}

const styles = StyleSheet.create({
  arrow: {
    textAlign: "center",
    lineHeight: 14,
  },
  symbol: {
    textAlign: "center",
    lineHeight: 14,
  },
  mono: {
    fontFamily: fontMono,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 13,
  },
  bold: {
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 13,
  },
});
