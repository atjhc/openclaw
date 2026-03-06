import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import { BridgeClient, BridgeError } from "./client.js";

type PluginConfig = {
  url?: string;
};

export function createScriptingBridgeTool(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginConfig;
  const url = cfg.url;
  if (!url) {
    throw new Error("mac-bridge plugin requires a url in its config");
  }

  const client = new BridgeClient(url);

  return {
    name: "mac_bridge",
    description: `Call the MacBridge server to interact with macOS apps (Calendar, Contacts, Mail, Things, Notes, NetNewsWire, Reminders, Messages, Shortcuts).
Workflow: call list_bridges to see what's available, then schema to discover endpoints, then call to invoke them.`,

    parameters: Type.Object(
      {
        action: Type.Unsafe<"list_bridges" | "schema" | "call">({
          type: "string",
          enum: ["list_bridges", "schema", "call"],
          description: [
            "list_bridges – list all available bridges with their status",
            "schema – fetch the endpoint schema for a bridge (use before calling for the first time)",
            "call – invoke an endpoint on a bridge",
          ].join("; "),
        }),
        bridge: Type.Optional(
          Type.String({
            description:
              "Bridge prefix to target (e.g. calendar, contacts, mail, things, notes, nnw, reminders, messages, shortcuts). Required for schema and call.",
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
            description:
              'Endpoint path within the bridge, e.g. "/calendars", "/todos". Required for call.',
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
            return result(await client.listBridges());
          }

          case "schema": {
            const bridge = requireString(params.bridge, "bridge");
            return result(await client.schema(bridge));
          }

          case "call": {
            const bridge = requireString(params.bridge, "bridge");
            const path = requireString(params.path, "path");
            const method = params.method as string | undefined;
            if (method === "POST") {
              return result(await client.post(bridge, path, params.body));
            }
            const query = toPrimitiveRecord(params.query);
            return result(await client.get(bridge, path, query));
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
      } catch (e) {
        if (e instanceof BridgeError) {
          return result(e.data);
        }
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

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function result(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: { data },
  };
}
