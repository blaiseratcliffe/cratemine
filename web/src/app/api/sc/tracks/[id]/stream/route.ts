import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink, readdir, stat } from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

// Max file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

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
  const token = await getValidSCToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Validate track ID is numeric
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
  }

  // Fetch track metadata for filename
  const res = await scReq<TrackMeta>("GET", `/tracks/${id}`, token);
  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: "Failed to fetch track" },
      { status: res.status || 500 }
    );
  }

  const track = res.json;
  const safeFilename = sanitizeFilename(
    `${track.user.username} - ${track.title}`
  );

  // Clean up stale temp files older than 5 minutes (fire and forget)
  cleanupStaleFiles().catch(() => {});

  // Try yt-dlp first
  const result = await downloadWithYtdlp(id, track.permalink_url);

  if (result) {
    const { filePath, mimeType, ext } = result;
    try {
      // Check file size before reading into memory
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_SIZE) {
        unlink(filePath).catch(() => {});
        return NextResponse.json(
          { error: "File too large to download" },
          { status: 413 }
        );
      }

      const fileBuffer = await readFile(filePath);

      // Clean up temp file in background
      unlink(filePath).catch(() => {});

      return new NextResponse(fileBuffer, {
        headers: buildDownloadHeaders(safeFilename, ext, mimeType, fileBuffer.length),
      });
    } catch (err) {
      // Clean up on failure
      unlink(filePath).catch(() => {});
      console.error(`[stream] Failed to read downloaded file:`, err);
    }
  }

  // Fallback: try SoundCloud API preview
  console.log(`[stream] yt-dlp failed, trying API preview for track ${id}`);
  return await apiFallback(id, token, safeFilename);
}

/** Sanitize filename: strip dangerous chars, newlines, null bytes, limit length */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\r\n\0]/g, "_")
    .replace(/\.\./g, "_")
    .slice(0, 200);
}

/** Build RFC 6266 compliant download headers */
function buildDownloadHeaders(
  filename: string,
  ext: string,
  mimeType: string,
  contentLength?: number
): Record<string, string> {
  const full = `${filename}.${ext}`;
  // ASCII fallback: replace non-ASCII with underscore, keep spaces
  const ascii = full.replace(/[^\x20-\x7E]/g, "_");
  // UTF-8 encoded version for filename*
  const encoded = encodeURIComponent(full);
  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  };
  if (contentLength) {
    headers["Content-Length"] = String(contentLength);
  }
  return headers;
}

/** Validate that a permalink URL is a SoundCloud URL */
function isSoundCloudUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "soundcloud.com" ||
      parsed.hostname.endsWith(".soundcloud.com")
    );
  } catch {
    return false;
  }
}

async function downloadWithYtdlp(
  trackId: string,
  permalinkUrl: string
): Promise<{ filePath: string; mimeType: string; ext: string } | null> {
  // Validate and resolve the download directory
  const resolvedDir = path.resolve(DOWNLOAD_DIR);
  const outTemplate = path.join(resolvedDir, `${trackId}.%(ext)s`);

  // Only use permalink if it's a valid SoundCloud URL
  const url =
    permalinkUrl && isSoundCloudUrl(permalinkUrl)
      ? permalinkUrl
      : `https://soundcloud.com/tracks/${trackId}`;

  try {
    // Check if yt-dlp is available (safe: no user input)
    await execFileAsync("yt-dlp", ["--version"]);
  } catch {
    console.log(`[stream] yt-dlp not available`);
    return null;
  }

  try {
    console.log(`[stream] Downloading track ${trackId} via yt-dlp`);

    // Use execFile with argument array — prevents shell injection
    const { stderr } = await execFileAsync(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-overwrites",
        "-x",
        "--audio-format",
        "mp3",
        "-o",
        outTemplate,
        url,
      ],
      { timeout: 60_000 }
    );

    if (stderr) {
      console.log(`[stream] yt-dlp stderr: ${stderr.substring(0, 300)}`);
    }

    // Find the downloaded file
    const files = await readdir(resolvedDir);
    const match = files.find((f) => f.startsWith(`${trackId}.`));

    if (!match) {
      console.error(
        `[stream] yt-dlp completed but no file found for ${trackId}`
      );
      return null;
    }

    // Verify the file is inside the download directory (prevent traversal)
    const filePath = path.resolve(resolvedDir, match);
    if (!filePath.startsWith(resolvedDir)) {
      console.error(`[stream] Path traversal detected: ${filePath}`);
      return null;
    }

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

  const res = await scReq<TrackWithPreview>(
    "GET",
    `/tracks/${trackId}`,
    token
  );
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
  const ext =
    contentType.includes("mpeg") || contentType.includes("mp3")
      ? "mp3"
      : "m4a";

  return new NextResponse(res.body, {
    headers: buildDownloadHeaders(
      filename,
      ext,
      contentType,
      res.headers.get("content-length")
        ? parseInt(res.headers.get("content-length")!)
        : undefined
    ),
  });
}

/** Remove temp files older than 5 minutes */
async function cleanupStaleFiles() {
  const maxAge = 5 * 60 * 1000;
  const now = Date.now();
  const resolvedDir = path.resolve(DOWNLOAD_DIR);

  try {
    const files = await readdir(resolvedDir);
    for (const file of files) {
      const filePath = path.join(resolvedDir, file);
      try {
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs > maxAge) {
          await unlink(filePath);
        }
      } catch {
        // File may have been deleted by another request
      }
    }
  } catch {
    // Download dir may not exist yet
  }
}
