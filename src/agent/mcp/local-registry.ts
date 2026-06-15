import type { Capability, CapabilityRegistry, ToolResult } from "./types.ts";

export function createLocalCapabilityRegistry(
  capabilities: Capability[] = [],
  handlers: Record<string, (input: unknown) => Promise<unknown> | unknown> = {}
): CapabilityRegistry {
  const entries = new Map<string, { capability: Capability; handler?: (input: unknown) => Promise<unknown> | unknown }>();
  for (const capability of capabilities) {
    entries.set(capability.toolName, { capability, handler: handlers[capability.toolName] });
  }

  return {
    registerCapability(capability, handler) {
      entries.set(capability.toolName, { capability, handler });
    },
    discoverCapabilities() {
      return [...entries.values()].map((entry) => entry.capability);
    },
    hasCapability(capabilityName) {
      return [...entries.values()].some((entry) => entry.capability.name === capabilityName || entry.capability.toolName === capabilityName);
    },
    async invokeCapability<T = unknown>(toolName: string, input: unknown): Promise<ToolResult<T>> {
      const entry = entries.get(toolName);
      if (!entry) {
        return {
          status: "failed",
          error: `Local capability not registered: ${toolName}`,
          observationTrusted: false
        };
      }
      if (!entry.handler) {
        return {
          status: "blocked",
          error: `Local capability has no handler: ${toolName}`,
          observationTrusted: false
        };
      }
      return {
        status: "succeeded",
        output: (await entry.handler(input)) as T,
        observationTrusted: false
      };
    }
  };
}

