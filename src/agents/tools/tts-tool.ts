import { copyFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
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

export function createTtsTool(opts?: {
  config?: OpenClawConfig;
  agentChannel?: GatewayMessageChannel;
}): AnyAgentTool {
  return {
    label: "TTS",
    name: "tts",
    description: `Convert text to speech. After a successful call, you MUST deliver the audio by replying with:\n[[audio_as_voice]]\nMEDIA:<audioPath from result>\nTo add a caption, write it before the [[audio_as_voice]] line. Example with caption:\nGood morning!\n[[audio_as_voice]]\nMEDIA:/tmp/openclaw/tts/voice.mp3\nExample without caption:\n[[audio_as_voice]]\nMEDIA:/tmp/openclaw/tts/voice.mp3\nDo NOT reply with ${SILENT_REPLY_TOKEN} — always include the MEDIA directive.`,
    parameters: TtsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const text = readStringParam(params, "text", { required: true });
      const channel = readStringParam(params, "channel");
      const filename = readStringParam(params, "filename");
      const cfg = opts?.config ?? loadConfig();
      const result = await textToSpeech({
        text,
        cfg,
        channel: channel ?? opts?.agentChannel,
      });

      if (result.success && result.audioPath) {
        const resolvedAudioPath = await maybeApplyFilename(result.audioPath, filename);
        // Return the audio path without a MEDIA: directive so
        // extractToolResultMediaPaths won't match it and onToolResult won't
        // eagerly deliver a captionless copy. The agent writes the MEDIA:
        // directive in its own reply (per the tool description), paired with
        // optional caption text, so delivery happens exactly once.
        return {
          content: [
            {
              type: "text",
              text: `Audio generated. Path: ${resolvedAudioPath}${result.voiceCompatible ? " (voice compatible)" : ""}`,
            },
          ],
          details: {
            audioPath: resolvedAudioPath,
            originalAudioPath: result.audioPath,
            provider: result.provider,
            filename: filename?.trim() || undefined,
            voiceCompatible: result.voiceCompatible,
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: result.error ?? "TTS conversion failed",
          },
        ],
        details: { error: result.error },
      };
    },
  };
}
