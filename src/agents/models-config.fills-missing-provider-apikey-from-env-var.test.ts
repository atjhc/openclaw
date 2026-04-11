import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../plugins/manifest-registry.js");
vi.unmock("../plugins/provider-runtime.js");
vi.unmock("../plugins/provider-runtime.runtime.js");
vi.unmock("../secrets/provider-env-vars.js");

async function loadSecretsModule() {
  vi.doUnmock("../plugins/manifest-registry.js");
  vi.doUnmock("../plugins/provider-runtime.js");
  vi.doUnmock("../plugins/provider-runtime.runtime.js");
  vi.doUnmock("../secrets/provider-env-vars.js");
  vi.resetModules();
  const [{ resetProviderRuntimeHookCacheForTest }, { resetPluginLoaderTestStateForTest }] =
    await Promise.all([
      import("../plugins/provider-runtime.js"),
      import("../plugins/loader.test-fixtures.js"),
    ]);
  resetPluginLoaderTestStateForTest();
  resetProviderRuntimeHookCacheForTest();
  return import("./models-config.providers.secrets.js");
}

beforeEach(async () => {
  vi.doUnmock("../plugins/manifest-registry.js");
  vi.doUnmock("../plugins/provider-runtime.js");
  vi.doUnmock("../plugins/provider-runtime.runtime.js");
  vi.doUnmock("../secrets/provider-env-vars.js");
  vi.resetModules();
  const [{ resetProviderRuntimeHookCacheForTest }, { resetPluginLoaderTestStateForTest }] =
    await Promise.all([
      import("../plugins/provider-runtime.js"),
      import("../plugins/loader.test-fixtures.js"),
    ]);
  resetPluginLoaderTestStateForTest();
  resetProviderRuntimeHookCacheForTest();
});

function createOpenAiConfigWithResolvedApiKey(mergeMode = false): OpenClawConfig {
  return {
    models: {
      ...(mergeMode ? { mode: "merge" as const } : {}),
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-plaintext-should-not-appear", // pragma: allowlist secret; simulates resolved ${OPENAI_API_KEY}
          api: "openai-completions",
          models: [
            {
              id: "gpt-4.1",
              name: "GPT-4.1",
              input: ["text"],
              reasoning: false,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
      },
    },
  };
}

async function expectOpenAiEnvMarkerApiKey(options?: { seedMergedProvider?: boolean }) {
  await withEnvVar("OPENAI_API_KEY", "sk-plaintext-should-not-appear", async () => {
    await withTempHome(async () => {
      if (options?.seedMergedProvider) {
        await writeAgentModelsJson({
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: "STALE_AGENT_KEY", // pragma: allowlist secret
              api: "openai-completions",
              models: [{ id: "gpt-4.1", name: "GPT-4.1", input: ["text"] }],
            },
          },
        });
      }

      await ensureOpenClawModelsJson(
        createOpenAiConfigWithResolvedApiKey(options?.seedMergedProvider),
      );
      const result = await readGeneratedModelsJson<{
        providers: Record<string, { apiKey?: string }>;
      }>();
      expect(result.providers.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
    });
  });
}

async function expectMoonshotTokenLimits(params: {
  contextWindow: number;
  maxTokens: number;
  expectedContextWindow: number;
  expectedMaxTokens: number;
}) {
  await withTempHome(async () => {
    await withEnvVar("MOONSHOT_API_KEY", "sk-moonshot-test", async () => {
      await ensureOpenClawModelsJson(
        createMoonshotConfig({
          contextWindow: params.contextWindow,
          maxTokens: params.maxTokens,
        }),
      );
      const parsed = await readGeneratedModelsJson<{
        providers: Record<
          string,
          {
            models?: Array<{
              id: string;
              contextWindow?: number;
              maxTokens?: number;
            }>;
          }
        >;
      }>();
      const kimi = parsed.providers.moonshot?.models?.find((model) => model.id === "kimi-k2.5");
      expect(kimi?.contextWindow).toBe(params.expectedContextWindow);
      expect(kimi?.maxTokens).toBe(params.expectedMaxTokens);
    });
  });
}

describe("models-config", () => {
  it("fills missing provider.apiKey from env var name when models exist", async () => {
    const { resolveMissingProviderApiKey } = await loadSecretsModule();
    const provider = resolveMissingProviderApiKey({
      providerKey: "minimax",
      provider: {
        baseUrl: "https://api.minimax.io/anthropic",
        api: "anthropic-messages",
        models: [
          {
            id: "MiniMax-M2.7",
            name: "MiniMax M2.7",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
      env: { MINIMAX_API_KEY: "sk-minimax-test" } as NodeJS.ProcessEnv,
      profileApiKey: undefined,
    });

    expect(provider.apiKey).toBe("MINIMAX_API_KEY"); // pragma: allowlist secret
  });
});
