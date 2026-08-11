/**
 * Thin axios client for the TikTok Open API v2.
 *
 * Handles: Bearer auth, the { data, error } envelope, actionable error
 * messages for agents, and one automatic token-refresh retry when TikTok
 * reports access_token_invalid.
 */

import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { API_BASE } from "./constants.js";
import type { TikTokEnvelope } from "./types.js";
import type { AuthConfig } from "./auth.js";
import { getAccessToken } from "./auth.js";

/** Error carrying TikTok's error.code and message for tool output. */
export class TikTokApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly logId?: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "TikTokApiError";
  }
}

/** Map TikTok error codes to actionable agent guidance. */
export function describeErrorCode(code: string): string {
  switch (code) {
    case "access_token_invalid":
      return "The access token is invalid or expired. Run `npm run auth` to reconnect.";
    case "scope_not_authorized":
      return "The token lacks the required scope. Re-run `npm run auth` after approving the video.publish scope in the TikTok Developer Portal.";
    case "rate_limit_exceeded":
      return "Rate limit exceeded (6 requests/minute for video.publish, 20/min for Display API). Wait ~10s and retry with backoff; do not retry in a tight loop.";
    case "spam_risk_too_many_posts":
      return "Daily post cap reached for this user. Try again tomorrow.";
    case "spam_risk_user_banned_from_posting":
      return "This user is banned from posting via API. Stop all publish attempts.";
    case "reached_active_user_cap":
      return "The daily quota of active publishing users for this app is reached. Try again later.";
    case "unaudited_client_can_only_post_to_private_accounts":
      return "The app is not yet audited by TikTok, so posts are restricted to SELF_ONLY privacy. Submit the app for audit to lift the restriction.";
    case "url_ownership_unverified":
      return "PULL_FROM_URL requires a domain verified in the Developer Portal. Upload the file locally instead (source=FILE_UPLOAD).";
    case "privacy_level_option_mismatch":
      return "privacy_level must be one of the options from tiktok_get_creator_info. Query creator info first and pick from privacy_level_options.";
    case "invalid_param":
      return "One or more parameters are invalid. Check the message for details.";
    case "quota_exceeded":
      return "Quota exceeded for this endpoint.";
    default:
      return `TikTok error: ${code}.`;
  }
}

export class TikTokClient {
  constructor(private readonly cfg: AuthConfig) {}

  /**
   * Perform a TikTok API request, unwrapping the envelope and throwing a
   * TikTokApiError with actionable guidance on failure.
   */
  async request<T>(
    path: string,
    method: "GET" | "POST" | "PUT" = "POST",
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    retried = false
  ): Promise<T> {
    const token = await getAccessToken(this.cfg);
    const config: AxiosRequestConfig = {
      method,
      url: `${API_BASE}${path}`,
      timeout: 120_000,
      headers: {
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      },
      ...(body !== undefined ? { data: body } : {}),
    };

    let res;
    try {
      res = await axios.request<TikTokEnvelope<T>>(config);
    } catch (err) {
      throw this.toApiError(err);
    }

    const envelope = res.data;
    if (envelope.error && envelope.error.code !== "ok") {
      const code = envelope.error.code;
      if (code === "access_token_invalid" && !retried) {
        // Force a refresh by throwing away the cached token, then retry once.
        const token2 = await getAccessToken(this.cfg);
        const retryConfig: AxiosRequestConfig = {
          ...config,
          headers: { ...config.headers, Authorization: `Bearer ${token2}` },
        };
        try {
          res = await axios.request<TikTokEnvelope<T>>(retryConfig);
          const retryEnv = res.data;
          if (retryEnv.error && retryEnv.error.code !== "ok") {
            throw new TikTokApiError(
              retryEnv.error.code,
              retryEnv.error.message || describeErrorCode(retryEnv.error.code),
              retryEnv.error.log_id
            );
          }
          return retryEnv.data as T;
        } catch (err) {
          if (err instanceof TikTokApiError) throw err;
          throw this.toApiError(err);
        }
      }
      throw new TikTokApiError(
        code,
        envelope.error.message || describeErrorCode(code),
        envelope.error.log_id
      );
    }
    return envelope.data as T;
  }

  private toApiError(err: unknown): TikTokApiError {
    if (err instanceof TikTokApiError) return err;
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      if (err.code === "ECONNABORTED") {
        return new TikTokApiError("timeout", "Request timed out. Try again.", undefined, status);
      }
      if (err.response) {
        // Some endpoints return error info in the HTTP body without a 2xx.
        const body = err.response.data as { error?: { code?: string; message?: string } };
        const code = body?.error?.code;
        if (code) {
          return new TikTokApiError(
            code,
            body.error?.message || describeErrorCode(code),
            undefined,
            status
          );
        }
        return new TikTokApiError(
          `http_${status}`,
          `HTTP ${status} from TikTok API. ${describeErrorCode(`http_${status}`)}`,
          undefined,
          status
        );
      }
      return new TikTokApiError("network", `Network error: ${err.message}`);
    }
    return new TikTokApiError(
      "unknown",
      err instanceof Error ? err.message : String(err)
    );
  }
}
