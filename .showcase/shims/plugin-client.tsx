import { useCallback } from "react";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";

/**
 * Host-injected client hooks, stubbed for the offline screenshot harness.
 * Only the shapes the presentational path touches are provided.
 */
export function usePaseo() {
  return {} as never;
}

export function useAgent<T>(_agentId: string, selector: (agent: never) => T): T | null {
  void selector;
  return null;
}

export function useWorkspace<T>(_workspaceId: string, selector: (workspace: never) => T): T | null {
  void selector;
  return null;
}

// The showcase returns plain tokens and needs no daemon.
export function useRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(
  contract: PluginRpcContract<InputSchema, OutputSchema>,
): (input: ZodInput<InputSchema>) => Promise<ZodOutput<OutputSchema>> {
  return useCallback(async (input: ZodInput<InputSchema>) => {
    if (contract.name !== "highlight.tokens") throw new Error("No daemon in the offline showcase");
    const request = input as { code: string; diffBodyCode?: string };
    const plainLines = (code: string) => code.trimEnd().split("\n").map((text) => [{ text, color: null }]);
    return {
      lines: plainLines(request.code),
      diffLines: request.diffBodyCode ? plainLines(request.diffBodyCode) : undefined,
      language: null,
      theme: "showcase",
    } as ZodOutput<OutputSchema>;
  }, [contract]);
}

export function useSettings() {
  return { status: "ready" } as never;
}
