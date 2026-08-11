/**
 * Display API tools: read-only access to the authenticated user's profile
 * and videos. Scopes: user.info.basic, video.list.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TikTokClient } from "../client.js";
import type { TikTokVideoListData, TikTokVideoQueryData, TikTokUserInfo } from "../types.js";
import { MAX_COUNT_DEFAULT, MAX_COUNT_LIMIT, USER_INFO_FIELDS, VIDEO_FIELDS, VIDEO_QUERY_MAX_IDS } from "../constants.js";
import { clampText, formatUser, formatVideoDetail, formatVideoShort } from "../format.js";

export function registerDisplayTools(server: McpServer, client: TikTokClient): void {
  server.registerTool(
    "tiktok_get_user_info",
    {
      title: "Get TikTok user info",
      description: `Get profile information and stats for the authenticated TikTok account.

Reads the current user's profile (display name, avatar, bio) and, when the
user.info.stats scope is granted, follower/following/like/video counts.

Args:
  - fields (string[]): subset of user fields to request; defaults to all.
    Supported: ${USER_INFO_FIELDS.join(", ")}

Returns:
  A markdown profile summary plus structured fields:
  { open_id, union_id, avatar_url, display_name, bio_description,
    is_verified, follower_count, following_count, likes_count, video_count }

Examples:
  - "What's my follower count?" -> omit fields
  - "Show my display name and bio" -> fields=["display_name","bio_description"]

Error Handling:
  - "Missing TikTok OAuth tokens..." -> run \`npm run auth\` first
  - "TikTok error: scope_not_authorized" -> approve user.info.basic scope`,
      inputSchema: z
        .object({
          fields: z
            .array(z.enum(USER_INFO_FIELDS))
            .optional()
            .describe("User fields to request (defaults to all supported fields)"),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ fields }) => {
      const wanted = fields ?? [...USER_INFO_FIELDS];
      const data = await client.request<{ user: TikTokUserInfo }>(
        `/user/info/?fields=${encodeURIComponent(wanted.join(","))}`,
        "GET"
      );
      const user = data.user ?? {};
      const output = Object.fromEntries(
        wanted.map((f) => [f, user[f as keyof TikTokUserInfo] ?? null])
      );
      return {
        content: [{ type: "text", text: clampText(formatUser(output)) }],
        structuredContent: output,
      };
    }
  );

  server.registerTool(
    "tiktok_list_videos",
    {
      title: "List TikTok videos",
      description: `List the authenticated user's most recent TikTok videos, newest first.

Supports pagination via cursor for walking the full history. Engagement
counts (likes/comments/shares/views) are included when the API returns them.

Args:
  - max_count (number): 1-${MAX_COUNT_LIMIT}, default ${MAX_COUNT_DEFAULT}
  - cursor (number): pagination cursor from the previous response
  - fields (string[]): optional subset of video fields

Returns:
  Structured: { videos: [...], cursor, has_more } plus markdown summary.

Examples:
  - "List my 20 most recent videos" -> no args
  - "Show me my videos from the last month" -> walk with cursor until
    create_time older than the window, or until has_more is false

Error Handling:
  - Missing token -> run \`npm run auth\`
  - HTTP 429 -> back off; Display API limit is 20 requests/minute`,
      inputSchema: z
        .object({
          max_count: z
            .number()
            .int()
            .min(1)
            .max(MAX_COUNT_LIMIT)
            .default(MAX_COUNT_DEFAULT)
            .describe("Maximum number of videos to return"),
          cursor: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Pagination cursor from a previous response"),
          fields: z
            .array(z.enum(VIDEO_FIELDS))
            .optional()
            .describe("Video fields to request (defaults to all supported)"),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ max_count, cursor, fields }) => {
      const wanted = fields ?? [...VIDEO_FIELDS];
      const body: Record<string, unknown> = { max_count };
      if (cursor !== undefined) body.cursor = cursor;
      const data = await client.request<TikTokVideoListData>(
        `/video/list/?fields=${encodeURIComponent(wanted.join(","))}`,
        "POST",
        body
      );
      const videos = data.videos ?? [];
      const text = videos.length
        ? videos.map((v) => formatVideoShort(v)).join("\n") +
          `\n\nhas_more: ${data.has_more}${data.has_more ? ` | next cursor: ${data.cursor}` : ""}`
        : "No videos found for this account.";
      return {
        content: [{ type: "text", text: clampText(text) }],
        structuredContent: {
          videos,
          cursor: data.cursor,
          has_more: data.has_more,
        },
      };
    }
  );

  server.registerTool(
    "tiktok_get_video_details",
    {
      title: "Get TikTok video details",
      description: `Fetch detailed metadata for up to ${VIDEO_QUERY_MAX_IDS} of the authenticated user's videos by ID.

Useful after tiktok_list_videos to drill into specific videos, refresh
cover/embed URLs, or read engagement counts for a set of videos.

Args:
  - video_ids (string[]): 1-${VIDEO_QUERY_MAX_IDS} TikTok video IDs

Returns:
  Structured: { videos: [...] } plus markdown detail per video.

Examples:
  - "Show me stats for videos 123 and 456" -> video_ids=["123","456"]

Error Handling:
  - Unknown video IDs are silently omitted by TikTok; check the count of
    returned videos against the requested IDs`,
      inputSchema: z
        .object({
          video_ids: z
            .array(z.string().min(1))
            .min(1)
            .max(VIDEO_QUERY_MAX_IDS)
            .describe("TikTok video IDs to look up"),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ video_ids }) => {
      const wanted = [...VIDEO_FIELDS];
      const data = await client.request<TikTokVideoQueryData>(
        `/video/query/?fields=${encodeURIComponent(wanted.join(","))}`,
        "POST",
        { filters: { video_ids } }
      );
      const videos = data.videos ?? [];
      const text = videos.length
        ? videos.map((v) => formatVideoDetail(v as Record<string, unknown>)).join("\n\n---\n\n")
        : `No details returned for the requested IDs: ${video_ids.join(", ")}`;
      return {
        content: [{ type: "text", text: clampText(text) }],
        structuredContent: { videos },
      };
    }
  );
}
