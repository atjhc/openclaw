import { copyFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import type { TtsDirectiveOverrides } from "../../tts/tts.js";
import { textToSpeech } from "../../tts/tts.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const TtsToolSchema = Type.Object({
  text: Type.String({ description: "Text to convert to speech." }),
  channel: Type.Optional(
    Type.String({ description: "Optional channel id to pick output format (e.g. telegram)." }),
  ),
  filename: Type.Optional(
    Type.String({
      description:
        "Optional attachment filename override (for channels that show attachment names).",
    }),
  ),
  safeMode: Type.Optional(
    Type.Boolean({
      description:
        "If true, disables filename rewriting and forces conservative edge-provider synthesis.",
    }),
  ),
  voicePreset: Type.Optional(
    Type.Union([Type.Literal("default"), Type.Literal("laszlo")], {
      description: "Voice preset. 'laszlo' pins synthesis to the stable Laszlo voice path.",
    }),
  ),
});

function sanitizeFilename(input: string, fallbackExt: string): string {
  const trimmed = input.trim();
  const base = path.basename(trimmed).replace(/[\u0000-\u001f\u007f]+/g, "");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const withDefault = cleaned || `voice${fallbackExt || ".mp3"}`;
  const ext = path.extname(withDefault);
  if (ext) {
    return withDefault;
  }
  return `${withDefault}${fallbackExt || ".mp3"}`;
}

async function maybeApplyFilename(audioPath: string, requestedFilename?: string): Promise<string> {
  if (!requestedFilename?.trim()) {
    return audioPath;
  }
  const fallbackExt = path.extname(audioPath) || ".mp3";
  const safeName = sanitizeFilename(requestedFilename, fallbackExt);
  const targetPath = path.join(path.dirname(audioPath), safeName);

  if (path.resolve(targetPath) === path.resolve(audioPath)) {
    return audioPath;
  }

  await copyFile(audioPath, targetPath);
  return targetPath;
}

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  if (Object.hasOwn(params, key) && typeof params[key] === "boolean") {
    return params[key] as boolean;
  }
  const snake = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
  if (Object.hasOwn(params, snake) && typeof params[snake] === "boolean") {
    return params[snake] as boolean;
  }
  return undefined;
}

function resolveTtsOverrides(params: {
  safeMode: boolean;
  voicePreset?: string;
}): TtsDirectiveOverrides | undefined {
  const wantsLaszlo = params.voicePreset === "laszlo";
  if (!params.safeMode && !wantsLaszlo) {
    return undefined;
  }

  // Conservative/stable path: force Edge provider (which carries the configured
  // local Laszlo voice identity in this deployment).
  return { provider: "edge" };
}

export function createTtsTool(opts?: {
  config?: OpenClawConfig;
  agentChannel?: GatewayMessageChannel;
}): AnyAgentTool {
  return {
    label: "TTS",
    name: "tts",
    description: `Convert text to speech. Audio is delivered automatically from the tool result — reply with ${SILENT_REPLY_TOKEN} after a successful call to avoid duplicate messages.`,
    parameters: TtsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const text = readStringParam(params, "text", { required: true });
      const channel = readStringParam(params, "channel");
      const filename = readStringParam(params, "filename");
      const safeMode = readBooleanParam(params, "safeMode") ?? false;
      const voicePreset = readStringParam(params, "voicePreset");

      const cfg = opts?.config ?? loadConfig();
      const primaryOverrides = resolveTtsOverrides({ safeMode, voicePreset });
      let result = await textToSpeech({
        text,
        cfg,
        channel: channel ?? opts?.agentChannel,
        overrides: primaryOverrides,
      });

      let usedSafeFallback = false;
      if (!result.success && !safeMode) {
        // Graceful fallback: retry once in conservative safe mode.
        usedSafeFallback = true;
        result = await textToSpeech({
          text,
          cfg,
          channel: channel ?? opts?.agentChannel,
          overrides: { provider: "edge" },
        });
      }

      if (result.success && result.audioPath) {
        let resolvedAudioPath = result.audioPath;
        let filenameApplied = false;

        if (!safeMode && filename?.trim()) {
          try {
            resolvedAudioPath = await maybeApplyFilename(result.audioPath, filename);
            filenameApplied = resolvedAudioPath !== result.audioPath;
          } catch {
            // Graceful fallback: keep original path if filename copy fails.
            resolvedAudioPath = result.audioPath;
          }
        }

        const lines: string[] = [];
        // Tag Telegram Opus output as a voice bubble instead of a file attachment.
        if (result.voiceCompatible) {
          lines.push("[[audio_as_voice]]");
        }
        lines.push(`MEDIA:${resolvedAudioPath}`);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            audioPath: resolvedAudioPath,
            originalAudioPath: result.audioPath,
            provider: result.provider,
            filename: filename?.trim() || undefined,
            filenameApplied,
            safeMode,
            usedSafeFallback,
            voicePreset: voicePreset || undefined,
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              result.error ??
              "TTS conversion failed. Please retry once; if it persists, use safeMode=true.",
          },
        ],
        details: { error: result.error, safeMode, usedSafeFallback },
      };
    },
  };
}
