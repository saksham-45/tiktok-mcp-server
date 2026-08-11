/**
 * Markdown formatting helpers shared by tools and resources.
 * Keeps large responses bounded (CHARACTER_LIMIT) so agent context stays lean.
 */

import { CHARACTER_LIMIT } from "./constants.js";

/** Truncate a string to CHARACTER_LIMIT with a pointer to pagination. */
export function clampText(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    "\n\n... truncated. Use pagination (cursor) or narrower filters to see more."
  );
}

/** Compact formatting of a video item for list output. */
export function formatVideoShort(v: {
  id?: string;
  title?: string;
  video_description?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
  create_time?: string;
  duration?: number;
}): string {
  const title = v.title ?? v.video_description ?? "(untitled)";
  const stats = [
    v.view_count !== undefined ? `${v.view_count} views` : null,
    v.like_count !== undefined ? `${v.like_count} likes` : null,
    v.comment_count !== undefined ? `${v.comment_count} comments` : null,
    v.share_count !== undefined ? `${v.share_count} shares` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const when = v.create_time ? ` · ${v.create_time}` : "";
  return `- **${title}** (id: ${v.id ?? "unknown"}${v.duration ? `, ${v.duration}s` : ""})${when}\n  ${stats || "no stats returned"}`;
}

/** Compact formatting of a video item for detail output. */
export function formatVideoDetail(v: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# ${String(v.title ?? v.video_description ?? "(untitled)")}`);
  if (v.id) lines.push(`**Video ID:** ${v.id}`);
  if (v.video_description) lines.push(`**Description:** ${v.video_description}`);
  const statFields = [
    ["Views", v.view_count],
    ["Likes", v.like_count],
    ["Comments", v.comment_count],
    ["Shares", v.share_count],
  ] as const;
  const stats = statFields
    .filter(([, val]) => val !== undefined && val !== null)
    .map(([label, val]) => `- ${label}: ${val}`)
    .join("\n");
  if (stats) lines.push("**Engagement:**\n" + stats);
  if (v.create_time) lines.push(`**Created:** ${v.create_time}`);
  if (v.duration !== undefined) lines.push(`**Duration:** ${v.duration}s`);
  if (v.is_aigc !== undefined) lines.push(`**AI-generated:** ${v.is_aigc}`);
  if (Array.isArray(v.hashtag_list) && v.hashtag_list.length) {
    const tags = (v.hashtag_list as { name?: string }[])
      .map((h) => h.name)
      .filter(Boolean)
      .join(", ");
    if (tags) lines.push(`**Hashtags:** ${tags}`);
  }
  if (v.embed_link) lines.push(`**Embed:** ${v.embed_link}`);
  return lines.join("\n");
}

/** Compact formatting of user info. */
export function formatUser(u: Record<string, unknown>): string {
  const lines = [`# ${String(u.display_name ?? "(no display name)")}`];
  if (u.open_id) lines.push(`**Open ID:** ${u.open_id}`);
  if (u.bio_description) lines.push(`**Bio:** ${u.bio_description}`);
  const stats = [
    ["Followers", u.follower_count],
    ["Following", u.following_count],
    ["Likes", u.likes_count],
    ["Videos", u.video_count],
  ] as const;
  const present = stats.filter(([, val]) => val !== undefined && val !== null);
  if (present.length) {
    lines.push(
      "**Stats:** " +
        present.map(([label, val]) => `${label}: ${val}`).join(" · ")
    );
  }
  if (u.is_verified !== undefined) lines.push(`**Verified:** ${u.is_verified}`);
  if (u.avatar_url) lines.push(`**Avatar:** ${u.avatar_url}`);
  return lines.join("\n");
}
