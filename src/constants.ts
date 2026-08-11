/**
 * Shared constants for the TikTok MCP server.
 * Endpoint paths and auth flows are grounded in the official TikTok docs:
 * - Content Posting API: https://developers.tiktok.com/doc/content-posting-api-get-started
 * - Display API: https://developers.tiktok.com/doc/display-api-get-started/
 * - Login Kit: https://developers.tiktok.com/doc/login-kit-manage-user-access-tokens
 */

/** Base URL for all TikTok Open API v2 endpoints. */
export const API_BASE = "https://open.tiktokapis.com/v2";

/** OAuth 2.0 authorization endpoint (Login Kit). */
export const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";

/** OAuth 2.0 token endpoint (authorization_code + refresh_token grants). */
export const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/**
 * Scopes requested during OAuth. Each scope must be approved for the app in
 * the TikTok Developer Portal before the flow will succeed.
 */
export const DEFAULT_SCOPES = "user.info.basic,video.list,video.publish";

/** Local callback port for the CLI auth flow. */
export const AUTH_CALLBACK_PORT = 8787;

/**
 * TikTok access tokens expire every 24h; refresh tokens every 365 days.
 * We refresh pre-emptively once the access token is within this window of
 * expiring, so long-running agent sessions do not hit access_token_invalid.
 */
export const REFRESH_SKEW_SECONDS = 6 * 60 * 60;

/** Maximum response size for tool text output, in characters. */
export const CHARACTER_LIMIT = 25000;

/** Content Posting API rate limit: 6 requests/min per user access token. */
export const POST_RATE_LIMIT_PER_MINUTE = 6;

/** Display API video/list pagination bounds. */
export const MAX_COUNT_DEFAULT = 20;
export const MAX_COUNT_LIMIT = 20;

/** video/query accepts at most this many video IDs per call. */
export const VIDEO_QUERY_MAX_IDS = 10;

/** Fields supported by the Display API user/info endpoint. */
export const USER_INFO_FIELDS = [
  "open_id",
  "union_id",
  "avatar_url",
  "display_name",
  "bio_description",
  "is_verified",
  "follower_count",
  "following_count",
  "likes_count",
  "video_count",
] as const;

/** Fields supported by the Display API video/list and video/query endpoints. */
export const VIDEO_FIELDS = [
  "id",
  "title",
  "video_description",
  "duration",
  "cover_image_url",
  "share_url",
  "embed_link",
  "like_count",
  "comment_count",
  "share_count",
  "view_count",
  "create_time",
  "is_aigc",
  "music_id",
  "hashtag_list",
  "mention_list",
  "video_metadata",
] as const;

/** Privacy levels accepted by the Content Posting API. */
export const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

/** Post modes accepted by the Content Posting API. */
export const POST_MODES = ["DIRECT_POST", "INBOX"] as const;

/** Terminals states of the publish-status poll. */
export const TERMINAL_PUBLISH_STATUSES = [
  "PUBLISH_COMPLETE",
  "PUBLISH_FAILED",
  "UPLOAD_FAILED",
  "PROCESSING_UPLOAD",
] as const;
