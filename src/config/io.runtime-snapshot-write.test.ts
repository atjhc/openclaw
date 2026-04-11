import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  projectConfigOntoRuntimeSourceSnapshot,
  resetConfigRuntimeState,
  setRuntimeConfigSnapshotRefreshHandler,
  setRuntimeConfigSnapshot,
} from "./io.js";
import type { OpenClawConfig } from "./types.js";

function createSourceConfig(): OpenClawConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
          models: [],
        },
      },
    },
  };
}

function createRuntimeConfig(): OpenClawConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-runtime-resolved", // pragma: allowlist secret
          models: [],
        },
      },
    },
  };
}

function resetRuntimeConfigState(): void {
  setRuntimeConfigSnapshotRefreshHandler(null);
  resetConfigRuntimeState();
}

describe("runtime config snapshot writes", () => {
  beforeEach(() => {
    resetRuntimeConfigState();
  });

  afterEach(() => {
    resetRuntimeConfigState();
  });

  it("skips source projection for non-runtime-derived configs", () => {
    const sourceConfig: OpenClawConfig = {
      ...createSourceConfig(),
      gateway: {
        auth: {
          mode: "token",
        },
      },
    };
    const runtimeConfig: OpenClawConfig = {
      ...createRuntimeConfig(),
      gateway: {
        auth: {
          mode: "token",
        },
      },
    };
    const independentConfig: OpenClawConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-independent-config", // pragma: allowlist secret
            models: [],
          },
        },
      },
    };

    setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
    const projected = projectConfigOntoRuntimeSourceSnapshot(independentConfig);
    expect(projected).toBe(independentConfig);
  });

  it("keeps the last-known-good runtime snapshot active while a specialized refresh is pending", async () => {
    await withTempHome("openclaw-config-runtime-refresh-pending-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const sourceConfig = createSourceConfig();
      const runtimeConfig = createRuntimeConfig();
      const nextRuntimeConfig: OpenClawConfig = {
        ...runtimeConfig,
        gateway: { auth: { mode: "token" as const } },
      };

      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(sourceConfig, null, 2)}\n`, "utf8");

      let releaseRefresh!: () => void;
      const refreshPending = new Promise<boolean>((resolve) => {
        releaseRefresh = () => resolve(true);
      });

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        setRuntimeConfigSnapshotRefreshHandler({
          refresh: async ({ sourceConfig: refreshedSource }) => {
            expect(refreshedSource.gateway?.auth).toEqual({ mode: "token" });
            expect(loadConfig().gateway?.auth).toBeUndefined();
            return await refreshPending;
          },
        });

        const writePromise = writeConfigFile(nextRuntimeConfig);
        await Promise.resolve();

        expect(loadConfig().gateway?.auth).toBeUndefined();
        releaseRefresh();
        await writePromise;
      } finally {
        resetRuntimeConfigState();
      }
    });
  });
});
