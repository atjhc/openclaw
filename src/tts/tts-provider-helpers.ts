import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { normalizeOptionalLowercaseString } from "../shared/string-coerce.js";

const TEMP_FILE_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export function requireInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
}

export function normalizeLanguageCode(code?: string): string | undefined {
  const normalized = normalizeOptionalLowercaseString(code);
  if (!normalized) {
    return undefined;
  }
  if (!/^[a-z]{2}$/.test(normalized)) {
    throw new Error("languageCode must be a 2-letter ISO 639-1 code (e.g. en, de, fr)");
  }
  return normalized;
}

export function normalizeApplyTextNormalization(mode?: string): "auto" | "on" | "off" | undefined {
  const normalized = normalizeOptionalLowercaseString(mode);
  if (!normalized) {
    return undefined;
  }
  if (normalized === "auto" || normalized === "on" || normalized === "off") {
    return normalized;
  }
  throw new Error("applyTextNormalization must be one of: auto, on, off");
}

export function normalizeSeed(seed?: number): number | undefined {
  if (seed == null) {
    return undefined;
  }
  const next = Math.floor(seed);
  if (!Number.isFinite(next) || next < 0 || next > 4_294_967_295) {
    throw new Error("seed must be between 0 and 4294967295");
  }
  return next;
}

function archiveTtsAudio(tempDir: string): void {
  try {
    const archiveDir = path.join(resolveStateDir(), "tts-archive");
    mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    const files = readdirSync(tempDir);
    for (const file of files) {
      const ext = path.extname(file);
      const id = randomBytes(4).toString("hex");
      const dest = path.join(archiveDir, `${id}${ext}`);
      copyFileSync(path.join(tempDir, file), dest);
    }
  } catch {
    // best-effort; don't break TTS if archive fails
  }
}

export function scheduleCleanup(
  tempDir: string,
  delayMs: number = TEMP_FILE_CLEANUP_DELAY_MS,
): void {
  archiveTtsAudio(tempDir);
  const timer = setTimeout(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }, delayMs);
  timer.unref();
}
