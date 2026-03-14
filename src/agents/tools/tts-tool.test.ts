import { beforeEach, describe, expect, it, vi } from "vitest";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import * as ttsRuntime from "../../tts/tts.js";
import { createTtsTool } from "./tts-tool.js";

const copyFileMock = vi.fn(async () => undefined);
vi.mock("node:fs/promises", () => ({
  copyFile: copyFileMock,
}));

let textToSpeechSpy: ReturnType<typeof vi.spyOn>;

describe("createTtsTool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    copyFileMock.mockClear();
    textToSpeechSpy = vi.spyOn(ttsRuntime, "textToSpeech");
  });

  it("uses SILENT_REPLY_TOKEN in guidance text", () => {
    const tool = createTtsTool();

    expect(tool.description).toContain(SILENT_REPLY_TOKEN);
  });

  it("returns generated audio path and voice compatibility", async () => {
    textToSpeechSpy.mockResolvedValue({
      success: true,
      audioPath: "/tmp/reply.opus",
      provider: "test",
      voiceCompatible: true,
    });

    const tool = createTtsTool();
    const result = await tool.execute("call-1", { text: "hello" });

    expect(result).toMatchObject({
      content: [{ type: "text", text: "Audio generated. Path: /tmp/reply.opus (voice compatible)" }],
      details: {
        audioPath: "/tmp/reply.opus",
        provider: "test",
        voiceCompatible: true,
      },
    });
  });

  it("returns renamed media path when filename is provided", async () => {
    textToSpeechSpy.mockResolvedValueOnce({
      success: true,
      audioPath: "/tmp/openclaw/tts-123/voice-abc.mp3",
      voiceCompatible: false,
      provider: "edge",
    });

    const tool = createTtsTool();
    const result = await tool.execute("call-1", {
      text: "hello",
      filename: "laszlo-morning.mp3",
    });

    expect(copyFileMock).toHaveBeenCalledWith(
      "/tmp/openclaw/tts-123/voice-abc.mp3",
      "/tmp/openclaw/tts-123/laszlo-morning.mp3",
    );
    expect(result.details).toMatchObject({
      audioPath: "/tmp/openclaw/tts-123/laszlo-morning.mp3",
      originalAudioPath: "/tmp/openclaw/tts-123/voice-abc.mp3",
      filename: "laszlo-morning.mp3",
      voiceCompatible: false,
    });
  });
});
