import { scReq } from "./client";

/**
 * Create a playlist on SoundCloud, optionally with tracks.
 */
export async function createPlaylist(
  title: string,
  description: string,
  sharing: "public" | "private",
  accessToken: string,
  trackIds?: number[]
): Promise<{ id: number; title: string; permalink_url: string }> {
  const playlistBody: Record<string, unknown> = { title, description, sharing };

  if (trackIds && trackIds.length > 0) {
    const cleanIds = trackIds.map((id) => Math.floor(Number(id))).filter((id) => id > 0);
    playlistBody.tracks = cleanIds.map((id) => ({ urn: `soundcloud:tracks:${id}` }));
    console.log(`[PlaylistCreate] POST /playlists with ${cleanIds.length} tracks`);
  }

  const res = await scReq<{ id: number; title: string; permalink_url: string }>(
    "POST",
    "/playlists",
    accessToken,
    {
      body: { playlist: playlistBody },
    }
  );

  if (res.status >= 300 || !res.json) {
    throw new Error(
      `Failed to create playlist "${title}" (${res.status}): ${res.text}`
    );
  }

  return res.json;
}

/**
 * Set the tracks on a playlist via PUT using scReq (fetch).
 * No manual Content-Length — let fetch handle it.
 */
async function putPlaylistTracks(
  playlistId: number,
  trackIds: number[],
  accessToken: string
): Promise<{ status: number; text: string }> {
  const cleanIds = trackIds.map((id) => Math.floor(Number(id))).filter((id) => id > 0);

  const payload = {
    playlist: {
      tracks: cleanIds.map((id) => ({ urn: `soundcloud:tracks:${id}` })),
    },
  };

  const res = await scReq(
    "PUT",
    `/playlists/${playlistId}`,
    accessToken,
    { body: payload }
  );

  console.log(`[PlaylistCreate] PUT → ${res.status}`);
  if (res.status >= 400) {
    console.log(`[PlaylistCreate] Response: ${res.text.slice(0, 500)}`);
  }

  return { status: res.status, text: res.text };
}

/**
 * Binary search to isolate invalid track IDs from a subset.
 * Returns the list of invalid IDs found.
 */
async function findInvalidInSubset(
  playlistId: number,
  knownGood: number[],
  subset: number[],
  accessToken: string,
  depth: number = 0
): Promise<number[]> {
  if (subset.length === 0) return [];

  const res = await putPlaylistTracks(
    playlistId,
    [...knownGood, ...subset],
    accessToken
  );

  if (res.status < 400) return [];

  if (res.status !== 422) {
    console.error(
      `[PlaylistCreate] Binary search got ${res.status} at depth ${depth} ` +
      `(${subset.length} tracks). Aborting search.`
    );
    throw new Error(
      `Unexpected error during track validation (${res.status}): ${res.text.slice(0, 200)}`
    );
  }

  if (subset.length === 1) {
    console.log(`[PlaylistCreate] Invalid track ID: ${subset[0]}`);
    return subset;
  }

  const mid = Math.floor(subset.length / 2);
  const left = subset.slice(0, mid);
  const right = subset.slice(mid);

  const badLeft = await findInvalidInSubset(
    playlistId, knownGood, left, accessToken, depth + 1
  );

  const validLeft = left.filter((id) => !badLeft.includes(id));
  const badRight = await findInvalidInSubset(
    playlistId, [...knownGood, ...validLeft], right, accessToken, depth + 1
  );

  return [...badLeft, ...badRight];
}

/**
 * Add tracks to a playlist, recovering from 422 errors by isolating
 * invalid track IDs via binary search.
 */
export async function addTracksSafe(
  playlistId: number,
  knownGood: number[],
  newIds: number[],
  accessToken: string
): Promise<{ addedIds: number[]; failedIds: number[] }> {
  if (newIds.length === 0) return { addedIds: [], failedIds: [] };

  console.log(
    `[PlaylistCreate] addTracksSafe: playlist=${playlistId}, ` +
    `knownGood=${knownGood.length}, new=${newIds.length}`
  );

  const res = await putPlaylistTracks(
    playlistId,
    [...knownGood, ...newIds],
    accessToken
  );

  if (res.status < 400) {
    return { addedIds: newIds, failedIds: [] };
  }

  if (res.status !== 422) {
    throw new Error(
      `Failed to add tracks to playlist ${playlistId} (${res.status}): ${res.text.slice(0, 300)}`
    );
  }

  console.log(`[PlaylistCreate] Got 422, starting binary search on ${newIds.length} tracks`);
  const badIds = await findInvalidInSubset(playlistId, knownGood, newIds, accessToken);

  const goodIds = newIds.filter((id) => !badIds.includes(id));
  console.log(
    `[PlaylistCreate] Binary search result: ${goodIds.length} good, ${badIds.length} bad`
  );

  if (goodIds.length > 0) {
    const finalRes = await putPlaylistTracks(
      playlistId,
      [...knownGood, ...goodIds],
      accessToken
    );
    if (finalRes.status >= 400) {
      throw new Error(
        `Final PUT failed after 422 recovery (${finalRes.status}): ${finalRes.text.slice(0, 300)}`
      );
    }
  }

  return { addedIds: goodIds, failedIds: badIds };
}
