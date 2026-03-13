import { SC_API_BASE } from "@/lib/config";
import type { SCReqResult } from "./types";

/**
 * SoundCloud API request helper — direct port of R sc_req().
 * Retries on 429 (up to 6 attempts) and 5xx (up to 4 attempts).
 * Never throws on non-2xx; returns { status, json, text }.
 */
export async function scReq<T = unknown>(
  method: string,
  pathOrUrl: string,
  accessToken: string,
  options: {
    query?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<SCReqResult<T>> {
  const { query, body, timeoutMs = 60_000 } = options;

  let url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${SC_API_BASE}${pathOrUrl}`;

  if (query) {
    const params = new URLSearchParams(query);
    url += (url.includes("?") ? "&" : "?") + params.toString();
  }

  const headers: Record<string, string> = {
    Authorization: `OAuth ${accessToken}`,
    Accept: "application/json; charset=utf-8",
  };

  const fetchOptions: RequestInit = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(body);
  }

  let attempts = 0;

  while (true) {
    attempts++;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    fetchOptions.signal = controller.signal;

    let resp: Response;
    try {
      resp = await fetch(url, fetchOptions);
    } catch (err) {
      clearTimeout(timeout);
      if (attempts < 3) {
        await sleep(2 ** attempts * 1000);
        continue;
      }
      return {
        status: 0,
        json: null,
        text: err instanceof Error ? err.message : "Network error",
      };
    }
    clearTimeout(timeout);

    const status = resp.status;

    // Retry on 429 (rate limited)
    if (status === 429 && attempts < 6) {
      const retryAfter = resp.headers.get("retry-after");
      const wait = retryAfter ? parseFloat(retryAfter) : 2 ** attempts;
      await sleep((isNaN(wait) ? 2 ** attempts : wait) * 1000);
      continue;
    }

    // Retry on 5xx (server error)
    if (status >= 500 && attempts < 4) {
      await sleep(2 ** attempts * 1000);
      continue;
    }

    const text = await resp.text();
    let json: T | null = null;
    if (text) {
      try {
        json = JSON.parse(text) as T;
      } catch {
        // not valid JSON
      }
    }

    return { status, json, text };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
