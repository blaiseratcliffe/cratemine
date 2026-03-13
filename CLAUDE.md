# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

CrateMine is a SoundCloud playlist merger. It searches for public playlists, merges their tracks, deduplicates, scores by popularity, and creates output playlists on the user's SoundCloud account.

Two implementations exist:
- **`soundcloud_merge.R`** — Original single-file R script (~2600 lines), local CLI tool with BPM detection and Claude AI classification
- **`web/`** — Next.js 15 (App Router) + TypeScript web app, multi-user, deployed to Vercel

## Web App (`web/`)

### Commands

```bash
cd web
npm install                  # install dependencies
npm run dev                  # dev server at localhost:3000
npm run build                # production build
npx tsc --noEmit             # type-check without building
```

### Environment Variables (`web/.env.local`)

```
SC_CLIENT_ID=...             # SoundCloud OAuth client ID
SC_CLIENT_SECRET=...         # SoundCloud OAuth client secret
SC_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=...           # 32+ char random string for iron-session
```

### Architecture

**Stack:** Next.js 15 + React 19 + TypeScript + Tailwind CSS + iron-session. No database — tokens stored in encrypted HTTP-only cookies.

**Client-orchestrated progressive fetching:** Vercel serverless functions have a 10s timeout. Instead of one long-running server call, each API route does one small SoundCloud API call. The React frontend drives the loop, calling routes repeatedly and accumulating results client-side. This gives natural progress feedback and avoids timeouts.

**Key directories:**

- `src/lib/soundcloud/` — Core SoundCloud logic (server-side)
  - `client.ts` — `scReq()` fetch wrapper with retry on 429 (6 attempts) and 5xx (4 attempts). Uses `Authorization: OAuth {token}` header (NOT Bearer).
  - `oauth.ts` — PKCE generation, token exchange, token refresh against `secure.soundcloud.com`
  - `scoring.ts` — Track scoring (`score = W_PLAY*plays + W_LIKE*likes + W_REPOST*reposts + W_COMMENT*comments`), dedup (key: URN or track_id, keep highest score), sorting, access filtering
  - `search.ts` — Playlist filtering by terms/counts/likes, ranking by likes_per_track/likes/recency
  - `scene.ts` — Scene discovery: city matching, social graph building, repost velocity scoring
  - `playlist-create.ts` — Playlist creation with 422 recovery via binary search to isolate invalid track IDs
- `src/hooks/` — Client-side hooks that drive progressive API calls
  - `useWizardState.ts` — Central `useReducer` for the wizard (supports both discovery modes)
  - `useSCSearch.ts` — Loops through query terms, deduplicates playlists
  - `useSCTrackFetch.ts` — Fetches tracks from selected playlists one-by-one
  - `useSCSceneMap.ts` — 3-phase scene discovery: seed users → graph expansion → track collection + velocity scoring
  - `useSCPlaylistCreate.ts` — Creates playlists in 500-track chunks with batched updates
- `src/app/api/` — Thin proxy routes to SoundCloud API (playlists, tracks, users, followings)
- `src/components/wizard/` — Wizard UI with two discovery modes

**Auth flow:** User clicks "Connect with SoundCloud" → `/api/auth/login` generates PKCE + redirects to SoundCloud → callback at `/auth/callback` exchanges code for tokens → tokens stored in encrypted session cookie → auto-refresh on expiry.

**Two discovery modes:**
- **Playlist Search** — search public playlists by keyword, select sources, fetch tracks, merge/dedup/score, create playlist. Steps: Search → Select → Preview → Create.
- **Scene Discovery** — enter a city name, find local artists via social graph crawling, score tracks by repost velocity (reposts-per-day * recency * local scene signal). Steps: Discover → Preview → Create. Algorithm: search users by city → filter by city match → crawl followings to find interconnected scene members (followed by 2+ seeds) → fetch their recent tracks → score by `momentum = velocity * (1 + localSignal) * exp(-ageDays/30)`.

**Scoring and dedup run client-side** (pure functions in `scoring.ts` and `scene.ts`). Only SoundCloud API calls go through server routes.

## R Script (`soundcloud_merge.R`)

### Running

```bash
Rscript soundcloud_merge.R
```

Requires env vars in `~/.Renviron`: `SC_CLIENT_ID`, `SC_CLIENT_SECRET`, `SC_REDIRECT_URI`, optionally `ANTHROPIC_API_KEY`.

### Architecture

Linear pipeline in numbered sections: CONFIG (113–296) → HTTP helper with retry (298–363) → OAuth PKCE (365–565) → Paging + union search (567–831) → Playlist selection (855–974) → Track extraction + scoring (975–1143) → BPM via librosa (1144–1601) → Claude AI classification (1603–2199) → Playlist creation with 422 recovery (2201–2269) → Main orchestrator (2271–2642).

Features not in web app: BPM detection (librosa/yt-dlp), Claude AI genre classification, title cleaning, fuzzy dedup, source scoring. These are planned for later.
