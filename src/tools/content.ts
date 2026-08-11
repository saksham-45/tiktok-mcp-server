/**
 * Content Posting API tools: publish videos, save drafts, upload files, and
 * poll publish status. Scope: video.publish.
 *
 * Safety model: tiktok_create_post defaults to post_mode=INBOX (saves a
 * draft). Publishing to a public audience requires explicitly passing
 * post_mode="DIRECT_POST" with confirm=true, which most MCP clients surface
 * as a confirmation UI.
 */

import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import type { TikTokClient } from "../client.js";
import { TikTokApiError } from "../client.js";
import type { TikTokCreatorInfo, TikTokVideoInitData } from "../types.js";
import { POST_MODES, PRIVACY_LEVELS } from "../constants.js";
import { clampText } from "../format.js";

const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

const PrivacySchema = z.enum(PRIVACY_LEVELS).describe(
  "Who can see the post. Must be one of the options from tiktok_get_creator_info"
);

const PostModeSchema = z
  .enum(POST_MODES)
  .describe(
    "DIRECT_POST publishes immediately; INBOX saves the video as a draft in the user's TikTok inbox"
  );

export function registerContentTools(server: McpServer, client: TikTokClient): void {
  server.registerTool(
    "tiktok_get_creator_info",
    {
      title: "Get TikTok creator info",
      description: `Query the authenticated creator's post settings before publishing.

Returns the creator's username, avatar, allowed privacy levels, whether
comments/duets/stitches are disabled on their account, and the maximum
video duration. TikTok requires that the privacy_level passed to
tiktok_create_post be one of privacy_level_options returned here.

Args: none

Returns:
  Structured: { creator_username, creator_nickname, privacy_level_options,
    comment_disabled, duet_disabled, stitch_disabled, max_video_post_duration_sec }

Examples:
  - Always call this before tiktok_create_post to validate privacy_level

Error Handling:
  - scope_not_authorized -> approve video.publish scope in Developer Portal`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const data = await client.request<TikTokCreatorInfo>(
        "/post/publish/creator_info/query/",
        "POST",
        {}
      );
      const output: Record<string, unknown> = {
        creator_username: data.creator_username ?? null,
        creator_nickname: data.creator_nickname ?? null,
        creator_avatar_url: data.creator_avatar_url ?? null,
        privacy_level_options: data.privacy_level_options ?? [],
        comment_disabled: data.comment_disabled ?? false,
        duet_disabled: data.duet_disabled ?? false,
        stitch_disabled: data.stitch_disabled ?? false,
        max_video_post_duration_sec: data.max_video_post_duration_sec ?? null,
      };
      const text = [
        `# Creator: ${data.creator_nickname ?? data.creator_username ?? "unknown"}`,
        `**Privacy options:** ${(data.privacy_level_options ?? []).join(", ") || "none"}`,
        `**Comments enabled:** ${!data.comment_disabled}`,
        `**Duets enabled:** ${!data.duet_disabled}`,
        `**Stitches enabled:** ${!data.stitch_disabled}`,
        `**Max duration:** ${data.max_video_post_duration_sec ?? "unknown"}s`,
      ].join("\n");
      return {
        content: [{ type: "text", text: text }],
        structuredContent: output,
      };
    }
  );

  server.registerTool(
    "tiktok_create_post",
    {
      title: "Create TikTok post (publish or draft)",
      description: `Initialize a TikTok video post on the authenticated account.

Choose ONE source:
  - file_path: local video file; the server stats the file and initializes a
    chunked upload, returning an upload_url. Then call tiktok_upload_video
    with that upload_url to transfer the bytes.
  - video_url: public HTTPS URL of the video (requires the domain verified in
    the TikTok Developer Portal); TikTok pulls the file itself.

Publishing behavior:
  - post_mode=INBOX (default): saves the video as a draft in the user's
    TikTok inbox. Nothing is published.
  - post_mode=DIRECT_POST: publishes immediately. REQUIRES confirm=true.
    Never publish without explicit user confirmation.

Important TikTok constraints:
  - privacy_level must come from tiktok_get_creator_info's privacy_level_options
  - Unaudited apps can only post with privacy_level=SELF_ONLY
  - Rate limit: 6 requests/minute per user access token

Args:
  - post_mode ('INBOX' | 'DIRECT_POST'): default 'INBOX'
  - confirm (boolean): required true when post_mode='DIRECT_POST'
  - title (string): caption, max 2200 chars; #hashtags and @mentions supported
  - privacy_level: one of ${PRIVACY_LEVELS.join(" | ")}
  - disable_comment / disable_duet / disable_stitch (boolean)
  - video_cover_timestamp_ms (number): cover frame in ms
  - is_aigc (boolean): mark content as AI-generated
  - brand_content_toggle / brand_organic_toggle (boolean)
  - file_path OR video_url: exactly one

Returns:
  Structured: { publish_id, upload_url?, post_mode }
  For FILE_UPLOAD, follow up with tiktok_upload_video(upload_url, file_path),
  then poll tiktok_get_post_status(publish_id) until terminal.

Examples:
  - Save draft: create_post(file_path="/videos/clip.mp4", title="New #cat video")
  - Publish: creator_info first, then
    create_post(video_url="https://cdn.example.com/clip.mp4",
                post_mode="DIRECT_POST", confirm=true,
                privacy_level="PUBLIC_TO_EVERYONE", title="Hi @tiktok #fyp")

Error Handling:
  - privacy_level_option_mismatch -> re-query creator info and pick a valid option
  - unaudited_client_can_only_post_to_private_accounts -> use SELF_ONLY or get audited
  - url_ownership_unverified -> switch to file_path source
  - spam_risk_too_many_posts -> daily cap reached; stop for today
  - rate_limit_exceeded -> wait and retry with backoff`,
      inputSchema: z
        .object({
          post_mode: PostModeSchema.default("INBOX"),
          confirm: z
            .boolean()
            .optional()
            .describe("Must be true when post_mode is DIRECT_POST"),
          title: z
            .string()
            .max(2200, "Caption max is 2200 UTF-16 code units")
            .optional()
            .describe("Video caption; supports #hashtags and @mentions"),
          privacy_level: PrivacySchema.optional(),
          disable_comment: z.boolean().optional().describe("Disable comments on this post"),
          disable_duet: z.boolean().optional().describe("Disable duets on this post"),
          disable_stitch: z.boolean().optional().describe("Disable stitches on this post"),
          video_cover_timestamp_ms: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Cover frame timestamp in milliseconds"),
          is_aigc: z.boolean().optional().describe("Mark as AI-generated content"),
          brand_content_toggle: z.boolean().optional().describe("Paid partnership content"),
          brand_organic_toggle: z.boolean().optional().describe("Promotes creator's own business"),
          file_path: z
            .string()
            .optional()
            .describe("Local path to the video file (FILE_UPLOAD source)"),
          video_url: z
            .string()
            .url()
            .optional()
            .describe("Public HTTPS URL of the video (PULL_FROM_URL source)"),
        })
        .strict()
        .superRefine((val, ctx) => {
          const hasFile = val.file_path !== undefined;
          const hasUrl = val.video_url !== undefined;
          if (hasFile === hasUrl) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Provide exactly one of file_path (local upload) or video_url (pull-from-URL)",
            });
          }
          if (val.post_mode === "DIRECT_POST" && val.confirm !== true) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "post_mode=DIRECT_POST requires confirm=true. Use INBOX to save a draft instead.",
            });
          }
          if (val.post_mode === "INBOX" && val.confirm !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "confirm is only valid with post_mode=DIRECT_POST",
            });
          }
        }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const sourceInfo: Record<string, unknown> = {};
      if (params.file_path !== undefined) {
        let size: number;
        try {
          size = (await stat(params.file_path)).size;
        } catch {
          throw new TikTokApiError(
            "invalid_param",
            `Cannot read file at ${params.file_path}. Check the path and that the server process can read it.`
          );
        }
        sourceInfo.source = "FILE_UPLOAD";
        sourceInfo.video_size = size;
      } else {
        sourceInfo.source = "PULL_FROM_URL";
        sourceInfo.video_url = params.video_url;
      }

      const postInfo: Record<string, unknown> = {};
      if (params.title !== undefined) postInfo.title = params.title;
      if (params.privacy_level !== undefined) postInfo.privacy_level = params.privacy_level;
      if (params.disable_comment !== undefined) postInfo.disable_comment = params.disable_comment;
      if (params.disable_duet !== undefined) postInfo.disable_duet = params.disable_duet;
      if (params.disable_stitch !== undefined) postInfo.disable_stitch = params.disable_stitch;
      if (params.video_cover_timestamp_ms !== undefined)
        postInfo.video_cover_timestamp_ms = params.video_cover_timestamp_ms;
      if (params.is_aigc !== undefined) postInfo.is_aigc = params.is_aigc;
      if (params.brand_content_toggle !== undefined)
        postInfo.brand_content_toggle = params.brand_content_toggle;
      if (params.brand_organic_toggle !== undefined)
        postInfo.brand_organic_toggle = params.brand_organic_toggle;

      const data = await client.request<TikTokVideoInitData>(
        "/post/publish/video/init/",
        "POST",
        {
          post_info: postInfo,
          source_info: sourceInfo,
          post_mode: params.post_mode,
        }
      );

      const output = {
        publish_id: data.publish_id,
        upload_url: data.upload_url ?? null,
        post_mode: params.post_mode,
        next_step:
          data.upload_url
            ? "Call tiktok_upload_video with this upload_url and the same file_path, then poll tiktok_get_post_status."
            : "TikTok is processing the pull-from-URL upload. Poll tiktok_get_post_status with the publish_id.",
      };
      return {
        content: [
          {
            type: "text",
            text:
              params.post_mode === "INBOX"
                ? `Draft saved. publish_id: ${data.publish_id}. The video is in the account's inbox.`
                : `Post initialized for publishing. publish_id: ${data.publish_id}.`,
          },
        ],
        structuredContent: output,
      };
    }
  );

  server.registerTool(
    "tiktok_upload_video",
    {
      title: "Upload TikTok video file",
      description: `Upload a local video file to TikTok using an upload_url from tiktok_create_post.

Performs the Content Posting API PUT transfer (Content-Range + video MIME
type). The upload_url is valid for 1 hour after tiktok_create_post returns it.

After a successful upload, poll tiktok_get_post_status with the publish_id
from tiktok_create_post until status is terminal.

Args:
  - upload_url (string): the upload_url returned by tiktok_create_post
  - file_path (string): the same local file path used in tiktok_create_post

Returns:
  Structured: { uploaded: true, publish_id? } - note the publish_id from
  tiktok_create_post is the handle to poll.

Examples:
  - tiktok_upload_video(upload_url="https://open-upload.tiktokapis.com/...",
                        file_path="/videos/clip.mp4")

Error Handling:
  - Upload URL expired (HTTP 400/410) -> re-init with tiktok_create_post
  - Mismatched file size -> verify the file did not change since create_post`,
      inputSchema: z
        .object({
          upload_url: z.string().url().describe("upload_url from tiktok_create_post"),
          file_path: z.string().min(1).describe("Local video file path"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ upload_url, file_path }) => {
      let size: number;
      try {
        size = (await stat(file_path)).size;
      } catch {
        throw new TikTokApiError(
          "invalid_param",
          `Cannot read file at ${file_path}. Check the path and permissions.`
        );
      }
      const mime = VIDEO_MIME[extname(file_path).toLowerCase()] ?? "video/mp4";
      const stream = createReadStream(file_path);

      try {
        await axios.put(upload_url, stream, {
          timeout: 600_000, // large files take a while
          headers: {
            "Content-Type": mime,
            "Content-Length": String(size),
            "Content-Range": `bytes 0-${size - 1}/${size}`,
          },
          maxBodyLength: Infinity,
        });
      } catch (err) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if (status === 400 || status === 410) {
            throw new TikTokApiError(
              "upload_url_expired",
              `Upload failed with HTTP ${status}. The upload_url likely expired (1h validity). Re-init with tiktok_create_post to get a fresh upload_url.`
            );
          }
          throw new TikTokApiError(
            "upload_failed",
            `Upload failed with HTTP ${status ?? "unknown"}: ${err.message}.`
          );
        }
        throw err;
      }

      return {
        content: [
          {
            type: "text",
            text: `Upload of ${basename(file_path)} (${size} bytes) completed. Poll tiktok_get_post_status with the publish_id from tiktok_create_post to track processing.`,
          },
        ],
        structuredContent: { uploaded: true, bytes: size, file: basename(file_path) },
      };
    }
  );

  server.registerTool(
    "tiktok_get_post_status",
    {
      title: "Get TikTok post status",
      description: `Poll the processing/publish status of a post initialized via tiktok_create_post.

Use after init (and after tiktok_upload_video for FILE_UPLOAD sources).
Poll with exponential backoff (5s -> 10s -> 20s) up to a minute between
calls; never re-init a new post while a publish_id is still processing.

Terminal statuses: PUBLISH_COMPLETE, PUBLISH_FAILED, UPLOAD_FAILED.
Non-terminal: PROCESSING_UPLOAD, SEND_TO_USER_INBOX (draft saved), and
any status not listed as terminal.

Args:
  - publish_id (string): from tiktok_create_post

Returns:
  Structured: { status, fail_reason?, terminal: boolean }

Examples:
  - Poll after uploading until status is PUBLISH_COMPLETE or PUBLISH_FAILED

Error Handling:
  - access_token_invalid -> tokens refreshed automatically once; if it
    persists, re-run \`npm run auth\``,
      inputSchema: z
        .object({
          publish_id: z.string().min(1).describe("publish_id from tiktok_create_post"),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ publish_id }) => {
      const data = await client.request<{ status?: string; fail_reason?: string }>(
        "/post/publish/status/fetch/",
        "POST",
        { publish_id }
      );
      const status = data.status ?? "UNKNOWN";
      const terminal = [
        "PUBLISH_COMPLETE",
        "PUBLISH_FAILED",
        "UPLOAD_FAILED",
      ].includes(status);
      const text = [
        `**Status:** ${status}`,
        data.fail_reason ? `**Failure reason:** ${data.fail_reason}` : null,
        terminal
          ? status === "PUBLISH_COMPLETE"
            ? "The post is live."
            : "The post failed. Check fail_reason and re-init if needed."
          : "Still processing. Wait ~5-10s before polling again.",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: { status, fail_reason: data.fail_reason ?? null, terminal },
      };
    }
  );
}
