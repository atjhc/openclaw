import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { normalizeLowercaseStringOrEmpty } from "../../shared/string-coerce.js";
import {
  authorizeConfigWriteShared,
  canBypassConfigWritePolicyShared,
  formatConfigWriteDeniedMessageShared,
  resolveChannelConfigWritesShared,
  resolveConfigWriteTargetFromPathShared,
  resolveExplicitConfigWriteTargetShared,
  type ConfigWriteAuthorizationResultLike,
  type ConfigWriteScopeLike,
  type ConfigWriteTargetLike,
} from "./config-write-policy-shared.js";
import type { ChannelId } from "./types.core.js";
export type ConfigWriteScope = ConfigWriteScopeLike;
export type ConfigWriteTarget = ConfigWriteTargetLike;
export type ConfigWriteAuthorizationResult = ConfigWriteAuthorizationResultLike;

function isInternalConfigWriteMessageChannel(channel?: string | null): boolean {
  return normalizeLowercaseStringOrEmpty(channel) === "webchat";
}

export function resolveChannelConfigWrites(params: {
  cfg: OpenClawConfig;
  channelId?: ChannelId | null;
  accountId?: string | null;
}): boolean {
  return resolveChannelConfigWritesShared(params);
}

export function authorizeConfigWrite(params: {
  cfg: OpenClawConfig;
  origin?: ConfigWriteScope;
  target?: ConfigWriteTarget;
  allowBypass?: boolean;
}): ConfigWriteAuthorizationResult {
  return authorizeConfigWriteShared(params);
}

export function resolveExplicitConfigWriteTarget(scope: ConfigWriteScope): ConfigWriteTarget {
  return resolveExplicitConfigWriteTargetShared(scope);
}

export function resolveConfigWriteTargetFromPath(path: string[]): ConfigWriteTarget {
  return resolveConfigWriteTargetFromPathShared({
    path,
    normalizeChannelId: (raw) => normalizeLowercaseStringOrEmpty(raw) as ChannelId,
  });
}

export function canBypassConfigWritePolicy(params: {
  channel?: string | null;
  gatewayClientScopes?: string[] | null;
}): boolean {
  return canBypassConfigWritePolicyShared({
    ...params,
    isInternalMessageChannel: isInternalConfigWriteMessageChannel,
  });
}

export function formatConfigWriteDeniedMessage(params: {
  result: Exclude<ConfigWriteAuthorizationResult, { allowed: true }>;
  fallbackChannelId?: ChannelId | null;
}): string {
  return formatConfigWriteDeniedMessageShared(params);
}

export function authorizeConfigWrite(params: {
  cfg: OpenClawConfig;
  origin?: ConfigWriteScope;
  target?: ConfigWriteTarget;
  allowBypass?: boolean;
}): ConfigWriteAuthorizationResult {
  if (params.allowBypass) {
    return { allowed: true };
  }
  if (params.target?.kind === "ambiguous") {
    return { allowed: false, reason: "ambiguous-target" };
  }
  if (
    params.origin?.channelId &&
    !resolveChannelConfigWrites({
      cfg: params.cfg,
      channelId: params.origin.channelId,
      accountId: params.origin.accountId,
    })
  ) {
    return {
      allowed: false,
      reason: "origin-disabled",
      blockedScope: { kind: "origin", scope: params.origin },
    };
  }
  const seen = new Set<string>();
  for (const target of listConfigWriteTargetScopes(params.target)) {
    if (!target.channelId) {
      continue;
    }
    const key = `${target.channelId}:${normalizeAccountId(target.accountId)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (
      !resolveChannelConfigWrites({
        cfg: params.cfg,
        channelId: target.channelId,
        accountId: target.accountId,
      })
    ) {
      return {
        allowed: false,
        reason: "target-disabled",
        blockedScope: { kind: "target", scope: target },
      };
    }
  }
  return { allowed: true };
}

export function resolveExplicitConfigWriteTarget(scope: ConfigWriteScope): ConfigWriteTarget {
  if (!scope.channelId) {
    return { kind: "global" };
  }
  const accountId = normalizeAccountId(scope.accountId);
  if (!accountId || accountId === DEFAULT_ACCOUNT_ID) {
    return { kind: "channel", scope: { channelId: scope.channelId } };
  }
  return { kind: "account", scope: { channelId: scope.channelId, accountId } };
}

export function resolveConfigWriteTargetFromPath(path: string[]): ConfigWriteTarget {
  if (path[0] !== "channels") {
    return { kind: "global" };
  }
  if (path.length < 2) {
    return { kind: "ambiguous", scopes: [] };
  }
  const channelId = path[1].trim().toLowerCase() as ChannelId;
  if (!channelId) {
    return { kind: "ambiguous", scopes: [] };
  }
  if (path.length === 2) {
    return { kind: "ambiguous", scopes: [{ channelId }] };
  }
  if (path[2] !== "accounts") {
    return { kind: "channel", scope: { channelId } };
  }
  if (path.length < 4) {
    return { kind: "ambiguous", scopes: [{ channelId }] };
  }
  return resolveExplicitConfigWriteTarget({
    channelId,
    accountId: normalizeAccountId(path[3]),
  });
}

export function canBypassConfigWritePolicy(params: {
  channel?: string | null;
  gatewayClientScopes?: string[] | null;
}): boolean {
  return (
    isInternalMessageChannel(params.channel) &&
    params.gatewayClientScopes?.includes("operator.admin") === true
  );
}

export function formatConfigWriteDeniedMessage(params: {
  result: Exclude<ConfigWriteAuthorizationResult, { allowed: true }>;
  fallbackChannelId?: ChannelId | null;
}): string {
  if (params.result.reason === "ambiguous-target") {
    return "⚠️ Channel-initiated /config writes cannot replace channels, channel roots, or accounts collections. Use a more specific path or gateway operator.admin.";
  }

  const blocked = params.result.blockedScope?.scope;
  const channelLabel = blocked?.channelId ?? params.fallbackChannelId ?? "this channel";
  const hint = blocked?.channelId
    ? blocked.accountId
      ? `channels.${blocked.channelId}.accounts.${blocked.accountId}.configWrites=true`
      : `channels.${blocked.channelId}.configWrites=true`
    : params.fallbackChannelId
      ? `channels.${params.fallbackChannelId}.configWrites=true`
      : "channels.<channel>.configWrites=true";
  return `⚠️ Config writes are disabled for ${channelLabel}. Set ${hint} to enable.`;
}

function listConfigWriteTargetScopes(target?: ConfigWriteTarget): ConfigWriteScope[] {
  if (!target || target.kind === "global") {
    return [];
  }
  if (target.kind === "ambiguous") {
    return target.scopes;
  }
  return [target.scope];
}

function resolveChannelConfig(
  cfg: OpenClawConfig,
  channelId?: ChannelId | null,
): ChannelConfigWithAccounts | undefined {
  if (!channelId) {
    return undefined;
  }
  return (cfg.channels as Record<string, ChannelConfigWithAccounts> | undefined)?.[channelId];
}

function resolveChannelAccountConfig(
  channelConfig: ChannelConfigWithAccounts,
  accountId?: string | null,
): AccountConfigWithWrites | undefined {
  return resolveAccountEntry(channelConfig.accounts, normalizeAccountId(accountId));
}
