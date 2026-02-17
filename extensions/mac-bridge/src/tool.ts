import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import { BridgeClient } from "./client.js";

type BridgeConfig = {
  name: string;
  url: string;
  description?: string;
};

type PluginConfig = {
  bridges?: BridgeConfig[];
};

export function createScriptingBridgeTool(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginConfig;
  const bridges = cfg.bridges ?? [];
  const clients = new Map(bridges.map((b) => [b.name, new BridgeClient(b.url)]));

  const bridgeNames = bridges.map((b) => b.name).join(", ") || "(none configured)";

  return {
    name: "scripting_bridge",
    description: `Call local scripting bridges that expose Mac app state via HTTP.
Configured bridges: ${bridgeNames}.
Workflow: call list_bridges to see what's available, then schema to discover endpoints, then call to invoke them.`,

    parameters: Type.Object(
      {
        action: Type.Unsafe<"list_bridges" | "schema" | "call">({
          type: "string",
          enum: ["list_bridges", "schema", "call"],
          description: [
            "list_bridges – list all configured bridges with their names and descriptions",
            "schema – fetch the endpoint schema for a bridge (use before calling for the first time)",
            "call – invoke an endpoint on a bridge",
          ].join("; "),
        }),
        bridge: Type.Optional(
          Type.String({
            description: `Bridge name to target. Required for schema and call. One of: ${bridgeNames}`,
          }),
        ),
        method: Type.Optional(
          Type.Unsafe<"GET" | "POST">({
            type: "string",
            enum: ["GET", "POST"],
            description: "HTTP method. Required for call.",
          }),
        ),
        path: Type.Optional(
          Type.String({
            description: 'Endpoint path, e.g. "/articles". Required for call.',
          }),
        ),
        query: Type.Optional(
          Type.Unknown({
            description:
              "Query string parameters as a key-value object, for GET calls. E.g. { unread: true, limit: 20 }",
          }),
        ),
        body: Type.Optional(
          Type.Unknown({
            description: "JSON body for POST calls. E.g. { ids: [...], read: true }",
          }),
        ),
      },
      { additionalProperties: false },
    ),

    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const action = params.action as string;

      try {
        switch (action) {
          case "list_bridges": {
            return result(
              bridges.map((b) => ({
                name: b.name,
                url: b.url,
                description: b.description ?? null,
              })),
            );
          }

          case "schema": {
            const client = resolveClient(params.bridge, clients);
            return result(await client.schema());
          }

          case "call": {
            const client = resolveClient(params.bridge, clients);
            const method = params.method as string | undefined;
            const path = params.path as string | undefined;
            if (!path) {
              throw new Error("path is required for call");
            }
            if (method === "POST") {
              return result(await client.post(path, params.body));
            }
            const query = toPrimitiveRecord(params.query);
            return result(await client.get(path, query));
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return result({ error: message });
      }
    },
  };
}

function toPrimitiveRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

function resolveClient(bridgeName: unknown, clients: Map<string, BridgeClient>): BridgeClient {
  if (typeof bridgeName !== "string" || !bridgeName) {
    throw new Error("bridge name is required");
  }
  const client = clients.get(bridgeName);
  if (!client) {
    throw new Error(
      `Unknown bridge: "${bridgeName}". Available: ${[...clients.keys()].join(", ")}`,
    );
  }
  return client;
}

function result(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: { data },
  };
}
