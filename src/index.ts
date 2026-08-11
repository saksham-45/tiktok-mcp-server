#!/usr/bin/env node
/**
 * TikTok MCP Server
 *
 * Exposes the official TikTok Content Posting API (publish videos, save
 * drafts, poll status) and Display API (profile, video list/details) as MCP
 * tools, resources, and prompts for LLM control.
 *
 * Endpoints grounded in:
 *   https://developers.tiktok.com/doc/content-posting-api-get-started
 *   https://developers.tiktok.com/doc/display-api-get-started/
 *
 * Setup: set TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET, run `npm run auth` to
 * connect an account, then start with stdio (default) or streamable HTTP
 * (TRANSPORT=http).
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { z } from "zod";
import { loadAuthConfig } from "./auth.js";
import { TikTokClient, TikTokApiError } from "./client.js";
import { registerTools } from "./tools/index.js";
import { formatUser, formatVideoDetail, formatVideoShort, clampText } from "./format.js";
import type { TikTokUserInfo, TikTokVideoListData, TikTokVideoQueryData } from "./types.js";
import { USER_INFO_FIELDS, VIDEO_FIELDS } from "./constants.js";

const server = new McpServer({
  name: "tiktok-mcp-server",
  version: "1.0.0",
});

const cfg = loadAuthConfig();
const client = new TikTokClient(cfg);

registerTools(server, client);

// ---- Resources ------------------------------------------------------------

server.registerResource(
  "tiktok-user-profile",
  "tiktok://user",
  {
    description: "Profile info and stats for the authenticated TikTok account",
    mimeType: "text/markdown",
  },
  async () => {
    const data = await client.request<{ user: TikTokUserInfo }>(
      `/user/info/?fields=${encodeURIComponent([...USER_INFO_FIELDS].join(","))}`,
      "GET"
    );
    const user = data.user ?? {};
    return {
      contents: [{ uri: "tiktok://user", mimeType: "text/markdown", text: formatUser(user as Record<string, unknown>) }],
    };
  }
);

server.registerResource(
  "tiktok-recent-videos",
  "tiktok://videos",
  {
    description: "The 20 most recent videos on the authenticated account",
    mimeType: "text/markdown",
  },
  async () => {
    const data = await client.request<TikTokVideoListData>(
      `/video/list/?fields=${encodeURIComponent([...VIDEO_FIELDS].join(","))}`,
      "POST",
      { max_count: 20 }
    );
    const videos = data.videos ?? [];
    const text = videos.length
      ? videos.map((v) => formatVideoShort(v)).join("\n")
      : "No videos found for this account.";
    return {
      contents: [{ uri: "tiktok://videos", mimeType: "text/markdown", text: clampText(text) }],
    };
  }
);

server.registerResource(
  "tiktok-video-details",
  new ResourceTemplate("tiktok://video/{video_id}", { list: undefined }),
  {
    description: "Details and engagement stats for one video by ID",
    mimeType: "text/markdown",
  },
  async (uri: URL) => {
    const match = uri.href.match(/^tiktok:\/\/video\/([^/]+)$/);
    if (!match) throw new Error(`Invalid video resource URI: ${uri.href}`);
    const videoId = match[1];
    const data = await client.request<TikTokVideoQueryData>(
      `/video/query/?fields=${encodeURIComponent([...VIDEO_FIELDS].join(","))}`,
      "POST",
      { filters: { video_ids: [videoId] } }
    );
    const video = (data.videos ?? [])[0];
    if (!video) throw new Error(`No video found with ID ${videoId}`);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: formatVideoDetail(video as Record<string, unknown>),
        },
      ],
    };
  }
);

// ---- Prompts --------------------------------------------------------------

server.registerPrompt(
  "tiktok_post_from_brief",
  {
    description:
      "Turn a research brief or idea into a TikTok post: craft a caption with hashtags, pick a privacy level, and prepare a create_post call. Defaults to saving a draft for review.",
    argsSchema: {
      brief: z.string().min(1).describe("The research brief, idea, or content to post about"),
      style: z.string().optional().describe("Tone: casual, educational, hype, story, etc."),
    },
  },
  (args) => {
    const style = args.style ?? "casual, authentic";
    const text = `You are preparing a TikTok video post.

BRIEF:
${args.brief}

STYLE: ${style}

Steps:
1. Draft a caption (max 2200 chars) with 3-5 relevant #hashtags.
2. Call tiktok_get_creator_info to check allowed privacy levels.
3. Recommend post_mode=INBOX by default so the video is saved as a draft for
   review. Only suggest DIRECT_POST (with confirm=true) when the user
   explicitly asked to publish.
4. If a local video file is involved, use tiktok_create_post with file_path,
   then tiktok_upload_video, then poll tiktok_get_post_status.
5. Present the caption, hashtags, and planned privacy level to the user for
   approval before any publish action.

If this brief came from a last30days research run, pull the top engagement
patterns (hooks, formats, community language) into the caption naturally -
do not quote source posts verbatim.`;
    return {
      messages: [{ role: "user", content: { type: "text", text } }],
    };
  }
);

server.registerPrompt(
  "tiktok_content_review",
  {
    description:
      "Analyze recent TikTok video performance and summarize what is working, using Display API data",
    argsSchema: {
      window_videos: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("How many recent videos to review (1-20, default 20)"),
    },
  },
  (args) => {
    const n = args.window_videos ?? 20;
    const text = `Review the last ${n} videos from the authenticated TikTok account:

1. Call tiktok_list_videos (max_count=${n}) to get recent videos and engagement.
2. For the top few by view/like counts, call tiktok_get_video_details for
   full metadata (hashtags, AI label, duration).
3. Summarize: best-performing video (id + stats), worst-performing, common
   hashtags in winners vs losers, average like-to-view ratio, and 2-3
   concrete recommendations for the next post.

Use tiktok://user for account-level context. Report numbers exactly as
returned; do not invent engagement values.`;
    return {
      messages: [{ role: "user", content: { type: "text", text } }],
    };
  }
);

// ---- Transports -----------------------------------------------------------

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("tiktok-mcp-server running via stdio");
}

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    try {
      const { StreamableHTTPServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/streamableHttp.js"
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.error(`tiktok-mcp-server running via streamable HTTP on :${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT ?? "stdio";
if (transport === "http") {
  runHttp().catch((err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
} else {
  runStdio().catch((err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}
