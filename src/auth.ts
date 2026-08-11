/**
 * OAuth 2.0 (PKCE) token management for the TikTok Login Kit.
 *
 * Flow: `npm run auth` runs the CLI in src/auth-cli.ts, which uses this module
 * to generate a PKCE challenge, open the authorization URL, catch the callback
 * on localhost, exchange the code for tokens, and persist them.
 *
 * The MCP server itself never performs the interactive flow; it loads tokens
 * from TIKTOK_TOKEN_FILE (default ./tiktok-tokens.json) and refreshes them
 * automatically when the access token nears its 24h expiry.
 */

import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import axios from "axios";
import { AUTH_URL, TOKEN_URL, REFRESH_SKEW_SECONDS } from "./constants.js";
import type { TikTokTokens } from "./types.js";

export interface AuthConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  tokenFile: string;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const clientKey = env.TIKTOK_CLIENT_KEY ?? "";
  const clientSecret = env.TIKTOK_CLIENT_SECRET ?? "";
  const redirectUri =
    env.TIKTOK_REDIRECT_URI ?? `http://localhost:${8787}/callback`;
  const scopes = env.TIKTOK_SCOPES ?? "user.info.basic,video.list,video.publish";
  const tokenFile = env.TIKTOK_TOKEN_FILE ?? "tiktok-tokens.json";
  if (!clientKey || !clientSecret) {
    throw new Error(
      "Missing TikTok OAuth credentials. Set TIKTOK_CLIENT_KEY and " +
        "TIKTOK_CLIENT_SECRET (create an app at https://developers.tiktok.com " +
        "with Login Kit + Content Posting API, then approve the video.publish scope)."
    );
  }
  return { clientKey, clientSecret, redirectUri, scopes, tokenFile };
}

/** Generate a PKCE code verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Build the Login Kit authorization URL for a given PKCE challenge. */
export function buildAuthUrl(cfg: AuthConfig, challenge: string): string {
  const params = new URLSearchParams({
    client_key: cfg.clientKey,
    response_type: "code",
    scope: cfg.scopes,
    redirect_uri: cfg.redirectUri,
    state: randomBytes(16).toString("hex"),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(
  cfg: AuthConfig,
  code: string,
  verifier: string
): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
  });
  return requestTokens(cfg, body);
}

/** Refresh an expiring access token using the long-lived refresh token. */
export async function refreshTokens(
  cfg: AuthConfig,
  tokens: TikTokTokens
): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  return requestTokens(cfg, body);
}

async function requestTokens(
  cfg: AuthConfig,
  body: URLSearchParams
): Promise<TikTokTokens> {
  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30_000,
  });
  const data = res.data as {
    data: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      refresh_expires_in: number;
      open_id: string;
      scope: string;
    };
    message?: string;
  };
  const d = data.data;
  const now = Math.floor(Date.now() / 1000);
  const tokens: TikTokTokens = {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: now + d.expires_in,
    refresh_expires_at: now + d.refresh_expires_in,
    open_id: d.open_id,
    scope: d.scope,
  };
  await persistTokens(cfg.tokenFile, tokens);
  return tokens;
}

/** Load persisted tokens; returns null when none exist yet. */
export async function loadTokens(
  tokenFile: string
): Promise<TikTokTokens | null> {
  try {
    const raw = await readFile(tokenFile, "utf8");
    return JSON.parse(raw) as TikTokTokens;
  } catch {
    return null;
  }
}

function persistTokens(tokenFile: string, tokens: TikTokTokens): Promise<void> {
  const tmp = `${tokenFile}.tmp`;
  return writeFile(tmp, JSON.stringify(tokens, null, 2), "utf8")
    .then(() => rename(tmp, tokenFile))
    .catch(() => {
      /* best-effort persistence; the server still works for this process */
    });
}

/**
 * Get a valid access token, refreshing and re-persisting when the current one
 * is expired or within REFRESH_SKEW_SECONDS of expiry.
 */
export async function getAccessToken(cfg: AuthConfig): Promise<string> {
  const tokens = await loadTokens(cfg.tokenFile);
  if (!tokens) {
    throw new Error(
      "No TikTok OAuth tokens found. Run `npm run auth` first to connect your " +
        "TikTok account, then restart this server."
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (now >= tokens.refresh_expires_at) {
    throw new Error(
      "TikTok refresh token has expired (365-day lifetime). Run `npm run auth` " +
        "again to re-connect your TikTok account."
    );
  }
  if (now >= tokens.expires_at - REFRESH_SKEW_SECONDS) {
    return (await refreshTokens(cfg, tokens)).access_token;
  }
  return tokens.access_token;
}

/** True when a token file already exists (used by the auth CLI). */
export function hasTokenFile(tokenFile: string): boolean {
  return existsSync(tokenFile);
}
