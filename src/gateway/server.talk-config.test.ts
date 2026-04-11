import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "../infra/device-identity.js";
import { withEnvAsync } from "../test-utils/env.js";
import { buildDeviceAuthPayload } from "./device-auth.js";
import { validateTalkConfigResult } from "./protocol/index.js";
import { withSpeechProviders } from "./talk.test-helpers.js";
import {
  connectOk,
  createGatewaySuiteHarness,
  installGatewayTestHooks,
  readConnectChallengeNonce,
  rpcReq,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

type GatewayHarness = Awaited<ReturnType<typeof createGatewaySuiteHarness>>;
type GatewaySocket = Awaited<ReturnType<GatewayHarness["openWs"]>>;
type SecretRef = { source?: string; provider?: string; id?: string };
type TalkConfigPayload = {
  config?: {
    talk?: {
      provider?: string;
      providers?: {
        [providerId: string]: { voiceId?: string; apiKey?: string | SecretRef } | undefined;
      };
      resolved?: {
        provider?: string;
        config?: { voiceId?: string; apiKey?: string | SecretRef };
      };
      silenceTimeoutMs?: number;
    };
    session?: { mainKey?: string };
    ui?: { seamColor?: string };
  };
};
type TalkConfig = NonNullable<NonNullable<TalkConfigPayload["config"]>["talk"]>;
const GENERIC_TALK_PROVIDER_ID = "acme";
const GENERIC_TALK_API_ENV = "ACME_SPEECH_API_KEY";
let harness: GatewayHarness;
let talkConfigDeviceSeq = 0;

beforeAll(async () => {
  harness = await createGatewaySuiteHarness({
    serverOptions: { auth: { mode: "token", token: "secret" } },
  });
});

afterAll(async () => {
  await harness.close();
});

async function createFreshOperatorDevice(scopes: string[], nonce: string) {
  const identity = loadOrCreateDeviceIdentity(
    path.join(os.tmpdir(), `openclaw-talk-config-device-${process.pid}-${talkConfigDeviceSeq++}`),
  );
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId: "test",
    clientMode: "test",
    role: "operator",
    scopes,
    signedAtMs,
    token: "secret",
    nonce,
  });

  return {
    id: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    signature: signDevicePayload(identity.privateKeyPem, payload),
    signedAt: signedAtMs,
    nonce,
  };
}

async function connectOperator(ws: GatewaySocket, scopes: string[]) {
  const nonce = await readConnectChallengeNonce(ws);
  expect(nonce).toBeTruthy();
  await connectOk(ws, {
    token: "secret",
    scopes,
    device: await createFreshOperatorDevice(scopes, String(nonce)),
  });
}

async function writeTalkConfig(config: {
  provider?: string;
  apiKey?: string | { source: "env" | "file" | "exec"; provider: string; id: string };
  voiceId?: string;
  silenceTimeoutMs?: number;
}) {
  const { writeConfigFile } = await import("../config/config.js");
  const providerId = config.provider ?? GENERIC_TALK_PROVIDER_ID;
  await writeConfigFile({
    talk: {
      provider: providerId,
      silenceTimeoutMs: config.silenceTimeoutMs,
      providers:
        config.apiKey !== undefined || config.voiceId !== undefined
          ? {
              [providerId]: {
                ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
                ...(config.voiceId !== undefined ? { voiceId: config.voiceId } : {}),
              },
            }
          : undefined,
    },
  });
}

async function fetchTalkConfig(
  ws: GatewaySocket,
  params?: { includeSecrets?: boolean } | Record<string, unknown>,
) {
  return rpcReq<TalkConfigPayload>(ws, "talk.config", params ?? {});
}

async function withTalkConfigConnection<T>(
  scopes: string[],
  run: (ws: GatewaySocket) => Promise<T>,
): Promise<T> {
  const ws = await harness.openWs();
  try {
    await connectOperator(ws, scopes);
    return await run(ws);
  } finally {
    ws.close();
  }
}

function expectTalkConfig(
  talk: TalkConfig | undefined,
  expected: {
    provider: string;
    voiceId?: string;
    apiKey?: string | SecretRef;
    providerApiKey?: string | SecretRef;
    resolvedApiKey?: string | SecretRef;
    silenceTimeoutMs?: number;
  },
) {
  expect(talk?.provider).toBe(expected.provider);
  expect(talk?.providers?.[expected.provider]?.voiceId).toBe(expected.voiceId);
  expect(talk?.resolved?.provider).toBe(expected.provider);
  expect(talk?.resolved?.config?.voiceId).toBe(expected.voiceId);

  if ("apiKey" in expected) {
    expect(talk?.providers?.[expected.provider]?.apiKey).toEqual(expected.apiKey);
    expect(talk?.resolved?.config?.apiKey).toEqual(expected.apiKey);
  }
  if ("providerApiKey" in expected) {
    expect(talk?.providers?.[expected.provider]?.apiKey).toEqual(expected.providerApiKey);
  }
  if ("resolvedApiKey" in expected) {
    expect(talk?.resolved?.config?.apiKey).toEqual(expected.resolvedApiKey);
  }
  if ("silenceTimeoutMs" in expected) {
    expect(talk?.silenceTimeoutMs).toBe(expected.silenceTimeoutMs);
  }
}

async function fetchTalkConfig(
  ws: GatewaySocket,
  params?: { includeSecrets?: boolean } | Record<string, unknown>,
) {
  return rpcReq<TalkConfigPayload>(ws, "talk.config", params ?? {});
}

async function fetchTalkSpeak(ws: GatewaySocket, params: Record<string, unknown>) {
  return rpcReq<TalkSpeakPayload>(ws, "talk.speak", params);
}

function expectElevenLabsTalkConfig(
  talk: TalkConfig | undefined,
  expected: {
    voiceId?: string;
    apiKey?: string | SecretRef;
    silenceTimeoutMs?: number;
  },
) {
  expect(talk?.provider).toBe("elevenlabs");
  expect(talk?.providers?.elevenlabs?.voiceId).toBe(expected.voiceId);
  expect(talk?.resolved?.provider).toBe("elevenlabs");
  expect(talk?.resolved?.config?.voiceId).toBe(expected.voiceId);
  expect(talk?.voiceId).toBe(expected.voiceId);

  if ("apiKey" in expected) {
    expect(talk?.providers?.elevenlabs?.apiKey).toEqual(expected.apiKey);
    expect(talk?.resolved?.config?.apiKey).toEqual(expected.apiKey);
    expect(talk?.apiKey).toEqual(expected.apiKey);
  }
  if ("silenceTimeoutMs" in expected) {
    expect(talk?.silenceTimeoutMs).toBe(expected.silenceTimeoutMs);
  }
}

describe("gateway talk.config", () => {
  it("returns redacted talk config for read scope", async () => {
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      talk: {
        provider: GENERIC_TALK_PROVIDER_ID,
        providers: {
          [GENERIC_TALK_PROVIDER_ID]: {
            voiceId: "voice-123",
            apiKey: "secret-key-abc", // pragma: allowlist secret
          },
        },
        silenceTimeoutMs: 1500,
      },
      session: {
        mainKey: "main-test",
      },
      ui: {
        seamColor: "#112233",
      },
    });

    await withTalkConfigConnection(["operator.read"], async (ws) => {
      const res = await fetchTalkConfig(ws);
      expect(res.ok).toBe(true);
      expectTalkConfig(res.payload?.config?.talk, {
        provider: GENERIC_TALK_PROVIDER_ID,
        voiceId: "voice-123",
        apiKey: "__OPENCLAW_REDACTED__",
        silenceTimeoutMs: 1500,
      });
      expect(res.payload?.config?.session?.mainKey).toBe("main-test");
      expect(res.payload?.config?.ui?.seamColor).toBe("#112233");
    });
  });

  it("rejects invalid talk.config params", async () => {
    await writeTalkConfig({ apiKey: "secret-key-abc" }); // pragma: allowlist secret

    await withTalkConfigConnection(["operator.read"], async (ws) => {
      const res = await fetchTalkConfig(ws, { includeSecrets: "yes" });
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain("invalid talk.config params");
    });
  });

  it("requires operator.talk.secrets for includeSecrets", async () => {
    await writeTalkConfig({ apiKey: "secret-key-abc" }); // pragma: allowlist secret

    await withTalkConfigConnection(["operator.read"], async (ws) => {
      const res = await fetchTalkConfig(ws, { includeSecrets: true });
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain("missing scope: operator.talk.secrets");
    });
  });

  it.each([
    ["operator.talk.secrets", ["operator.read", "operator.write", "operator.talk.secrets"]],
    ["operator.admin", ["operator.read", "operator.admin"]],
  ] as const)("returns secrets for %s scope", async (_label, scopes) => {
    await writeTalkConfig({ apiKey: "secret-key-abc" }); // pragma: allowlist secret

    await withTalkConfigConnection([...scopes], async (ws) => {
      const res = await fetchTalkConfig(ws, { includeSecrets: true });
      expect(res.ok).toBe(true);
      expectTalkConfig(res.payload?.config?.talk, {
        provider: GENERIC_TALK_PROVIDER_ID,
        apiKey: "secret-key-abc",
      });
    });
  });

  it("returns Talk SecretRef payloads that satisfy the protocol schema", async () => {
    await writeTalkConfig({
      apiKey: {
        source: "env",
        provider: "default",
        id: GENERIC_TALK_API_ENV,
      },
    });

    await withEnvAsync({ [GENERIC_TALK_API_ENV]: "env-acme-key" }, async () => {
      await withTalkConfigConnection(
        ["operator.read", "operator.write", "operator.talk.secrets"],
        async (ws) => {
          const res = await fetchTalkConfig(ws, { includeSecrets: true });
          expect(res.ok, JSON.stringify(res.error)).toBe(true);
          expect(validateTalkConfigResult(res.payload)).toBe(true);
          const secretRef = {
            source: "env",
            provider: "default",
            id: GENERIC_TALK_API_ENV,
          } satisfies SecretRef;
          expectTalkConfig(res.payload?.config?.talk, {
            provider: GENERIC_TALK_PROVIDER_ID,
            apiKey: secretRef,
          });
        },
      );
    });
  });

  it("preserves configured Talk provider data when plugin-owned defaults exist", async () => {
    await writeTalkConfig({
      provider: GENERIC_TALK_PROVIDER_ID,
      voiceId: "voice-from-config",
    });

    await withEnvAsync({ [GENERIC_TALK_API_ENV]: "env-acme-key" }, async () => {
      await withSpeechProviders(
        [
          {
            pluginId: "acme-talk-defaults-test",
            source: "test",
            provider: {
              id: GENERIC_TALK_PROVIDER_ID,
              label: "Acme Speech",
              isConfigured: () => true,
              resolveTalkConfig: ({ talkProviderConfig }) => ({
                ...talkProviderConfig,
                apiKey:
                  typeof process.env[GENERIC_TALK_API_ENV] === "string"
                    ? process.env[GENERIC_TALK_API_ENV]
                    : undefined,
              }),
              synthesize: async () => ({
                audioBuffer: Buffer.from([1]),
                outputFormat: "mp3",
                fileExtension: ".mp3",
                voiceCompatible: false,
              }),
            },
          },
        ],
        async () => {
          await withTalkConfigConnection(["operator.read"], async (ws) => {
            const res = await fetchTalkConfig(ws);
            expect(res.ok, JSON.stringify(res.error)).toBe(true);
            expectTalkConfig(res.payload?.config?.talk, {
              provider: GENERIC_TALK_PROVIDER_ID,
              voiceId: "voice-from-config",
              providerApiKey: undefined,
            });
          });
        },
      );
    });
  });

  it("returns canonical provider talk payloads", async () => {
    await writeTalkConfig({
      provider: GENERIC_TALK_PROVIDER_ID,
      voiceId: "voice-normalized",
    });

    await withTalkConfigConnection(["operator.read"], async (ws) => {
      const res = await fetchTalkConfig(ws);
      expect(res.ok).toBe(true);
      expectTalkConfig(res.payload?.config?.talk, {
        provider: GENERIC_TALK_PROVIDER_ID,
        voiceId: "voice-normalized",
      });
    });
  });

  it("synthesizes talk audio via the active talk provider", async () => {
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      talk: {
        provider: "openai",
        providers: {
          openai: {
            apiKey: "openai-talk-key", // pragma: allowlist secret
            voiceId: "alloy",
            modelId: "gpt-4o-mini-tts",
          },
        },
      },
    });

    const originalFetch = globalThis.fetch;
    const requestInits: RequestInit[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init) {
        requestInits.push(init);
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    globalThis.fetch = withFetchPreconnect(fetchMock);

    try {
      await withServer(async (ws) => {
        await connectOperator(ws, ["operator.read", "operator.write"]);
        const res = await fetchTalkSpeak(ws, {
          text: "Hello from talk mode.",
          voiceId: "nova",
          modelId: "tts-1",
          speed: 1.25,
        });
        expect(res.ok).toBe(true);
        expect(res.payload?.provider).toBe("openai");
        expect(res.payload?.outputFormat).toBe("mp3");
        expect(res.payload?.mimeType).toBe("audio/mpeg");
        expect(res.payload?.fileExtension).toBe(".mp3");
        expect(res.payload?.audioBase64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
      });

      expect(fetchMock).toHaveBeenCalled();
      const requestInit = requestInits.find((init) => typeof init.body === "string");
      expect(requestInit).toBeDefined();
      const body = JSON.parse(requestInit?.body as string) as Record<string, unknown>;
      expect(body.model).toBe("tts-1");
      expect(body.voice).toBe("nova");
      expect(body.speed).toBe(1.25);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves talk voice aliases case-insensitively and forwards output format", async () => {
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      talk: {
        provider: "elevenlabs",
        providers: {
          elevenlabs: {
            apiKey: "elevenlabs-talk-key", // pragma: allowlist secret
            voiceId: "voice-default",
            voiceAliases: {
              Clawd: "EXAVITQu4vr4xnSDxMaL",
            },
          },
        },
      },
    });

    const originalFetch = globalThis.fetch;
    let fetchUrl: string | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      fetchUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
    });
    globalThis.fetch = withFetchPreconnect(fetchMock);

    try {
      await withServer(async (ws) => {
        await connectOperator(ws, ["operator.read", "operator.write"]);
        const res = await fetchTalkSpeak(ws, {
          text: "Hello from talk mode.",
          voiceId: "clawd",
          outputFormat: "pcm_44100",
        });
        expect(res.ok).toBe(true);
        expect(res.payload?.provider).toBe("elevenlabs");
        expect(res.payload?.outputFormat).toBe("pcm_44100");
        expect(res.payload?.audioBase64).toBe(Buffer.from([4, 5, 6]).toString("base64"));
      });

      expect(fetchMock).toHaveBeenCalled();
      expect(fetchUrl).toContain("/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL");
      expect(fetchUrl).toContain("output_format=pcm_44100");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("allows extension speech providers through talk.speak", async () => {
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      talk: {
        provider: "acme",
        providers: {
          acme: {
            voiceId: "plugin-voice",
          },
        },
      },
    });

    const previousRegistry = getActivePluginRegistry() ?? createEmptyPluginRegistry();
    setActivePluginRegistry({
      ...createEmptyPluginRegistry(),
      speechProviders: [
        {
          pluginId: "acme-plugin",
          source: "test",
          provider: {
            id: "acme",
            label: "Acme Speech",
            isConfigured: () => true,
            synthesize: async () => ({
              audioBuffer: Buffer.from([7, 8, 9]),
              outputFormat: "mp3",
              fileExtension: ".mp3",
              voiceCompatible: false,
            }),
          },
        },
      ],
    });

    try {
      await withServer(async (ws) => {
        await connectOperator(ws, ["operator.read", "operator.write"]);
        const res = await fetchTalkSpeak(ws, {
          text: "Hello from plugin talk mode.",
        });
        expect(res.ok).toBe(true);
        expect(res.payload?.provider).toBe("acme");
        expect(res.payload?.audioBase64).toBe(Buffer.from([7, 8, 9]).toString("base64"));
      });
    } finally {
      setActivePluginRegistry(previousRegistry);
    }
  });
});
