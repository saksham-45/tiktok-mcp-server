# TikTok MCP Server

MCP server for the **official TikTok APIs** — publish videos, save drafts, poll
publish status, and read your profile and video data, all controlled by an LLM.

This is the self-hosted "creator cockpit": the piece no existing TikTok MCP
server covers with official APIs — drafts workflow (`INBOX` mode), the full
publish pipeline (init → upload → status poll), and Display API reads.
No scraping, no unofficial endpoints.

## What it exposes

### Tools (7)

| Tool | API | Purpose |
|---|---|---|
| `tiktok_get_user_info` | Display `/user/info/` | Profile + stats of the authenticated account |
| `tiktok_list_videos` | Display `/video/list/` | Recent videos, paginated, with engagement counts |
| `tiktok_get_video_details` | Display `/video/query/` | Detailed metadata for up to 10 video IDs |
| `tiktok_get_creator_info` | Posting `/post/publish/creator_info/query/` | Allowed privacy levels, comment/duet/stitch flags, max duration |
| `tiktok_create_post` | Posting `/post/publish/video/init/` | Init a post: `INBOX` (draft, default) or `DIRECT_POST` (requires `confirm=true`); `FILE_UPLOAD` or `PULL_FROM_URL` |
| `tiktok_upload_video` | Posting PUT `upload_url` | Transfer a local video file (Content-Range) |
| `tiktok_get_post_status` | Posting `/post/publish/status/fetch/` | Poll `publish_id` to terminal state |

### Resources

- `tiktok://user` — account profile
- `tiktok://videos` — 20 most recent videos
- `tiktok://video/{video_id}` — one video's details

### Prompts

- `tiktok_post_from_brief` — turn a research brief (e.g. a `/last30days` run)
  into a caption + hashtags + draft workflow
- `tiktok_content_review` — analyze recent video performance and recommend
  next moves

## Setup

1. Create an app at https://developers.tiktok.com with **Login Kit** and
   **Content Posting API** products. Approve the `video.publish` scope.
   TikTok requires an [app audit](https://developers.tiktok.com/application/content-posting-api)
   before posts can be public — unaudited apps can only post `SELF_ONLY`.

2. Install and configure:

```bash
npm install
export TIKTOK_CLIENT_KEY=...        # Client Key
export TIKTOK_CLIENT_SECRET=...     # Client Secret
export TIKTOK_REDIRECT_URI=http://localhost:8787/callback
```

3. Connect your TikTok account:

```bash
npm run auth
```

This opens a browser, runs the PKCE flow, and saves tokens to
`tiktok-tokens.json` (override with `TIKTOK_TOKEN_FILE`). Access tokens last
24h and are auto-refreshed by the server; the refresh token lasts 365 days.

4. Run:

```bash
npm run build && npm start          # stdio (default)
TRANSPORT=http PORT=3000 npm start  # streamable HTTP on :3000/mcp
```

### Claude Code / Claude Desktop

```json
{
  "mcpServers": {
    "tiktok": {
      "command": "node",
      "args": ["/path/to/tiktok-mcp-server/dist/index.js"],
      "env": {
        "TIKTOK_CLIENT_KEY": "...",
        "TIKTOK_CLIENT_SECRET": "...",
        "TIKTOK_REDIRECT_URI": "http://localhost:8787/callback"
      }
    }
  }
}
```

## LLM workflow (typical)

1. `tiktok_get_creator_info` — check privacy options before posting
2. `tiktok_create_post(file_path="/videos/clip.mp4", title="...#fyp")` —
   defaults to **draft** (`INBOX`)
3. `tiktok_upload_video(upload_url, file_path)` — transfer bytes
4. `tiktok_get_post_status(publish_id)` — poll until `PUBLISH_COMPLETE`
5. To publish directly: `tiktok_create_post(..., post_mode="DIRECT_POST", confirm=true)`

## Known API limitations (verified against official docs)

- **No comment moderation API** — TikTok exposes no endpoints to read, reply
  to, or delete comments. Only `disable_comment` at post creation exists.
- **No delete-post API** in the public Content Posting API v2 reference.
- **No analytics API** for the public Display API surface (insights require
  partner access).
- **No public content search** — the Research API is restricted to approved
  academic researchers. `tiktok_list_videos` reads only your own videos.

## Safety design

- `tiktok_create_post` defaults to saving a draft; `DIRECT_POST` requires
  `confirm: true`, which MCP clients surface as a confirmation UI
- All reads are annotated `readOnlyHint`; publish ops are `openWorldHint`
- Rate limits surfaced with backoff guidance (6 req/min posting,
  20 req/min Display)

## License

MIT
