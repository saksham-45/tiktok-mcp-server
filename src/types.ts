/**
 * Type definitions for the TikTok Open API v2 responses we consume.
 * Field shapes mirror the official docs; unknown fields are tolerated.
 */

/** Shape of the `error` object every TikTok API response carries. */
export interface TikTokError {
  code: string;
  message: string;
  log_id: string;
}

/** Envelope: { data?, error } returned by every TikTok v2 endpoint. */
export interface TikTokEnvelope<T> {
  data?: T;
  error: TikTokError;
}

/** GET /v2/user/info/ */
export interface TikTokUserInfo {
  open_id?: string;
  union_id?: string;
  avatar_url?: string;
  display_name?: string;
  bio_description?: string;
  is_verified?: boolean;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
}

/** Item in POST /v2/video/list/ and /v2/video/query/ responses. */
export interface TikTokVideo {
  id?: string;
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  share_url?: string;
  embed_link?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
  create_time?: string;
  is_aigc?: boolean;
  music_id?: string;
  hashtag_list?: { id?: string; name?: string }[];
  mention_list?: { id?: string; name?: string }[];
  video_metadata?: {
    video_ratio?: string;
    duration?: number;
    cover_image_url?: string;
    video_url?: string;
  };
}

/** POST /v2/video/list/ response data. */
export interface TikTokVideoListData {
  videos: TikTokVideo[];
  cursor: number;
  has_more: boolean;
}

/** POST /v2/video/query/ response data. */
export interface TikTokVideoQueryData {
  videos: TikTokVideo[];
  cursor: number;
  has_more: boolean;
}

/** POST /v2/post/publish/creator_info/query/ response data. */
export interface TikTokCreatorInfo {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

/** POST /v2/post/publish/video/init/ response data. */
export interface TikTokVideoInitData {
  publish_id: string;
  upload_url?: string;
}

/** POST /v2/post/publish/status/fetch/ response data. */
export interface TikTokPublishStatus {
  status?: string;
  fail_reason?: string;
  /** Present for video uploads; details per status. */
  upload_url?: string;
  error_code?: string;
  error_message?: string;
}

/** Persisted OAuth token pair. */
export interface TikTokTokens {
  access_token: string;
  refresh_token: string;
  /** Unix epoch seconds when the access token expires. */
  expires_at: number;
  /** Unix epoch seconds when the refresh token expires. */
  refresh_expires_at: number;
  open_id: string;
  scope: string;
}
