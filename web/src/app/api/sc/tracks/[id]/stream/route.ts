import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/session";
import { scReq } from "@/lib/soundcloud/client";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, unlink, readdir } from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "/tmp/downloads";

interface TrackMeta {
  id: number;
  title: string;
  user: { username: string };
  permalink_url: string;
}

/**
 * Downloads a track via yt-dlp and streams the audio to the browser.
 * Falls back to SoundCloud API preview if yt-dlp is unavailable.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getValidToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Fetch track metadata for filename
  const res = await scReq<TrackMeta>("GET", `/tracks/${id}`, token);
  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: `Failed to fetch track (${res.status})` },
      { status: res.status || 500 }
    );
  }

  const track = res.json;
  const safeFilename = `${track.user.username} - ${track.title}`.replace(
    /[<>:"/\\|?*]/g,
    "_"
  );

  // Try yt-dlp first
  const result = await downloadWithYtdlp(id, track.permalink_url);

  if (result) {
    const { filePath, mimeType, ext } = result;
    try {
      const fileBuffer = await readFile(filePath);

      // Clean up temp file in background
      unlink(filePath).catch(() => {});

      return new NextResponse(fileBuffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(fileBuffer.length),
          "Content-Disposition": `attachment; filename="${safeFilename}.${ext}"`,
        },
      });
    } catch (err) {
      console.error(`[stream] Failed to read downloaded file:`, err);
    }
  }

  // Fallback: try SoundCloud API preview
  console.log(`[stream] yt-dlp failed, trying API preview for track ${id}`);
  return await apiFallback(id, token, safeFilename);
}

async function downloadWithYtdlp(
  trackId: string,
  permalinkUrl: string
): Promise<{ filePath: string; mimeType: string; ext: string } | null> {
  const outTemplate = path.join(DOWNLOAD_DIR, `${trackId}.%(ext)s`);
  // Use the permalink URL which yt-dlp handles best
  const url = permalinkUrl || `https://api.soundcloud.com/tracks/${trackId}`;

  try {
    // Check if yt-dlp is available
    await execAsync("yt-dlp --version");
  } catch {
    console.log(`[stream] yt-dlp not available`);
    return null;
  }

  try {
    console.log(`[stream] Downloading track ${trackId} via yt-dlp`);
    const { stderr } = await execAsync(
      `yt-dlp --no-playlist --no-overwrites -x --audio-format mp3 -o "${outTemplate}" "${url}"`,
      { timeout: 60_000 }
    );

    if (stderr) {
      console.log(`[stream] yt-dlp stderr: ${stderr.substring(0, 300)}`);
    }

    // Find the downloaded file
    const files = await readdir(DOWNLOAD_DIR);
    const match = files.find((f) => f.startsWith(`${trackId}.`));

    if (!match) {
      console.error(`[stream] yt-dlp completed but no file found for ${trackId}`);
      return null;
    }

    const filePath = path.join(DOWNLOAD_DIR, match);
    const ext = path.extname(match).slice(1);
    const mimeType =
      ext === "mp3"
        ? "audio/mpeg"
        : ext === "m4a"
          ? "audio/mp4"
          : ext === "opus"
            ? "audio/opus"
            : ext === "ogg"
              ? "audio/ogg"
              : "audio/mpeg";

    console.log(`[stream] Downloaded: ${filePath} (${ext})`);
    return { filePath, mimeType, ext };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stream] yt-dlp error: ${msg.substring(0, 300)}`);
    return null;
  }
}

async function apiFallback(
  trackId: string,
  token: string,
  filename: string
): Promise<NextResponse> {
  interface TrackWithPreview {
    stream_url?: string;
    preview_mp3_128_url?: string;
  }

  const res = await scReq<TrackWithPreview>("GET", `/tracks/${trackId}`, token);
  const track = res.json;
  const audioUrl = track?.stream_url || track?.preview_mp3_128_url;

  if (!audioUrl) {
    return NextResponse.json(
      { error: "No stream available for this track" },
      { status: 404 }
    );
  }

  const audioRes = await fetch(audioUrl, {
    headers: { Authorization: `OAuth ${token}` },
  });

  if (!audioRes.ok) {
    // Try without auth
    const publicRes = await fetch(audioUrl);
    if (!publicRes.ok) {
      return NextResponse.json(
        { error: "Failed to download audio" },
        { status: 502 }
      );
    }
    return streamResponse(publicRes, filename);
  }

  return streamResponse(audioRes, filename);
}

function streamResponse(res: Response, filename: string) {
  const contentType = res.headers.get("content-type") || "audio/mpeg";
  const ext = contentType.includes("mpeg") || contentType.includes("mp3") ? "mp3" : "m4a";

  return new NextResponse(res.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}.${ext}"`,
      ...(res.headers.get("content-length")
        ? { "Content-Length": res.headers.get("content-length")! }
        : {}),
    },
  });
}
