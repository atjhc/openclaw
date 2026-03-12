import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    textToSpeechMock.mockReset();
    copyFileMock.mockReset();
  });

  it("uses SILENT_REPLY_TOKEN in guidance text", () => {
    const tool = createTtsTool();

    expect(tool.description).toContain("QUIET_TOKEN");
    expect(tool.description).not.toContain("NO_REPLY");
  });

  it("returns renamed media path when filename is provided", async () => {
    textToSpeechMock.mockResolvedValueOnce({
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
      filenameApplied: true,
      safeMode: false,
    });
  });

  it("sanitizes filename and preserves extension fallback", async () => {
    textToSpeechMock.mockResolvedValueOnce({
      success: true,
      audioPath: "/tmp/openclaw/tts-456/voice-xyz.mp3",
      voiceCompatible: false,
      provider: "edge",
    });

    const tool = createTtsTool();
    await tool.execute("call-2", {
      text: "hello",
      filename: "../../weird title",
    });

    expect(copyFileMock).toHaveBeenLastCalledWith(
      "/tmp/openclaw/tts-456/voice-xyz.mp3",
      "/tmp/openclaw/tts-456/weird-title.mp3",
    );
  });

  it("safeMode bypasses filename rewriting and forces edge override", async () => {
    textToSpeechMock.mockResolvedValueOnce({
      success: true,
      audioPath: "/tmp/openclaw/tts-789/voice-safe.mp3",
      voiceCompatible: true,
      provider: "edge",
    });

    const tool = createTtsTool();
    const result = await tool.execute("call-3", {
      text: "hello",
      filename: "ignored.mp3",
      safeMode: true,
    });

    expect(copyFileMock).not.toHaveBeenCalled();
    expect(textToSpeechMock).toHaveBeenCalledWith(
      expect.objectContaining({ overrides: { provider: "edge" } }),
    );
    expect(result.content[0]).toMatchObject({
      text: "[[audio_as_voice]]\nMEDIA:/tmp/openclaw/tts-789/voice-safe.mp3",
    });
  });

  it("retries once in safe fallback when first synth fails", async () => {
    textToSpeechMock
      .mockResolvedValueOnce({ success: false, error: "openai: server error" })
      .mockResolvedValueOnce({
        success: true,
        audioPath: "/tmp/openclaw/tts-999/voice-fallback.mp3",
        voiceCompatible: false,
        provider: "edge",
      });

    const tool = createTtsTool();
    const result = await tool.execute("call-4", {
      text: "hello",
      filename: "try-me.mp3",
    });

    expect(textToSpeechMock).toHaveBeenCalledTimes(2);
    expect(textToSpeechMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ overrides: { provider: "edge" } }),
    );
    expect(result.details).toMatchObject({
      usedSafeFallback: true,
      provider: "edge",
    });
  });
});
