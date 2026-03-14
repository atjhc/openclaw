import { describe, expect, it, vi } from "vitest";

vi.mock("../../auto-reply/tokens.js", () => ({
  SILENT_REPLY_TOKEN: "QUIET_TOKEN",
}));

const textToSpeechMock = vi.fn();
vi.mock("../../tts/tts.js", () => ({
  textToSpeech: textToSpeechMock,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}) as unknown,
}));

const copyFileMock = vi.fn(async () => undefined);
vi.mock("node:fs/promises", () => ({
  copyFile: copyFileMock,
}));

const { createTtsTool } = await import("./tts-tool.js");

describe("createTtsTool", () => {
  it("uses SILENT_REPLY_TOKEN in guidance text", () => {
    const tool = createTtsTool();

    expect(tool.description).toContain("QUIET_TOKEN");
    expect(tool.description).not.toContain("NO_REPLY");
  });

  it("returns audio path in tool result and lets agent send MEDIA", async () => {
    textToSpeechMock.mockResolvedValueOnce({
      success: true,
      audioPath: "/tmp/reply.opus",
      provider: "test",
      voiceCompatible: true,
    });

    const tool = createTtsTool();
    const result = await tool.execute("call-1", { text: "hello" });

    expect(result).toMatchObject({
      content: [
        {
          type: "text",
          text: "Audio generated. Path: /tmp/reply.opus (voice compatible)",
        },
      ],
      details: {
        audioPath: "/tmp/reply.opus",
        provider: "test",
        voiceCompatible: true,
      },
    });
    expect(JSON.stringify(result.content)).not.toContain("MEDIA:");
  });

  it("returns renamed media path when filename is provided", async () => {
    textToSpeechMock.mockResolvedValueOnce({
      success: true,
      audioPath: "/tmp/openclaw/tts-123/voice-abc.mp3",
      voiceCompatible: false,
      provider: "edge",
    });

    const tool = createTtsTool();
    const result = await tool.execute("call-2", {
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
