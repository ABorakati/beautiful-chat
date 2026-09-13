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

const BRAND_PATHS = {
  Git: "M13.09 23.549a1.54 1.54 0 0 1-2.18 0L.451 13.089a1.54 1.54 0 0 1 0-2.179l7.191-7.19l2.733 2.733a1.85 1.85 0 0 0 .964 2.326v6.66a1.849 1.849 0 1 0 1.54 0V8.957l2.508 2.508a1.85 1.85 0 1 0 1.09-1.09l-2.634-2.634a1.85 1.85 0 0 0-2.378-2.377L8.73 2.63L10.91.451a1.54 1.54 0 0 1 2.179 0l10.459 10.46a1.54 1.54 0 0 1 0 2.179z",
  GitHub:
    "M12 .297c-6.63 0-12 5.373-12 12c0 5.303 3.438 9.8 8.205 11.385c.6.113.82-.258.82-.577c0-.285-.01-1.04-.015-2.04c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729c1.205.084 1.838 1.236 1.838 1.236c1.07 1.835 2.809 1.305 3.495.998c.108-.776.417-1.305.76-1.605c-2.665-.3-5.466-1.332-5.466-5.93c0-1.31.465-2.38 1.235-3.22c-.135-.303-.54-1.523.105-3.176c0 0 1.005-.322 3.3 1.23c.96-.267 1.98-.399 3-.405c1.02.006 2.04.138 3 .405c2.28-1.552 3.285-1.23 3.285-1.23c.645 1.653.24 2.873.12 3.176c.765.84 1.23 1.91 1.23 3.22c0 4.61-2.805 5.625-5.475 5.92c.42.36.81 1.096.81 2.22c0 1.606-.015 2.896-.015 3.286c0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
} as const;

const brandCache = new Map<string, string>();

function brandUri(name: keyof typeof BRAND_PATHS, color: string): string {
  const key = `${name}|${color}`;
  const cached = brandCache.get(key);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ` +
    `fill="${color}"><path d="${BRAND_PATHS[name]}"/></svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  brandCache.set(key, uri);
  return uri;
}

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

    case "Git":
    case "GitHub":
      return (
        <Image
          source={{ uri: brandUri(name, color) }}
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
