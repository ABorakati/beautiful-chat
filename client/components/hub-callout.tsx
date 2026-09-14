import React, { useState, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { radius } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import type { HubData, HubMessageData, HubProcessData, HubJobData } from "../../shared/contracts";

interface HubCalloutProps {
  data: HubData;
  tokens: ExtendedThemeTokens;
}

export function HubCallout({ data, tokens }: HubCalloutProps) {
  if (data.kind === "message") {
    return <HubMessageView data={data.data} tokens={tokens} />;
  }
  if (data.kind === "process") {
    return <HubProcessView data={data.data} tokens={tokens} />;
  }
  return <HubJobsView data={data.data} tokens={tokens} />;
}

function HubMessageView({ data, tokens }: { data: HubMessageData; tokens: ExtendedThemeTokens }) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderRadius: radius.card,
          backgroundColor: tokens.surface1,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          overflow: "hidden",
          ...tokens.boxShadow,
          gap: 8,
          padding: 12,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        },
        routingRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        channelBadge: {
          fontSize: 10,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: tokens.accent,
          backgroundColor: tokens.accentBg,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
        agentSender: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "700",
          color: tokens.foreground,
        },
        arrow: {
          fontSize: 11,
          color: tokens.foregroundSubtle,
        },
        agentRecipient: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "700",
          color: tokens.accent,
        },
        deliveryPill: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
          backgroundColor: tokens.successBg,
        },
        deliveryText: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          fontWeight: "600",
          color: tokens.success,
        },
        messageBox: {
          padding: 10,
          borderRadius: radius.block,
          backgroundColor: tokens.surfaceCode,
          borderLeftWidth: 3,
          borderLeftColor: tokens.accent,
        },
        messageText: {
          fontSize: 12,
          lineHeight: 18,
          color: tokens.foreground,
          fontFamily: tokens.fontMono,
        },
        replyBox: {
          marginTop: 4,
          padding: 10,
          borderRadius: radius.block,
          backgroundColor: tokens.surface0,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          gap: 4,
        },
        replyHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        replyAgent: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          fontWeight: "700",
          color: tokens.success,
        },
        replyBadge: {
          fontSize: 10,
          color: tokens.foregroundSubtle,
        },
        replyText: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          lineHeight: 18,
          color: tokens.foregroundMuted,
        },
      }),
    [tokens],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.routingRow}>
          <Glyph name="Radio" size={13} color={tokens.accent} />
          <Text style={styles.channelBadge}>hub peer</Text>
          <Text style={styles.agentSender}>{data.from}</Text>
          <Text style={styles.arrow}>➔</Text>
          <Text style={styles.agentRecipient}>{data.to}</Text>
        </View>

        <View style={styles.deliveryPill}>
          <Glyph name="CheckCircle" size={11} color={tokens.success} />
          <Text style={styles.deliveryText}>{data.delivered ? "Delivered" : "Queued"}</Text>
        </View>
      </View>

      <View style={styles.messageBox}>
        <Text style={styles.messageText}>{data.message}</Text>
      </View>

      {data.response && (
        <View style={styles.replyBox}>
          <View style={styles.replyHeader}>
            <Text style={styles.replyAgent}>Response from {data.to}:</Text>
            <Text style={styles.replyBadge}>Synchronous Reply</Text>
          </View>
          <Text style={styles.replyText}>{data.response}</Text>
        </View>
      )}
    </View>
  );
}

function HubProcessView({ data, tokens }: { data: HubProcessData; tokens: ExtendedThemeTokens }) {
  const [processStatus, setProcessStatus] = useState(data.status);
  const isReady = processStatus === "ready" || processStatus === "running";

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderRadius: radius.card,
          backgroundColor: tokens.surface1,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          overflow: "hidden",
          ...tokens.boxShadow,
          gap: 10,
          padding: 12,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        },
        titleRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        processPill: {
          fontSize: 11,
          fontFamily: tokens.fontUi,
          fontWeight: "700",
          color: tokens.foreground,
          backgroundColor: tokens.surface2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
        commandText: {
          fontSize: 12,
          fontFamily: tokens.fontMono,
          color: tokens.foregroundMuted,
        },
        statusRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        portPill: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
          backgroundColor: tokens.successBg,
          borderWidth: 1,
          borderColor: tokens.successBorder,
        },
        portDot: {
          width: 6,
          height: 6,
          borderRadius: radius.chip,
          backgroundColor: tokens.success,
        },
        portText: {
          fontSize: 11,
          fontFamily: tokens.fontMono,
          fontWeight: "600",
          color: tokens.success,
        },
        readyLogPill: {
          fontSize: 10,
          fontFamily: tokens.fontUi,
          color: tokens.foregroundSubtle,
          backgroundColor: tokens.surface2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
        logTerminal: {
          padding: 10,
          borderRadius: radius.block,
          backgroundColor: tokens.surfaceCode,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          gap: 4,
        },
        logLine: {
          fontFamily: tokens.fontMono,
          fontSize: 11,
          lineHeight: 16,
          color: tokens.foregroundMuted,
        },
        controlsRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
        },
        actionBtn: {
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: radius.block,
          backgroundColor: tokens.surface2,
        },
        actionText: {
          fontSize: 11,
          fontWeight: "600",
          color: tokens.foregroundMuted,
        },
        stopBtn: {
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: radius.block,
          backgroundColor: tokens.dangerBg,
        },
        stopText: {
          fontSize: 11,
          fontWeight: "600",
          color: tokens.danger,
        },
      }),
    [tokens],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Glyph name="Server" size={14} color={tokens.accent} />
          <Text style={styles.processPill}>process [{data.name}]</Text>
          <Text style={styles.commandText}>
            {data.application} {data.args.join(" ")}
          </Text>
        </View>

        <View style={styles.statusRow}>
          {data.port && isReady && (
            <View style={styles.portPill}>
              <View style={styles.portDot} />
              <Text style={styles.portText}>:{data.port} ready</Text>
            </View>
          )}

          {data.readyLogPattern && (
            <Text style={styles.readyLogPill}>match: {data.readyLogPattern}</Text>
          )}
        </View>
      </View>

      {data.recentLogs && data.recentLogs.length > 0 && (
        <View style={styles.logTerminal}>
          {data.recentLogs.map((log, index) => (
            <Text key={index} style={styles.logLine}>
              {log}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.controlsRow}>
        <Pressable onPress={() => setProcessStatus("running")} style={styles.actionBtn}>
          <Text style={styles.actionText}>Restart</Text>
        </Pressable>

        <Pressable
          onPress={() => setProcessStatus(isReady ? "stopped" : "ready")}
          style={isReady ? styles.stopBtn : styles.actionBtn}
        >
          <Text style={isReady ? styles.stopText : styles.actionText}>
            {isReady ? "Stop Process" : "Start Process"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function HubJobsView({ data, tokens }: { data: HubJobData; tokens: ExtendedThemeTokens }) {
  const [jobs, setJobs] = useState(data.activeJobs);

  const cancelJob = (id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderRadius: radius.card,
          backgroundColor: tokens.surface1,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          overflow: "hidden",
          ...tokens.boxShadow,
          gap: 6,
          padding: 12,
        },
        headerRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        },
        headerTitle: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "700",
          color: tokens.foreground,
        },
        jobCountBadge: {
          fontSize: 11,
          fontWeight: "600",
          fontFamily: tokens.fontUi,
          color: tokens.accent,
          backgroundColor: tokens.accentBg,
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: radius.chip,
        },
        jobRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 6,
          borderTopWidth: 1,
          borderTopColor: tokens.borderSubtle,
          gap: 8,
        },
        jobLeft: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flex: 1,
        },
        jobId: {
          fontSize: 11,
          fontFamily: tokens.fontMono,
          fontWeight: "600",
          color: tokens.foregroundMuted,
        },
        jobTarget: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          color: tokens.foreground,
          flexShrink: 1,
        },
        jobRight: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        jobTimer: {
          fontSize: 11,
          fontFamily: tokens.fontUi,
          color: tokens.foregroundSubtle,
        },
        cancelBtn: {
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.block,
          backgroundColor: tokens.surface2,
        },
        cancelText: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          fontWeight: "600",
          color: tokens.danger,
        },
      }),
    [tokens],
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Glyph name="Layers" size={14} color={tokens.accent} />
          <Text style={styles.headerTitle}>Hub Background Jobs Snapshot</Text>
        </View>
        <Text style={styles.jobCountBadge}>{jobs.length} Active</Text>
      </View>

      {jobs.map((job) => (
        <View key={job.id} style={styles.jobRow}>
          <View style={styles.jobLeft}>
            <Text style={styles.jobId}>{job.id}</Text>
            <Text style={styles.jobTarget} numberOfLines={1}>
              {job.target}
            </Text>
          </View>

          <View style={styles.jobRight}>
            <Text style={styles.jobTimer}>{job.elapsed}</Text>
            <Pressable onPress={() => cancelJob(job.id)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
              <Glyph name="X" size={10} color={tokens.danger} />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}
