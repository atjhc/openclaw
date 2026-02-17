import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { createScriptingBridgeTool } from "./src/tool.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createScriptingBridgeTool(api), { optional: true });
}
