// SoundCloud API response types

export interface SCTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  created_at: number; // epoch seconds
}

export interface SCUser {
  id: number;
  username: string;
  permalink_url: string;
  avatar_url: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  city?: string | null;
  country_code?: string | null;
  followers_count?: number;
  followings_count?: number;
  track_count?: number;
  playlist_count?: number;
  description?: string | null;
  created_at?: string;
}

export interface SCPlaylist {
  id: number;
  title: string;
  description: string | null;
  tag_list: string;
  genre: string;
  track_count: number;
  likes_count: number;
  sharing: string;
  created_at: string;
  last_modified: string;
  permalink_url: string;
  user: { username: string; id: number };
  tracks?: SCTrackRaw[];
}

export interface SCTrackRaw {
  id: number;
  urn?: string;
  title: string;
  user: { username: string; id: number };
  playback_count: number | null;
  likes_count: number | null;
  favoritings_count?: number | null;
  reposts_count: number | null;
  comment_count: number | null;
  comments_count?: number | null;
  created_at: string;
  access: string;
  permalink_url: string;
  genre: string;
  tag_list: string;
}

export interface SCSearchResponse {
  collection: SCPlaylist[];
  next_href: string | null;
}

export interface SCUserFull extends SCUser {
  city: string | null;
  country_code: string | null;
  followers_count: number;
  followings_count: number;
  track_count: number;
  description: string | null;
  created_at: string;
}

export interface SCUsersSearchResponse {
  collection: SCUserFull[];
  next_href: string | null;
}

export interface SCUserTracksResponse {
  collection: SCTrackRaw[];
  next_href: string | null;
}

export interface SCReqResult<T = unknown> {
  status: number;
  json: T | null;
  text: string;
}
