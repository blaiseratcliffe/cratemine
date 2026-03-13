# ============================================================
# SoundCloud Mega Playlist Builder (R)
# ------------------------------------------------------------
# Pipeline:
#   1) Select source playlists by:
#        - Explicit IDs
#        - Explicit Titles (supports emojis)
#        - Auto from *your* playlists by keywords (mine_keywords)
#        - Auto-search public SoundCloud playlists (public_search; union queries)
#
#   2) Preview selected playlists BEFORE processing
#   2b) [Optional] Claude AI: score playlist sources by DNB relevance
#
#   3) Merge tracks from all source playlists
#   4) Dedup (URN preferred, else track_id) keeping best by SCORE/tie-breakers
#   5) Sort by weighted score:
#        score = W_PLAY*plays + W_LIKE*likes + W_REPOST*reposts + W_COMMENT*comments
#        tie-breakers: score, plays, likes, reposts, comments, created_at (newer first)
#
#   6) [Optional] Claude AI: genre + subgenre classification
#        - Sends track artist + title in batches of 20 to Claude Haiku
#        - Returns: is_dnb, confidence, subgenre (liquid/neurofunk/rollers/etc.)
#        - Persistent cache in TRACKS_DIR/claude_cache.csv
#   6b) [Optional] Claude AI: genre filter — remove non-DNB tracks
#   6c) [Optional] Claude AI: title cleaning — strip [FREE DL] etc.
#   6d) [Optional] Claude AI: fuzzy dedup — same song from different uploaders
#
#   7) BPM tagging via librosa (Python) — runs on surviving tracks
#        - Download full track via yt-dlp, run librosa.feature.tempo()
#        - Persistent cache in TRACKS_DIR/bpm_cache.csv
#
#   8) BPM filter — remove tracks outside BPM_FILTER_MIN–BPM_FILTER_MAX
#   9) Cap retained tracks via MAX_TRACKS_TO_RETAIN
#
#  10) Create output playlists in chunks of 500 VALID tracks each
#        - Robust to HTTP 422: isolates + skips invalid tracks, fills forward
#
#  11) Final summary + manifest CSV
#
# Dependencies:
#   R packages: httr2, jsonlite, openssl, base64enc, httpuv
#   Python (for BPM): librosa, soundfile (via LIBROSA_PYTHON path)
#   CLI tools: yt-dlp (for full track downloads)
#   API keys: ANTHROPIC_API_KEY in ~/.Renviron (for Claude features)
#
# Auth:
#   OAuth 2.1 Authorization Code + PKCE with localhost auto-callback capture
#   Token endpoint: https://secure.soundcloud.com/oauth/token
#   API base: https://api.soundcloud.com
#
# Requires env vars in ~/.Renviron (restart R after setting):
#   SC_CLIENT_ID=...
#   SC_CLIENT_SECRET=...
#   SC_REDIRECT_URI=http://localhost:1410/callback
#   ANTHROPIC_API_KEY=...  (optional, for Claude AI features)
# ============================================================

# ---- packages ----
pkgs <- c("httr2", "jsonlite", "openssl", "base64enc", "httpuv")
to_install <- pkgs[!vapply(pkgs, requireNamespace, logical(1), quietly = TRUE)]
if (length(to_install)) install.packages(to_install, dependencies = TRUE)

library(httr2)
library(jsonlite)

options(stringsAsFactors = FALSE)

`%||%` <- function(a, b) if (!is.null(a)) a else b
safe_lower <- function(x) tolower(as.character(x %||% ""))

# ---- FIX: SoundCloud returns {} (empty list) for missing fields, not NULL ----
# sc_value() returns NULL for NULL, empty list, NA, or empty string
sc_value <- function(x) {
  if (is.null(x)) return(NULL)
  if (is.list(x) && length(x) == 0) return(NULL)   # {} from JSON
  if (length(x) == 1 && is.na(x)) return(NULL)
  if (is.character(x) && length(x) == 1 && !nzchar(x)) return(NULL)
  x
}

# Numeric-safe: returns NA_real_ instead of NULL for easier assignment
sc_numeric <- function(x) {
  v <- sc_value(x)
  if (is.null(v)) return(NA_real_)
  suppressWarnings(as.numeric(v))
}

# Character-safe: returns NA_character_ instead of NULL
sc_character <- function(x) {
  v <- sc_value(x)
  if (is.null(v)) return(NA_character_)
  as.character(v)
}

# ---- playlist text helpers (defined EARLY so union search can use them) ----
playlist_text_blob <- function(pl, search_description = TRUE) {
  tolower(paste(
    pl$title %||% "",
    if (isTRUE(search_description)) (pl$description %||% "") else "",
    pl$tag_list %||% "",
    pl$genre %||% "",
    sep = " "
  ))
}

playlist_matches_any_terms <- function(pl, terms, search_description = TRUE, require_all = FALSE) {
  if (!length(terms)) return(TRUE)
  txt <- playlist_text_blob(pl, search_description = search_description)
  hits <- vapply(terms, function(t) grepl(tolower(t), txt, fixed = TRUE), logical(1))
  if (isTRUE(require_all)) all(hits) else any(hits)
}

# ============================================================
# 0) CONFIG
# ============================================================

# ---- Credentials from env vars ----
SC_CLIENT_ID     <- Sys.getenv("SC_CLIENT_ID", unset = "")
SC_CLIENT_SECRET <- Sys.getenv("SC_CLIENT_SECRET", unset = "")
SC_REDIRECT_URI  <- Sys.getenv("SC_REDIRECT_URI", unset = "http://localhost:1410/callback")

if (!nzchar(SC_CLIENT_ID))     stop("Missing env var SC_CLIENT_ID", call. = FALSE)
if (!nzchar(SC_CLIENT_SECRET)) stop("Missing env var SC_CLIENT_SECRET", call. = FALSE)
if (!nzchar(SC_REDIRECT_URI))  stop("Missing env var SC_REDIRECT_URI", call. = FALSE)

if (SC_CLIENT_ID %in% c("YOUR_REAL_CLIENT_ID", "PASTE_YOUR_CLIENT_ID_HERE")) {
  stop("SC_CLIENT_ID is still a placeholder. Fix ~/.Renviron and restart R.", call. = FALSE)
}

# ---- Reports & token cache (define EARLY so others can use REPORT_DIR) ----
TOKEN_FILE <- file.path(path.expand("~"), ".soundcloud_token.json")
REPORT_DIR <- file.path(getwd(), "soundcloud_merge_reports")
dir.create(REPORT_DIR, showWarnings = FALSE, recursive = TRUE)

# ---- Preview mode ----
PREVIEW_SOURCES_ONLY <- FALSE   # TRUE: list playlists + write preview CSV, then stop
PREVIEW_PRINT_MAX    <- 200     # print up to N playlists in console

# ---- Source selection ----
SOURCE_PLAYLIST_IDS <- c()      # e.g. c(12345, 67890)
SOURCE_PLAYLIST_TITLES <- c()   # exact titles; emojis ok

SOURCE_MODE <- "public_search"  # "mine_keywords" or "public_search"

# For mine_keywords: filter /me/playlists by keywords in title/description
PLAYLIST_KEYWORDS      <- character(0) # c("dnb","bootleg")
REQUIRE_ALL_KEYWORDS   <- TRUE
SEARCH_DESCRIPTION     <- TRUE
MAX_SOURCE_PLAYLISTS   <- 10         # safety cap

# Public search: either single query OR union of multiple queries
PUBLIC_SEARCH_Q <- "dnb bootlegs"   # optional fallback
PUBLIC_SEARCH_QUERIES <- c(
  "dnb",
  "dnb bootleg",
  "dnb bootlegs",
  "drum and bass",
  "drum and bass bootleg",
  "bootleg dnb",
  "d&b bootleg"
)
PUBLIC_SEARCH_USE_UNION <- TRUE

# ---- SECOND-PASS FILTER AFTER UNION ----
PUBLIC_REQUIRE_TERMS <- c("remix", "remixes", "bootleg", "bootlegs")
PUBLIC_REQUIRE_ALL_TERMS <- FALSE
PUBLIC_REQUIRE_TERMS_SEARCH_DESCRIPTION <- TRUE

# ---- Output playlists ----
OUT_BASE_TITLE   <- "test2"
OUT_DESCRIPTION  <- paste0(
  "Auto-generated on ", Sys.Date(),
  ". Merged from multiple playlists, deduped, sorted by score (plays/likes/reposts/comments)."
)
OUT_SHARING      <- "public"   # "private" or "public"
MAX_PER_PLAYLIST <- 500
DRY_RUN          <- TRUE

# ---- Retain only top N tracks after dedup/clean/sort ----
# Set to NA (default) to keep all tracks.
MAX_TRACKS_TO_RETAIN <- 500

# ---- BPM tagging options ----
COMPUTE_BPM <- FALSE              # set FALSE to skip BPM logic entirely
BPM_SLEEP_SEC <- 0.08            # polite delay between bpm operations

# BPM detection via librosa (Python)
LIBROSA_PYTHON <- "D:/miniconda3/envs/madmom/python.exe"

# Expected BPM range — used for librosa's start_bpm bias.
# Librosa searches near the midpoint of this range. True DNB tracks will
# snap cleanly to ~160-180. Tracks that return values far outside this
# range despite the bias are likely non-DNB contamination.
# Set both to NA for fully unbiased detection.
BPM_RANGE_MIN <- 155
BPM_RANGE_MAX <- 195

# Filter tracks by BPM after detection. Removes non-genre tracks from output.
# Set both to NA to disable filtering (keep all tracks regardless of BPM).
BPM_FILTER_MIN <- 155
BPM_FILTER_MAX <- 195
BPM_KEEP_NA    <- TRUE   # keep tracks where BPM detection failed?

# ---- Claude API classification ----
# Requires ANTHROPIC_API_KEY in ~/.Renviron (restart R after setting).
CLAUDE_API_KEY    <- Sys.getenv("ANTHROPIC_API_KEY")
CLAUDE_MODEL      <- "claude-haiku-4-5-20251001"
CLAUDE_BATCH_SIZE <- 20   # tracks per API call

# Toggle each task (all require a valid CLAUDE_API_KEY)
CLAUDE_GENRE_CLASSIFY <- TRUE    # genre + subgenre classification
CLAUDE_CLEAN_TITLES   <- TRUE    # strip [FREE DOWNLOAD] etc from titles
CLAUDE_FUZZY_DEDUP    <- TRUE    # detect same song from different uploaders
CLAUDE_SCORE_SOURCES  <- TRUE    # score playlist sources before fetching

# Genre filter (requires CLAUDE_GENRE_CLASSIFY = TRUE)
# Removes tracks Claude classifies as non-DNB.
# Set GENRE_FILTER_ENABLED = FALSE to keep all tracks regardless of genre.
GENRE_FILTER_ENABLED        <- TRUE
GENRE_FILTER_MIN_CONFIDENCE <- 0.7   # below this, treat as uncertain
GENRE_KEEP_UNCLASSIFIED     <- TRUE  # keep tracks where API call failed?

# ---- Download method ----
# "yt-dlp" = full track via yt-dlp (best BPM accuracy, larger files)
# "api"    = ~30s preview via SoundCloud API (fast, less accurate BPM)
DOWNLOAD_METHOD <- "yt-dlp"
YTDLP_BIN      <- "yt-dlp"

# ---- Save downloaded tracks ----
SAVE_TRACKS     <- FALSE
TRACKS_DIR      <- file.path("D:/soundcloud_tracks")
# Always create TRACKS_DIR — used for BPM cache even when SAVE_TRACKS = FALSE
dir.create(TRACKS_DIR, showWarnings = FALSE, recursive = TRUE)

# Exclude output playlists from being re-used as sources
build_exclude_prefixes <- function(base_title) {
  base <- gsub("\\s+", " ", trimws(base_title))
  uniq <- unique(c(
    base,
    paste0(base, " \u2014 Part"),
    paste0(base, " - Part"),
    paste0(base, " \u2014 Part "),
    paste0(base, " - Part "),
    gsub("\\s*-\\s*", " - ", base),
    gsub("\\s*-\\s*", " ", base)
  ))
  uniq[nzchar(uniq)]
}
EXCLUDE_TITLE_PREFIXES <- unique(c(
  build_exclude_prefixes(OUT_BASE_TITLE),
  "dnb bootlegs mega",
  "dnb bootlegs - mega"
))

is_output_playlist <- function(pl) {
  t <- as.character(pl$title %||% "")
  if (!nzchar(t)) return(FALSE)
  any(startsWith(t, EXCLUDE_TITLE_PREFIXES))
}

playlist_matches_keywords <- function(pl, keywords, require_all = TRUE, search_description = TRUE) {
  if (!length(keywords)) return(TRUE)
  title <- safe_lower(pl$title)
  desc  <- if (isTRUE(search_description)) safe_lower(pl$description) else ""
  txt <- paste(title, desc)
  hits <- vapply(keywords, function(k) grepl(tolower(k), txt, fixed = TRUE), logical(1))
  if (isTRUE(require_all)) all(hits) else any(hits)
}

# ---- Better sorting signal ----
W_PLAY    <- 1
W_LIKE    <- 50
W_REPOST  <- 200
W_COMMENT <- 10

# If TRUE: when metrics are missing, call /tracks/:id to fill (slower but better sorting)
ENRICH_MISSING_METRICS <- TRUE

# ---- Public playlist filtering (BEFORE fetching tracks) ----
PUBLIC_FILTER_ENABLE <- TRUE
PUBLIC_REQUIRE_BOTH_GROUPS <- TRUE

PUBLIC_DNB_TERMS <- c("dnb", "drum and bass", "drum & bass", "d&b")
PUBLIC_BOOTLEG_TERMS <- PUBLIC_REQUIRE_TERMS
PUBLIC_EXCLUDE_TERMS <- c("podcast", "episode", "audiobook", "lecture")

PUBLIC_MIN_TRACK_COUNT <- 10
PUBLIC_MAX_TRACK_COUNT <- 500
PUBLIC_MIN_LIKES_COUNT <- 0

PUBLIC_RANK_MODE <- "likes_per_track"  # "likes", "likes_per_track", "recency_likes"

PUBLIC_PREVIEW_TOP_N <- 80
PUBLIC_WRITE_PREVIEW_CSV <- TRUE
PUBLIC_PREVIEW_CSV <- file.path(REPORT_DIR, "public_playlist_candidates.csv")

# ============================================================
# 1) HTTP helper (returns status + parsed json; retries 429/5xx)
# ============================================================

sc_req <- function(method, path_or_url, access_token,
                   query = NULL, body = NULL,
                   timeout_sec = 60) {
  
  stopifnot(nzchar(access_token))
  url <- if (grepl("^https?://", path_or_url)) path_or_url else paste0("https://api.soundcloud.com", path_or_url)
  
  r <- request(url) |>
    req_method(method) |>
    req_headers(
      "Authorization" = paste("OAuth", access_token),
      "Accept" = "application/json; charset=utf-8"
    ) |>
    req_error(is_error = ~ FALSE) |>
    req_timeout(timeout_sec)
  
  if (!is.null(query)) r <- r |> req_url_query(!!!query)
  
  if (!is.null(body)) {
    r <- r |>
      req_headers("Content-Type" = "application/json") |>
      req_body_json(body, auto_unbox = TRUE, null = "null")
  }
  
  attempts <- 0
  repeat {
    attempts <- attempts + 1
    resp <- req_perform(r)
    status <- resp_status(resp)
    
    if (status == 429 && attempts < 6) {
      ra <- resp_header(resp, "retry-after")
      wait <- suppressWarnings(as.numeric(ra))
      if (is.na(wait)) wait <- 2 ^ attempts
      message(sprintf("Rate limited (429). Sleeping %ss then retrying...", wait))
      Sys.sleep(wait)
      next
    }
    
    if (status >= 500 && attempts < 4) {
      wait <- 2 ^ attempts
      message(sprintf("Server error (%s). Sleeping %ss then retrying...", status, wait))
      Sys.sleep(wait)
      next
    }
    
    txt <- resp_body_string(resp)
    parsed <- NULL
    if (nzchar(txt)) parsed <- tryCatch(fromJSON(txt, simplifyVector = FALSE), error = function(e) NULL)
    
    return(list(status = status, text = txt, json = parsed, resp = resp))
  }
}

sc_stop_for_http <- function(res, context = "") {
  msg <- paste0(
    if (nzchar(context)) paste0(context, "\n") else "",
    "HTTP ", res$status, "\n",
    if (!is.null(res$json)) paste0(toJSON(res$json, auto_unbox = TRUE, pretty = TRUE), "\n") else "",
    if (is.null(res$json)) res$text else ""
  )
  stop(msg, call. = FALSE)
}

# ============================================================
# 2) OAuth PKCE (auto-capture localhost callback + refresh)
# ============================================================

base64url_encode <- function(rawvec) {
  enc <- base64enc::base64encode(rawvec)
  enc <- gsub("\\+", "-", enc)
  enc <- gsub("/", "_", enc)
  enc <- gsub("=+$", "", enc)
  enc
}

rand_str <- function(n = 64) {
  chars <- c(LETTERS, letters, 0:9, "-", ".", "_", "~")
  paste0(sample(chars, n, replace = TRUE), collapse = "")
}

pkce_make <- function() {
  verifier <- rand_str(96)
  challenge <- base64url_encode(openssl::sha256(charToRaw(verifier)))
  list(verifier = verifier, challenge = challenge)
}

read_token_file <- function() {
  if (!file.exists(TOKEN_FILE)) return(NULL)
  tryCatch(fromJSON(TOKEN_FILE, simplifyVector = TRUE), error = function(e) NULL)
}

write_token_file <- function(tok) {
  writeLines(toJSON(tok, auto_unbox = TRUE, pretty = TRUE), TOKEN_FILE)
}

token_is_valid <- function(tok) {
  if (is.null(tok) || is.null(tok$access_token)) return(FALSE)
  expires_in <- tok$expires_in %||% tok$expires %||% NA
  created_at <- tok$created_at %||% tok$obtained_at %||% NA
  if (is.na(expires_in) || is.na(created_at)) return(TRUE)
  (as.numeric(Sys.time()) < (as.numeric(created_at) + as.numeric(expires_in) - 60))
}

sc_token_refresh <- function(tok) {
  if (is.null(tok$refresh_token) || !nzchar(tok$refresh_token)) return(NULL)
  
  r <- request("https://secure.soundcloud.com/oauth/token") |>
    req_method("POST") |>
    req_error(is_error = ~ FALSE) |>
    req_body_form(
      grant_type = "refresh_token",
      refresh_token = tok$refresh_token,
      client_id = SC_CLIENT_ID,
      client_secret = SC_CLIENT_SECRET
    ) |>
    req_timeout(60)
  
  resp <- req_perform(r)
  status <- resp_status(resp)
  txt <- resp_body_string(resp)
  js <- tryCatch(fromJSON(txt, simplifyVector = TRUE), error = function(e) NULL)
  
  if (status >= 300 || is.null(js$access_token)) return(NULL)
  
  js$created_at <- as.numeric(Sys.time())
  if (is.null(js$refresh_token) || !nzchar(js$refresh_token)) js$refresh_token <- tok$refresh_token
  write_token_file(js)
  js
}

wait_for_oauth_code_httpuv <- function(redirect_uri, expected_state, timeout_sec = 180) {
  u <- httr2::url_parse(redirect_uri)
  host <- u$hostname %||% ""
  port <- as.integer(u$port %||% 80)
  path <- u$path %||% "/"
  
  if (!(host %in% c("localhost", "127.0.0.1"))) {
    stop("SC_REDIRECT_URI must be localhost/127.0.0.1 for auto-capture. Currently: ", redirect_uri, call. = FALSE)
  }
  
  got <- new.env(parent = emptyenv())
  got$params <- list()
  
  app <- list(
    call = function(req) {
      if (!identical(req$PATH_INFO, path)) {
        return(list(
          status = 404L,
          headers = list("Content-Type" = "text/plain"),
          body = paste0("Not found. Expected path: ", path)
        ))
      }
      
      qs <- req$QUERY_STRING %||% ""
      qs_clean <- sub("^\\?", "", qs)
      
      params <- if (nzchar(qs_clean)) {
        httr2::url_parse(paste0("http://x", path, "?", qs_clean))$query
      } else {
        list()
      }
      
      got$params <- params
      ok <- !is.null(params$code) && !is.null(params$state)
      
      body <- if (ok) {
        "<html><body><h3>SoundCloud auth received \u2705</h3><p>You can close this tab and return to R.</p></body></html>"
      } else {
        paste0(
          "<html><body>",
          "<h3>Waiting for parameters...</h3>",
          "<p>This callback must be reached as:</p>",
          "<code>", redirect_uri, "?code=...&state=...</code>",
          "<p><b>query string received:</b> ", if (nzchar(qs)) qs else "(none)", "</p>",
          "<p>If you see this, go back to the SoundCloud approval tab and click Approve/Allow.</p>",
          "</body></html>"
        )
      }
      
      list(status = 200L, headers = list("Content-Type" = "text/html; charset=utf-8"), body = body)
    }
  )
  
  srv <- httpuv::startServer("127.0.0.1", port, app)
  on.exit(httpuv::stopServer(srv), add = TRUE)
  
  message("Waiting for SoundCloud redirect on: ", redirect_uri)
  t0 <- Sys.time()
  
  repeat {
    httpuv::service(100)
    params <- got$params
    if (!is.null(params$code) && !is.null(params$state)) break
    if (as.numeric(difftime(Sys.time(), t0, units = "secs")) > timeout_sec) break
    Sys.sleep(0.05)
  }
  
  params <- got$params
  
  if (is.null(params$code) || is.null(params$state)) {
    message("\nAuto-capture timed out.")
    message("Fallback: paste FULL redirected URL from your browser address bar.")
    redirected <- readline("Paste redirected URL: ")
    redirected <- sub("#", "?", redirected, fixed = TRUE)
    q <- httr2::url_parse(redirected)$query
    if (is.null(q$code) || is.null(q$state)) stop("Could not parse code/state from redirected URL.", call. = FALSE)
    params <- q
  }
  
  if (!identical(params$state, expected_state)) stop("State mismatch (possible CSRF). Re-run login.", call. = FALSE)
  params$code
}

sc_get_access_token <- function() {
  tok <- read_token_file()
  if (token_is_valid(tok)) return(tok$access_token)
  
  tok2 <- sc_token_refresh(tok)
  if (!is.null(tok2) && token_is_valid(tok2)) return(tok2$access_token)
  
  message("No valid token found. Starting OAuth login (PKCE)...")
  pkce <- pkce_make()
  state <- rand_str(24)
  
  auth_url <- paste0(
    "https://secure.soundcloud.com/authorize?",
    "client_id=", utils::URLencode(SC_CLIENT_ID, reserved = TRUE),
    "&redirect_uri=", utils::URLencode(SC_REDIRECT_URI, reserved = TRUE),
    "&response_type=code",
    "&code_challenge=", utils::URLencode(pkce$challenge, reserved = TRUE),
    "&code_challenge_method=S256",
    "&state=", utils::URLencode(state, reserved = TRUE)
  )
  
  message("\nOpening browser for authorization...\n")
  message(auth_url, "\n")
  suppressWarnings(try(utils::browseURL(auth_url), silent = TRUE))
  
  code <- wait_for_oauth_code_httpuv(SC_REDIRECT_URI, state, timeout_sec = 180)
  
  r <- request("https://secure.soundcloud.com/oauth/token") |>
    req_method("POST") |>
    req_error(is_error = ~ FALSE) |>
    req_body_form(
      grant_type = "authorization_code",
      client_id = SC_CLIENT_ID,
      client_secret = SC_CLIENT_SECRET,
      redirect_uri = SC_REDIRECT_URI,
      code = code,
      code_verifier = pkce$verifier
    ) |>
    req_timeout(60)
  
  resp <- req_perform(r)
  status <- resp_status(resp)
  txt <- resp_body_string(resp)
  js <- tryCatch(fromJSON(txt, simplifyVector = TRUE), error = function(e) NULL)
  
  if (status >= 300 || is.null(js$access_token)) stop("Token exchange failed.\n", txt, call. = FALSE)
  
  js$created_at <- as.numeric(Sys.time())
  write_token_file(js)
  js$access_token
}

# ============================================================
# 3) Paging + public search helpers
# ============================================================

sc_get_all_pages <- function(path_or_url, access_token, query = list(limit = 200, linked_partitioning = "true")) {
  out <- list()
  next_href <- NULL
  
  repeat {
    res <- if (is.null(next_href)) {
      sc_req("GET", path_or_url, access_token, query = query)
    } else {
      sc_req("GET", next_href, access_token)
    }
    
    if (res$status >= 300) sc_stop_for_http(res, paste0("GET ", path_or_url, " failed"))
    
    js <- res$json
    if (is.null(js$collection)) break
    
    out <- c(out, js$collection)
    next_href <- js$next_href %||% NULL
    if (is.null(next_href) || !nzchar(next_href)) break
    
    Sys.sleep(0.15)
  }
  
  out
}

sc_search_playlists_public_cap <- function(q, access_token,
                                           cap = Inf,
                                           keywords = character(0),
                                           require_all = TRUE,
                                           search_description = TRUE,
                                           verbose = TRUE) {
  
  if (!nzchar(q)) stop("q is empty", call. = FALSE)
  
  match_kw <- function(pl) {
    if (!length(keywords)) return(TRUE)
    txt <- paste(
      safe_lower(pl$title),
      if (isTRUE(search_description)) safe_lower(pl$description) else "",
      safe_lower(pl$tag_list),
      safe_lower(pl$genre)
    )
    hits <- vapply(keywords, function(k) grepl(tolower(k), txt, fixed = TRUE), logical(1))
    if (isTRUE(require_all)) all(hits) else any(hits)
  }
  
  out <- list()
  seen_ids <- new.env(parent = emptyenv())
  seen_next <- new.env(parent = emptyenv())
  
  next_href <- NULL
  page <- 0L
  
  repeat {
    page <- page + 1L
    
    res <- if (is.null(next_href)) {
      sc_req("GET", "/playlists", access_token,
             query = list(q = q, limit = 200, linked_partitioning = "true"))
    } else {
      if (exists(next_href, envir = seen_next, inherits = FALSE)) {
        if (verbose) message("DEBUG: next_href repeated; breaking to avoid loop.")
        break
      }
      assign(next_href, TRUE, envir = seen_next)
      sc_req("GET", next_href, access_token)
    }
    
    if (res$status >= 300) sc_stop_for_http(res, paste0("GET /playlists failed for q='", q, "'"))
    
    js <- res$json
    coll <- js$collection %||% list()
    if (verbose) message("DEBUG page ", page, ": got ", length(coll), " playlists")
    if (!length(coll)) break
    
    for (pl in coll) {
      pid <- as.character(pl$id %||% "")
      if (!nzchar(pid)) next
      if (exists(pid, envir = seen_ids, inherits = FALSE)) next
      if (!match_kw(pl)) next
      
      assign(pid, TRUE, envir = seen_ids)
      out[[length(out) + 1L]] <- pl
      if (length(out) >= cap) break
    }
    
    if (length(out) >= cap) break
    
    next_href <- js$next_href %||% NULL
    if (is.null(next_href) || !nzchar(next_href)) break
    
    Sys.sleep(0.12)
  }
  
  if (verbose) message("DEBUG: returning ", length(out), " playlists (cap=", cap, ")")
  out
}

# ---- union search + second-pass required-term filter ----
sc_search_playlists_public_union <- function(queries,
                                             access_token,
                                             cap = Inf,
                                             keywords = character(0),
                                             require_all = TRUE,
                                             search_description = TRUE,
                                             verbose = TRUE,
                                             required_terms = PUBLIC_REQUIRE_TERMS,
                                             required_terms_all = PUBLIC_REQUIRE_ALL_TERMS,
                                             required_terms_search_description = PUBLIC_REQUIRE_TERMS_SEARCH_DESCRIPTION) {
  
  queries <- unique(trimws(queries))
  queries <- queries[nzchar(queries)]
  if (!length(queries)) stop("PUBLIC_SEARCH_QUERIES is empty.", call. = FALSE)
  
  all <- list()
  for (qq in queries) {
    if (verbose) message("Public search: q='", qq, "'")
    pls_q <- sc_search_playlists_public_cap(
      q = qq,
      access_token = access_token,
      cap = Inf,
      keywords = character(0),
      require_all = FALSE,
      search_description = search_description,
      verbose = FALSE
    )
    if (verbose) message("  -> ", length(pls_q), " playlists")
    all <- c(all, pls_q)
  }
  
  ids <- vapply(all, function(p) as.character(p$id %||% ""), "")
  keep <- nzchar(ids) & !duplicated(ids)
  all <- all[keep]
  
  if (verbose) message("Union search returned ", length(all), " unique playlists (pre-filter).")
  
  if (length(keywords)) {
    all <- Filter(function(pl) {
      playlist_matches_keywords(pl, keywords, require_all, search_description)
    }, all)
    if (verbose) message("After keyword filter: ", length(all), " playlists.")
  }
  
  if (length(required_terms)) {
    before_n <- length(all)
    all <- Filter(function(pl) {
      playlist_matches_any_terms(
        pl,
        terms = required_terms,
        search_description = required_terms_search_description,
        require_all = required_terms_all
      )
    }, all)
    if (verbose) message("After required-terms filter (",
                         paste(required_terms, collapse = ", "),
                         "): ", length(all), " playlists (from ", before_n, ").")
  }
  
  if (is.finite(cap) && length(all) > cap) {
    all <- all[1:cap]
    if (verbose) message("Capped to ", cap, " playlists.")
  }
  
  all
}

# ---- public filtering + ranking ----
has_any_term <- function(txt, terms) {
  if (!length(terms)) return(FALSE)
  any(vapply(terms, function(t) grepl(tolower(t), txt, fixed = TRUE), logical(1)))
}

has_any_exclude <- function(txt, terms) {
  if (!length(terms)) return(FALSE)
  any(vapply(terms, function(t) grepl(tolower(t), txt, fixed = TRUE), logical(1)))
}

parse_time_best_effort <- function(x) {
  x <- as.character(x %||% "")
  if (!nzchar(x)) return(as.POSIXct(NA))
  out <- suppressWarnings(as.POSIXct(x, tz = "UTC", format = "%Y-%m-%dT%H:%M:%SZ"))
  if (!is.na(out)) return(out)
  suppressWarnings(as.POSIXct(x, tz = "UTC"))
}

rank_playlists_df <- function(df, mode = c("likes", "likes_per_track", "recency_likes")) {
  mode <- match.arg(mode)
  likes <- df$likes_count; likes[is.na(likes)] <- 0
  tc    <- df$track_count; tc[is.na(tc)] <- 0
  
  tmod <- vapply(df$last_modified, function(x) as.numeric(parse_time_best_effort(x)), numeric(1))
  tcrt <- vapply(df$created_at,    function(x) as.numeric(parse_time_best_effort(x)), numeric(1))
  tuse <- ifelse(!is.na(tmod), tmod, tcrt)
  age_days <- (as.numeric(Sys.time()) - tuse) / (60*60*24)
  age_days[is.na(age_days)] <- 36500
  
  score <- switch(
    mode,
    likes = likes,
    likes_per_track = likes / pmax(tc, 1),
    recency_likes = likes * exp(-age_days / 365)
  )
  
  df$score <- score
  df[order(df$score, decreasing = TRUE), , drop = FALSE]
}

filter_public_playlists <- function(pls,
                                    search_description = TRUE,
                                    require_both_groups = TRUE,
                                    dnb_terms = PUBLIC_DNB_TERMS,
                                    bootleg_terms = PUBLIC_BOOTLEG_TERMS,
                                    exclude_terms = PUBLIC_EXCLUDE_TERMS,
                                    min_tracks = PUBLIC_MIN_TRACK_COUNT,
                                    max_tracks = PUBLIC_MAX_TRACK_COUNT,
                                    min_likes = PUBLIC_MIN_LIKES_COUNT,
                                    rank_mode = PUBLIC_RANK_MODE) {
  
  df <- data.frame(
    id            = vapply(pls, function(p) as.character(p$id %||% ""), ""),
    title         = vapply(pls, function(p) as.character(p$title %||% ""), ""),
    track_count   = vapply(pls, function(p) as.numeric(p$track_count %||% NA), numeric(1)),
    likes_count   = vapply(pls, function(p) as.numeric(p$likes_count %||% NA), numeric(1)),
    created_at    = vapply(pls, function(p) as.character(p$created_at %||% ""), ""),
    last_modified = vapply(pls, function(p) as.character(p$last_modified %||% ""), ""),
    user          = vapply(pls, function(p) as.character((p$user %||% list())$username %||% ""), ""),
    permalink_url = vapply(pls, function(p) as.character(p$permalink_url %||% ""), ""),
    stringsAsFactors = FALSE
  )
  
  txt <- vapply(pls, playlist_text_blob, "", search_description = search_description)
  
  dnb_hit     <- vapply(txt, has_any_term, logical(1), terms = dnb_terms)
  bootleg_hit <- vapply(txt, has_any_term, logical(1), terms = bootleg_terms)
  excl_hit    <- vapply(txt, has_any_exclude, logical(1), terms = exclude_terms)
  
  numeric_ok <- (df$track_count >= min_tracks) &
    (df$track_count <= max_tracks) &
    (df$likes_count >= min_likes)
  
  term_ok <- if (isTRUE(require_both_groups)) (dnb_hit & bootleg_hit) else (dnb_hit | bootleg_hit)
  keep <- term_ok & !excl_hit & numeric_ok & nzchar(df$id)
  
  df$keep <- keep
  df$dnb_hit <- dnb_hit
  df$bootleg_hit <- bootleg_hit
  df$excluded_hit <- excl_hit
  
  df_keep <- df[df$keep, , drop = FALSE]
  df_keep <- rank_playlists_df(df_keep, mode = rank_mode)
  
  keep_ids <- df_keep$id
  pls_keep <- pls[vapply(pls, function(p) as.character(p$id %||% "") %in% keep_ids, logical(1))]
  
  ord_map <- match(vapply(pls_keep, function(p) as.character(p$id %||% ""), ""), df_keep$id)
  pls_keep <- pls_keep[order(ord_map)]
  
  list(playlists = pls_keep, preview = df, kept_preview = df_keep)
}

# ============================================================
# 4) SoundCloud object fetchers
# ============================================================

sc_list_my_playlists <- function(access_token) {
  sc_get_all_pages("/me/playlists", access_token, query = list(limit = 200, linked_partitioning = "true"))
}

sc_get_playlist_tracks <- function(playlist_id, access_token) {
  sc_get_all_pages(paste0("/playlists/", playlist_id, "/tracks"), access_token,
                   query = list(limit = 200, linked_partitioning = "true"))
}

sc_get_playlist_tracks_safe <- function(playlist_id, access_token) {
  tryCatch(
    sc_get_playlist_tracks(playlist_id, access_token),
    error = function(e) {
      warning(sprintf("Skipping playlist %s due to error: %s", playlist_id, conditionMessage(e)), call. = FALSE)
      list()
    }
  )
}

# ============================================================
# 5) Playlist selection + preview
# ============================================================

playlist_preview_tbl <- function(pls) {
  if (!length(pls)) return(data.frame())
  data.frame(
    id            = vapply(pls, function(p) as.character(p$id %||% ""), ""),
    title         = vapply(pls, function(p) as.character(p$title %||% ""), ""),
    user          = vapply(pls, function(p) as.character((p$user %||% list())$username %||% ""), ""),
    track_count   = vapply(pls, function(p) suppressWarnings(as.integer(p$track_count %||% NA)), integer(1)),
    sharing       = vapply(pls, function(p) as.character(p$sharing %||% ""), ""),
    created_at    = vapply(pls, function(p) as.character(p$created_at %||% ""), ""),
    permalink_url = vapply(pls, function(p) as.character(p$permalink_url %||% ""), ""),
    stringsAsFactors = FALSE
  )
}

resolve_source_playlists <- function(my_playlists, access_token) {
  
  # 1) Explicit IDs
  if (length(SOURCE_PLAYLIST_IDS)) {
    wanted <- as.character(SOURCE_PLAYLIST_IDS)
    out <- Filter(function(pl) as.character(pl$id) %in% wanted, my_playlists)
    out <- Filter(function(pl) !is_output_playlist(pl), out)
    if (!length(out)) stop("None of SOURCE_PLAYLIST_IDS were found in /me/playlists (after excluding outputs).", call. = FALSE)
    return(out)
  }
  
  # 2) Explicit Titles
  if (length(SOURCE_PLAYLIST_TITLES)) {
    wanted <- as.character(SOURCE_PLAYLIST_TITLES)
    out <- Filter(function(pl) {
      t <- as.character(pl$title %||% "")
      nzchar(t) && (t %in% wanted)
    }, my_playlists)
    out <- Filter(function(pl) !is_output_playlist(pl), out)
    if (!length(out)) stop("None of SOURCE_PLAYLIST_TITLES matched (after excluding outputs).", call. = FALSE)
    return(out)
  }
  
  # 3) Auto from your playlists by keywords
  if (identical(SOURCE_MODE, "mine_keywords")) {
    if (!length(PLAYLIST_KEYWORDS)) stop("PLAYLIST_KEYWORDS is empty.", call. = FALSE)
    
    out <- Filter(function(pl) {
      !is_output_playlist(pl) && playlist_matches_keywords(pl, PLAYLIST_KEYWORDS, REQUIRE_ALL_KEYWORDS, SEARCH_DESCRIPTION)
    }, my_playlists)
    
    if (!length(out)) stop("No *your* playlists matched PLAYLIST_KEYWORDS (after excluding outputs).", call. = FALSE)
    
    if (length(out) > MAX_SOURCE_PLAYLISTS) out <- out[1:MAX_SOURCE_PLAYLISTS]
    message("Auto-selected ", length(out), " of your playlists by keywords: ",
            paste(PLAYLIST_KEYWORDS, collapse = ", "))
    return(out)
  }
  
  # 4) Auto public search
  if (identical(SOURCE_MODE, "public_search")) {
    
    if (isTRUE(PUBLIC_SEARCH_USE_UNION)) {
      pls <- sc_search_playlists_public_union(
        queries = PUBLIC_SEARCH_QUERIES,
        access_token = access_token,
        cap = MAX_SOURCE_PLAYLISTS,
        keywords = PLAYLIST_KEYWORDS,
        require_all = REQUIRE_ALL_KEYWORDS,
        search_description = SEARCH_DESCRIPTION,
        verbose = TRUE
      )
    } else {
      if (!nzchar(PUBLIC_SEARCH_Q)) stop("PUBLIC_SEARCH_Q is empty.", call. = FALSE)
      
      pls <- sc_search_playlists_public_cap(
        q = PUBLIC_SEARCH_Q,
        access_token = access_token,
        cap = MAX_SOURCE_PLAYLISTS,
        keywords = PLAYLIST_KEYWORDS,
        require_all = REQUIRE_ALL_KEYWORDS,
        search_description = SEARCH_DESCRIPTION,
        verbose = TRUE
      )
    }
    
    # exclude outputs
    pls <- Filter(function(pl) !is_output_playlist(pl), pls)
    
    if (isTRUE(PUBLIC_FILTER_ENABLE)) {
      filt <- filter_public_playlists(
        pls,
        search_description = SEARCH_DESCRIPTION,
        require_both_groups = PUBLIC_REQUIRE_BOTH_GROUPS
      )
      
      if (isTRUE(PUBLIC_WRITE_PREVIEW_CSV)) {
        write.csv(filt$kept_preview, PUBLIC_PREVIEW_CSV, row.names = FALSE)
        message("Wrote candidate preview CSV: ", PUBLIC_PREVIEW_CSV)
      }
      
      message("Filtered public playlists: ", nrow(filt$kept_preview), " kept (from ", length(pls), ").")
      
      topn <- min(PUBLIC_PREVIEW_TOP_N, nrow(filt$kept_preview))
      if (topn > 0) {
        print(filt$kept_preview[1:topn, c("title","user","track_count","likes_count","score","permalink_url")],
              row.names = FALSE)
      }
      
      pls <- filt$playlists
    }
    
    if (length(pls) > MAX_SOURCE_PLAYLISTS) pls <- pls[1:MAX_SOURCE_PLAYLISTS]
    if (!length(pls)) stop("No public playlists matched your query/filters.", call. = FALSE)
    
    message("Auto-selected ", length(pls), " public playlists (union=", isTRUE(PUBLIC_SEARCH_USE_UNION), ").")
    return(pls)
  }
  
  stop("Set SOURCE_PLAYLIST_IDS, SOURCE_PLAYLIST_TITLES, or SOURCE_MODE ('mine_keywords'/'public_search').", call. = FALSE)
}

# ============================================================
# 6) Track extraction + metric enrichment + scoring (+ BPM)
# ============================================================

get_first_field <- function(x, fields) {
  for (f in fields) {
    if (is.list(x) && !is.null(sc_value(x[[f]]))) return(x[[f]])
  }
  NULL
}

parse_sc_time <- function(x) {
  if (is.na(x) || !nzchar(x)) return(as.POSIXct(NA))
  out <- suppressWarnings(as.POSIXct(x, tz = "UTC", format = "%Y-%m-%dT%H:%M:%SZ"))
  if (!is.na(out)) return(out)
  # Also try the format with slashes: "2021/11/04 06:01:24 +0000"
  out2 <- suppressWarnings(as.POSIXct(x, tz = "UTC", format = "%Y/%m/%d %H:%M:%S %z"))
  if (!is.na(out2)) return(out2)
  suppressWarnings(as.POSIXct(x, tz = "UTC"))
}

extract_track_id <- function(tr) {
  if (is.null(tr)) return(NA_character_)
  if (is.atomic(tr) && length(tr) == 1) return(as.character(tr))
  if (is.list(tr) && !is.null(tr$id)) return(as.character(tr$id))
  NA_character_
}

extract_track_urn <- function(tr) {
  if (is.null(tr)) return(NA_character_)
  if (is.list(tr) && !is.null(tr$urn)) return(as.character(tr$urn))
  NA_character_
}

# Pick best available audio URL from a track JSON object
# Priority: preview_mp3_128_url > stream_url
extract_audio_url <- function(tr) {
  # 1) preview_mp3_128_url (classic field)
  url <- sc_character(tr$preview_mp3_128_url)
  if (!is.na(url) && nzchar(url)) return(url)
  
  # 2) stream_url (current API — returns audio with OAuth)
  url <- sc_character(tr$stream_url)
  if (!is.na(url) && nzchar(url)) return(url)
  
  NA_character_
}

track_to_row <- function(tr, src_playlist_id = NA_character_, src_playlist_title = NA_character_) {
  id <- extract_track_id(tr)
  urn <- extract_track_urn(tr)
  
  title <- if (is.list(tr) && !is.null(sc_value(tr$title))) as.character(tr$title) else NA_character_
  user  <- if (is.list(tr) && !is.null(tr$user) && !is.null(sc_value(tr$user$username))) as.character(tr$user$username) else NA_character_
  
  playback <- sc_numeric(if (is.list(tr)) tr$playback_count else NULL)
  likes    <- sc_numeric(get_first_field(tr, c("likes_count", "favoritings_count")))
  reposts  <- sc_numeric(get_first_field(tr, c("reposts_count")))
  comments <- sc_numeric(get_first_field(tr, c("comment_count", "comments_count")))
  created  <- sc_character(get_first_field(tr, c("created_at")))
  
  access <- sc_character(if (is.list(tr)) tr$access else NULL)
  
  # Best available audio URL for BPM
  audio_url <- if (is.list(tr)) extract_audio_url(tr) else NA_character_
  
  # BPM from payload (handle {} -> NULL via sc_numeric)
  bpm0 <- sc_numeric(if (is.list(tr)) tr$bpm else NULL)
  
  data.frame(
    track_id = id,
    track_urn = urn,
    title = title,
    username = user,
    playback_count = playback,
    likes_count = likes,
    reposts_count = reposts,
    comment_count = comments,
    created_at = created,
    access = access,
    source_playlist_id = as.character(src_playlist_id),
    source_playlist_title = as.character(src_playlist_title),
    audio_url = audio_url,
    bpm = bpm0,
    stringsAsFactors = FALSE
  )
}

sc_get_track_details <- function(track_id, access_token) {
  sc_req("GET", paste0("/tracks/", track_id), access_token)
}

fill_missing_track_metrics <- function(df, access_token) {
  if (!isTRUE(ENRICH_MISSING_METRICS)) return(df)
  
  need <- which(
    (is.na(df$playback_count) |
       is.na(df$likes_count) |
       is.na(df$reposts_count) |
       is.na(df$comment_count) |
       is.na(df$created_at) |
       (isTRUE(COMPUTE_BPM) & is.na(df$bpm)) |
       (isTRUE(COMPUTE_BPM) & (is.na(df$audio_url) | !nzchar(df$audio_url)))
    ) &
      !is.na(df$track_id) & nzchar(df$track_id)
  )
  if (!length(need)) return(df)
  
  message("Enriching metrics for ", length(need), " tracks via /tracks/:id ...")
  for (i in need) {
    tid <- df$track_id[i]
    if (!grepl("^\\d+$", tid)) next
    
    res <- sc_get_track_details(tid, access_token)
    if (res$status < 300 && !is.null(res$json)) {
      js <- res$json
      
      pc <- sc_numeric(js$playback_count)
      if (!is.na(pc)) df$playback_count[i] <- pc
      
      lk <- sc_numeric(get_first_field(js, c("likes_count", "favoritings_count")))
      if (!is.na(lk)) df$likes_count[i] <- lk
      
      rp <- sc_numeric(get_first_field(js, c("reposts_count")))
      if (!is.na(rp)) df$reposts_count[i] <- rp
      
      cc <- sc_numeric(get_first_field(js, c("comment_count", "comments_count")))
      if (!is.na(cc)) df$comment_count[i] <- cc
      
      ca <- sc_character(get_first_field(js, c("created_at")))
      if (!is.na(ca)) df$created_at[i] <- ca
      
      # Audio URL: try preview_mp3_128_url, then stream_url
      au <- extract_audio_url(js)
      if (!is.na(au) && nzchar(au)) df$audio_url[i] <- au
      
      # BPM from API (handles {} correctly now)
      bv <- sc_numeric(js$bpm)
      if (!is.na(bv) && is.finite(bv) && bv > 0) df$bpm[i] <- bv
    }
    
    Sys.sleep(0.10)
  }
  
  df
}

compute_score_cols <- function(df) {
  plays    <- df$playback_count; plays[is.na(plays)] <- 0
  likes    <- df$likes_count;    likes[is.na(likes)] <- 0
  reposts  <- df$reposts_count;  reposts[is.na(reposts)] <- 0
  comments <- df$comment_count;  comments[is.na(comments)] <- 0
  
  df$score <- (W_PLAY * plays) + (W_LIKE * likes) + (W_REPOST * reposts) + (W_COMMENT * comments)
  df$created_ts <- vapply(df$created_at, function(x) as.numeric(parse_sc_time(x)), numeric(1))
  df
}

order_by_score <- function(df) {
  sc    <- df$score;          sc[is.na(sc)] <- -Inf
  plays <- df$playback_count; plays[is.na(plays)] <- -1
  likes <- df$likes_count;    likes[is.na(likes)] <- -1
  reps  <- df$reposts_count;  reps[is.na(reps)] <- -1
  comm  <- df$comment_count;  comm[is.na(comm)] <- -1
  cts   <- df$created_ts;     cts[is.na(cts)] <- -Inf
  
  df[order(sc, plays, likes, reps, comm, cts, decreasing = TRUE), , drop = FALSE]
}

# ============================================================
# 6b) BPM estimation via librosa + yt-dlp / API download
# ============================================================

ytdlp_is_available <- function() {
  nzchar(Sys.which(YTDLP_BIN))
}

librosa_is_available <- function() {
  if (!file.exists(LIBROSA_PYTHON)) return(FALSE)
  # Use a temp script instead of -c to avoid Windows shell quoting issues
  tmp <- tempfile(fileext = ".py")
  on.exit(unlink(tmp), add = TRUE)
  writeLines("import librosa; print('ok')", tmp)
  res <- tryCatch({
    out <- system2(LIBROSA_PYTHON, args = shQuote(tmp), stdout = TRUE, stderr = TRUE)
    any(grepl("ok", out))
  }, error = function(e) FALSE)
  res
}

# Cache this at startup so we don't check every track
.librosa_ok <- NULL
check_librosa <- function() {
  if (is.null(.librosa_ok)) .librosa_ok <<- librosa_is_available()
  .librosa_ok
}

# Build a safe filename from track title + artist
sanitize_filename <- function(text, max_len = 80) {
  out <- gsub('[\\/:*?"<>|]', '_', text)
  out <- gsub('\\s+', ' ', trimws(out))
  if (nchar(out) > max_len) out <- substr(out, 1, max_len)
  out
}

make_track_path <- function(title, username, track_id, ext = "m4a") {
  title_s <- sanitize_filename(title %||% "unknown")
  user_s  <- sanitize_filename(username %||% "unknown")
  fname   <- paste0(user_s, " - ", title_s, " [", track_id, "].", ext)
  file.path(TRACKS_DIR, fname)
}

#' Download full track via yt-dlp
#'
#' Downloads to a safe temp name (track ID only, no special characters),
#' then renames to the desired destination. This avoids Windows quoting
#' issues with spaces, parentheses, and brackets in filenames.
#'
#' @param track_id SoundCloud track ID
#' @param dest_file Local file path to save
#' @return Path to the actual downloaded file, or NULL if failed
download_via_ytdlp <- function(track_id, dest_file) {
  if (!ytdlp_is_available()) return(NULL)
  
  sc_url <- paste0("https://api.soundcloud.com/tracks/", track_id)
  
  # Download to a safe temp name — just the track ID, no special characters
  dest_dir <- dirname(dest_file)
  tmp_base <- file.path(dest_dir, track_id)
  out_template <- paste0(tmp_base, ".%(ext)s")
  
  tryCatch({
    result <- system2(YTDLP_BIN, args = c(
      "--no-playlist",
      "--no-overwrites",
      "-o", out_template,
      sc_url
    ), stdout = TRUE, stderr = TRUE)
    
    # Find the file yt-dlp actually created
    possible_exts <- c("m4a", "mp3", "opus", "ogg", "wav", "aac", "webm")
    downloaded <- NULL
    for (ext in possible_exts) {
      candidate <- paste0(tmp_base, ".", ext)
      if (file.exists(candidate)) {
        fsize <- file.info(candidate)$size
        if (!is.na(fsize) && fsize > 50000) {
          downloaded <- candidate
          break
        }
      }
    }
    
    if (is.null(downloaded)) {
      err_lines <- grep("^ERROR", result, value = TRUE)
      if (length(err_lines)) message("  yt-dlp error: ", err_lines[1])
      return(NULL)
    }
    
    # Rename from "12345.m4a" to "Artist - Title [12345].m4a"
    final_ext <- tools::file_ext(downloaded)
    final_dest <- paste0(tools::file_path_sans_ext(dest_file), ".", final_ext)
    
    if (normalizePath(downloaded, mustWork = FALSE) !=
        normalizePath(final_dest, mustWork = FALSE)) {
      file.rename(downloaded, final_dest)
    }
    
    if (file.exists(final_dest)) return(final_dest)
    
    # Rename failed — return the temp-named file
    if (file.exists(downloaded)) return(downloaded)
    
    NULL
  }, error = function(e) {
    message("  yt-dlp download error: ", conditionMessage(e))
    NULL
  })
}

#' Download audio from SoundCloud via API (stream_url or preview_mp3_128_url)
#' Falls back to ~30s preview when yt-dlp is not available.
#'
#' @param audio_url The audio URL (stream_url or preview_mp3_128_url)
#' @param dest_file Local file path to save the audio
#' @param access_token OAuth access token for authentication
#' @return TRUE if download succeeded and file is large enough, FALSE otherwise
download_audio_api <- function(audio_url, dest_file, access_token = NULL) {
  tryCatch({
    r <- request(audio_url) |>
      req_error(is_error = ~ FALSE) |>
      req_timeout(30)
    
    if (!is.null(access_token) && nzchar(access_token)) {
      r <- r |> req_headers("Authorization" = paste("OAuth", access_token))
    }
    
    resp <- req_perform(r)
    if (resp_status(resp) >= 300) {
      message("  API download HTTP ", resp_status(resp), " for: ", substr(audio_url, 1, 80))
      return(FALSE)
    }
    
    writeBin(resp_body_raw(resp), dest_file)
    
    fsize <- file.info(dest_file)$size
    if (is.na(fsize) || fsize < 50000) {
      message("  Audio file too small (", fsize, " bytes)")
      return(FALSE)
    }
    
    TRUE
  }, error = function(e) {
    message("  API download error: ", conditionMessage(e))
    FALSE
  })
}

#' Detect BPM using librosa. Uses start_bpm bias from BPM_RANGE
#' for accurate detection of electronic music tempos.
#'
#' @param audio_file Path to audio file (mp3, m4a, wav, etc.)
#' @return Numeric BPM value, or NA_real_ if detection failed
detect_bpm <- function(audio_file) {
  if (!check_librosa()) {
    message("    librosa not available — skipping BPM detection")
    return(NA_real_)
  }
  if (!file.exists(audio_file)) return(NA_real_)
  
  # Compute start_bpm from range midpoint
  start_bpm <- if (!is.na(BPM_RANGE_MIN) && !is.na(BPM_RANGE_MAX)) {
    (BPM_RANGE_MIN + BPM_RANGE_MAX) / 2
  } else {
    120  # librosa default
  }
  
  py_script <- tempfile(fileext = ".py")
  on.exit(unlink(py_script), add = TRUE)
  
  writeLines(c(
    "import sys, warnings",
    "warnings.filterwarnings('ignore')",
    "import librosa",
    paste0("y, sr = librosa.load(sys.argv[1], sr=None)"),
    paste0("tempo = librosa.feature.tempo(y=y, sr=sr, start_bpm=", start_bpm, ")"),
    "print(f'{float(tempo[0]):.1f}')"
  ), py_script)
  
  tryCatch({
    # shQuote both paths for Windows shell safety (spaces, parens in filenames)
    result <- system2(LIBROSA_PYTHON,
                      args = c(shQuote(py_script), shQuote(audio_file)),
                      stdout = TRUE, stderr = TRUE)
    
    # Find the line that's just a number
    num_lines <- suppressWarnings(as.numeric(trimws(result)))
    bpm_val <- num_lines[!is.na(num_lines) & num_lines >= 20 & num_lines <= 300]
    
    if (length(bpm_val)) {
      return(round(bpm_val[1], 1))
    }
    
    NA_real_
  }, error = function(e) {
    message("    librosa error: ", conditionMessage(e))
    NA_real_
  })
}

# ---- Persistent BPM cache (stored in TRACKS_DIR) ----
# Saves a CSV of track_id -> bpm so we never re-analyze across sessions.
BPM_CACHE_FILE <- file.path(TRACKS_DIR, "bpm_cache.csv")

.bpm_cache <- NULL  # loaded lazily

bpm_cache_load <- function() {
  if (!is.null(.bpm_cache)) return(.bpm_cache)
  if (file.exists(BPM_CACHE_FILE)) {
    tryCatch({
      df <- read.csv(BPM_CACHE_FILE, stringsAsFactors = FALSE,
                     colClasses = c("character", "numeric"))
      cache <- setNames(df$bpm, df$track_id)
      .bpm_cache <<- as.list(cache)
      message("Loaded BPM cache: ", length(.bpm_cache), " entries from ", BPM_CACHE_FILE)
    }, error = function(e) {
      message("Warning: could not read BPM cache, starting fresh. ", conditionMessage(e))
      .bpm_cache <<- list()
    })
  } else {
    .bpm_cache <<- list()
  }
  .bpm_cache
}

bpm_cache_get <- function(track_id) {
  cache <- bpm_cache_load()
  val <- cache[[track_id]]
  if (!is.null(val)) return(val)
  NA_real_
}

bpm_cache_set <- function(track_id, bpm) {
  bpm_cache_load()  # ensure loaded
  .bpm_cache[[track_id]] <<- bpm
}

bpm_cache_save <- function() {
  if (is.null(.bpm_cache) || length(.bpm_cache) == 0) return(invisible(NULL))
  df <- data.frame(
    track_id = names(.bpm_cache),
    bpm = as.numeric(unlist(.bpm_cache)),
    stringsAsFactors = FALSE
  )
  tryCatch({
    write.csv(df, BPM_CACHE_FILE, row.names = FALSE)
    message("Saved BPM cache: ", nrow(df), " entries to ", BPM_CACHE_FILE)
  }, error = function(e) {
    message("Warning: could not write BPM cache. ", conditionMessage(e))
  })
}

#' Download a track and compute BPM.
#'
#' Method priority:
#'   1) Check API /tracks/:id for bpm field (free, usually empty)
#'   2) If DOWNLOAD_METHOD == "yt-dlp": full track via yt-dlp -> librosa
#'   3) Fallback: API stream_url (~30s preview) -> librosa
#'
#' @param track_id SoundCloud numeric track ID
#' @param access_token OAuth token
#' @param audio_url_hint API audio URL for fallback
#' @param save_as Path to save the track (NULL = don't save / use temp)
#' @param track_title Track title (for save filename)
#' @param track_username Track artist (for save filename)
#' @return Numeric BPM or NA_real_
get_track_bpm <- function(track_id, access_token,
                          audio_url_hint = NA_character_,
                          save_as = NULL,
                          track_title = NULL,
                          track_username = NULL) {
  
  if (!isTRUE(COMPUTE_BPM) && !isTRUE(SAVE_TRACKS)) return(NA_real_)
  if (is.na(track_id) || !nzchar(track_id) || !grepl("^\\d+$", track_id)) return(NA_real_)
  
  # Check persistent cache first
  cached <- bpm_cache_get(track_id)
  if (!is.na(cached)) return(cached)
  
  # 1) Cheap: GET /tracks/:id -> bpm field
  res <- sc_get_track_details(track_id, access_token)
  bpm_val <- NA_real_
  audio_url <- audio_url_hint
  
  if (res$status < 300 && !is.null(res$json)) {
    js <- res$json
    bpm_val <- sc_numeric(js$bpm)
    au <- extract_audio_url(js)
    if (!is.na(au) && nzchar(au)) audio_url <- au
  }
  
  # Determine if we need to download (for BPM or saving)
  need_download <- (is.na(bpm_val) || !is.finite(bpm_val) || bpm_val <= 0) || isTRUE(SAVE_TRACKS)
  
  if (need_download) {
    audio_file <- NULL
    is_temp <- FALSE
    
    # 2) Try yt-dlp for full track
    if (identical(DOWNLOAD_METHOD, "yt-dlp") && ytdlp_is_available()) {
      
      if (isTRUE(SAVE_TRACKS) && !is.null(save_as)) {
        # Download directly to save location
        audio_file <- download_via_ytdlp(track_id, save_as)
      } else {
        # Download to temp
        tmp <- tempfile(fileext = ".m4a")
        audio_file <- download_via_ytdlp(track_id, tmp)
        if (!is.null(audio_file)) is_temp <- TRUE
      }
      
      if (!is.null(audio_file)) {
        message("  Downloaded full track via yt-dlp: ",
                round(file.info(audio_file)$size / 1024 / 1024, 1), " MB")
      }
    }
    
    # 3) Fallback: API preview (~30s)
    if (is.null(audio_file) && !is.na(audio_url) && nzchar(audio_url)) {
      ext <- if (grepl("preview", audio_url)) ".mp3" else ".mp3"
      tmp <- tempfile(fileext = ext)
      ok <- download_audio_api(audio_url, tmp, access_token)
      if (ok) {
        audio_file <- tmp
        is_temp <- TRUE
        
        # Save API preview if yt-dlp wasn't available and saving is enabled
        if (isTRUE(SAVE_TRACKS) && !is.null(save_as)) {
          tryCatch({
            # Change extension to mp3 for API downloads
            save_mp3 <- sub("\\.[^.]+$", ".mp3", save_as)
            file.copy(tmp, save_mp3, overwrite = TRUE)
          }, error = function(e) {
            message("  Could not save: ", conditionMessage(e))
          })
        }
        
        message("  Downloaded API preview: ",
                round(file.info(audio_file)$size / 1024, 0), " KB (30s clip)")
      }
    }
    
    # Run BPM detection on whatever we downloaded
    if (!is.null(audio_file) && isTRUE(COMPUTE_BPM)) {
      bpm_detected <- detect_bpm(audio_file)
      if (!is.na(bpm_detected)) bpm_val <- bpm_detected
    }
    
    # Clean up temp files
    if (is_temp && !is.null(audio_file) && file.exists(audio_file)) {
      unlink(audio_file)
    }
  }
  
  bpm_cache_set(track_id, bpm_val)
  bpm_val
}

fill_missing_bpms <- function(df, access_token) {
  if (!isTRUE(COMPUTE_BPM) && !isTRUE(SAVE_TRACKS)) return(df)
  
  if (isTRUE(COMPUTE_BPM) && !check_librosa()) {
    warning("COMPUTE_BPM=TRUE but librosa is not available at: ", LIBROSA_PYTHON, call. = FALSE)
    if (!isTRUE(SAVE_TRACKS)) return(df)
  }
  
  if (identical(DOWNLOAD_METHOD, "yt-dlp") && !ytdlp_is_available()) {
    warning("DOWNLOAD_METHOD='yt-dlp' but yt-dlp not found. Falling back to API previews.", call. = FALSE)
  }
  
  # Pre-fill BPM from persistent cache
  if (isTRUE(COMPUTE_BPM)) {
    cache <- bpm_cache_load()
    cache_hits <- 0
    for (i in seq_len(nrow(df))) {
      if (is.na(df$bpm[i]) && !is.na(df$track_id[i])) {
        cached_val <- bpm_cache_get(df$track_id[i])
        if (!is.na(cached_val)) {
          df$bpm[i] <- cached_val
          cache_hits <- cache_hits + 1
        }
      }
    }
    if (cache_hits > 0) message("BPM cache: filled ", cache_hits, " tracks from cache.")
  }
  
  # Determine which rows need processing
  needs_bpm  <- isTRUE(COMPUTE_BPM) & is.na(df$bpm)
  needs_save <- rep(isTRUE(SAVE_TRACKS), nrow(df))
  
  # Skip already-saved files (check common extensions + both naming schemes)
  if (isTRUE(SAVE_TRACKS)) {
    exts <- c("m4a", "mp3", "opus", "ogg", "wav")
    for (i in seq_len(nrow(df))) {
      # Check pretty name: "Artist - Title [track_id].ext"
      base <- tools::file_path_sans_ext(
        make_track_path(df$title[i], df$username[i], df$track_id[i])
      )
      # Also check raw name: "track_id.ext" (in case rename failed)
      base_raw <- file.path(TRACKS_DIR, df$track_id[i])
      found <- any(file.exists(paste0(base, ".", exts))) ||
        any(file.exists(paste0(base_raw, ".", exts)))
      if (found) needs_save[i] <- FALSE
    }
  }
  
  need <- which((needs_bpm | needs_save) &
                  !is.na(df$track_id) & nzchar(df$track_id) & grepl("^\\d+$", df$track_id))
  if (!length(need)) {
    message("All tracks already cached — nothing to process.")
    return(df)
  }
  
  action <- paste0(
    if (isTRUE(COMPUTE_BPM)) "Computing BPM" else "",
    if (isTRUE(COMPUTE_BPM) && isTRUE(SAVE_TRACKS)) " + " else "",
    if (isTRUE(SAVE_TRACKS)) "saving tracks" else "",
    " [", DOWNLOAD_METHOD, "]"
  )
  message(action, " for ", length(need), " tracks...")
  
  for (i in need) {
    tid <- df$track_id[i]
    message("  [", which(need == i), "/", length(need), "] ",
            df$username[i] %||% "?", " - ", df$title[i] %||% "?")
    
    save_path <- if (isTRUE(SAVE_TRACKS)) {
      make_track_path(df$title[i], df$username[i], tid)
    } else NULL
    
    df$bpm[i] <- get_track_bpm(
      tid, access_token,
      audio_url_hint = df$audio_url[i],
      save_as = save_path,
      track_title = df$title[i],
      track_username = df$username[i]
    )
    
    Sys.sleep(BPM_SLEEP_SEC)
    
    # Save cache periodically in case of interruption
    if (which(need == i) %% 25 == 0) bpm_cache_save()
  }
  
  if (isTRUE(SAVE_TRACKS)) {
    saved_files <- setdiff(list.files(TRACKS_DIR, recursive = FALSE), "bpm_cache.csv")
    message("Tracks saved: ", length(saved_files), " files in ", TRACKS_DIR)
  }
  
  bpm_filled <- sum(!is.na(df$bpm[need]))
  message("BPM detected for ", bpm_filled, "/", length(need), " tracks.")
  
  # Persist cache to disk
  bpm_cache_save()
  
  df
}

# ============================================================
# 6c) Claude AI — genre classification, title cleaning, fuzzy dedup
# ============================================================

claude_is_available <- function() {
  nzchar(CLAUDE_API_KEY)
}

#' Make a single Claude API call. Returns the text response or NULL on error.
claude_call <- function(system_prompt, user_prompt, max_tokens = 2000) {
  if (!claude_is_available()) return(NULL)
  
  body <- list(
    model = CLAUDE_MODEL,
    max_tokens = as.integer(max_tokens),
    system = system_prompt,
    messages = list(list(role = "user", content = user_prompt))
  )
  
  tryCatch({
    resp <- request("https://api.anthropic.com/v1/messages") |>
      req_headers(
        `x-api-key` = CLAUDE_API_KEY,
        `anthropic-version` = "2023-06-01",
        `content-type` = "application/json"
      ) |>
      req_body_json(body) |>
      req_retry(max_tries = 3, backoff = ~ 2) |>
      req_error(is_error = function(resp) FALSE) |>
      req_perform()
    
    if (resp_status(resp) >= 400) {
      err_msg <- tryCatch(resp_body_json(resp)$error$message, error = function(e) "unknown")
      message("  Claude API error ", resp_status(resp), ": ", err_msg)
      return(NULL)
    }
    
    result <- resp_body_json(resp)
    if (length(result$content)) result$content[[1]]$text else NULL
  }, error = function(e) {
    message("  Claude API request failed: ", conditionMessage(e))
    NULL
  })
}

#' Parse JSON from Claude response, stripping markdown fences if present.
parse_claude_json <- function(text) {
  if (is.null(text) || !nzchar(trimws(text))) return(NULL)
  text <- trimws(text)
  text <- gsub("^```json\\s*\n?", "", text)
  text <- gsub("^```\\s*\n?", "", text)
  text <- gsub("\n?\\s*```$", "", text)
  tryCatch(
    fromJSON(text, simplifyDataFrame = TRUE),
    error = function(e) {
      message("  Failed to parse Claude JSON: ", conditionMessage(e))
      NULL
    }
  )
}

# ---- Claude cache (persistent, shared across tasks) ----
CLAUDE_CACHE_FILE <- file.path(TRACKS_DIR, "claude_cache.csv")
.claude_cache <- NULL

claude_cache_load <- function() {
  if (!is.null(.claude_cache)) return(.claude_cache)
  
  empty <- data.frame(
    track_id = character(), is_dnb = logical(), confidence = numeric(),
    subgenre = character(), genre_alt = character(), clean_title = character(),
    stringsAsFactors = FALSE
  )
  
  if (file.exists(CLAUDE_CACHE_FILE)) {
    tryCatch({
      df <- read.csv(CLAUDE_CACHE_FILE, stringsAsFactors = FALSE)
      df$track_id <- as.character(df$track_id)
      # Ensure all expected columns exist
      for (col in names(empty)) {
        if (!(col %in% names(df))) df[[col]] <- NA
      }
      .claude_cache <<- df
      message("Loaded Claude cache: ", nrow(df), " entries")
    }, error = function(e) {
      message("Warning: could not read Claude cache, starting fresh.")
      .claude_cache <<- empty
    })
  } else {
    .claude_cache <<- empty
  }
  .claude_cache
}

claude_cache_save <- function() {
  if (is.null(.claude_cache) || nrow(.claude_cache) == 0) return(invisible(NULL))
  tryCatch({
    write.csv(.claude_cache, CLAUDE_CACHE_FILE, row.names = FALSE)
    message("Saved Claude cache: ", nrow(.claude_cache), " entries")
  }, error = function(e) {
    message("Warning: could not save Claude cache: ", conditionMessage(e))
  })
}

#' Update Claude cache with new data. Merges by track_id:
#' existing columns are preserved unless overwritten by non-NA values.
claude_cache_merge <- function(new_data, update_cols) {
  cache <- claude_cache_load()
  new_data$track_id <- as.character(new_data$track_id)
  
  # Add rows for new track_ids
  new_ids <- setdiff(new_data$track_id, cache$track_id)
  if (length(new_ids)) {
    new_rows <- data.frame(track_id = new_ids, stringsAsFactors = FALSE)
    for (col in c("is_dnb", "confidence", "subgenre", "genre_alt", "clean_title")) {
      new_rows[[col]] <- NA
    }
    cache <- rbind(cache, new_rows)
  }
  
  # Update specified columns
  m <- match(new_data$track_id, cache$track_id)
  for (col in update_cols) {
    if (col %in% names(new_data)) {
      vals <- new_data[[col]]
      non_na <- !is.na(vals)
      cache[[col]][m[non_na]] <- vals[non_na]
    }
  }
  
  .claude_cache <<- cache
}

# ---- Genre + subgenre classification ----
claude_classify_genres <- function(df) {
  if (!claude_is_available()) {
    message("Genre classification: ANTHROPIC_API_KEY not set, skipping.")
    return(df)
  }
  
  cache <- claude_cache_load()
  cached_ids <- cache$track_id[!is.na(cache$is_dnb)]
  needs <- !(df$track_id %in% cached_ids)
  
  if (!any(needs)) {
    message("Genre classification: all ", nrow(df), " tracks already cached.")
  } else {
    to_do <- df[needs, ]
    n <- nrow(to_do)
    message("Classifying genre for ", n, " tracks (", CLAUDE_BATCH_SIZE, " per batch)...")
    
    system_prompt <- paste(
      "You are a music genre classifier specializing in electronic music, particularly drum & bass (DNB).",
      "For each track, analyze the artist name and title to determine the genre.",
      "Respond with ONLY a valid JSON array. No markdown fences, no explanation, no extra text.",
      "Each element must have exactly these fields:",
      "\"track_id\" (string: the ID provided in brackets),",
      "\"is_dnb\" (boolean),",
      "\"confidence\" (number 0.0 to 1.0),",
      "\"subgenre\" (string or null: if DNB, one of: liquid, neurofunk, jump-up, rollers,",
      "minimal, jungle, crossbreed, bootleg, vocal, dancefloor, other; null if not DNB),",
      "\"genre_alt\" (string or null: if NOT DNB, the actual genre e.g. hip-hop, house, pop,",
      "dubstep, garage, techno; null if DNB)."
    )
    
    batches <- split(seq_len(n), ceiling(seq_len(n) / CLAUDE_BATCH_SIZE))
    
    for (b_idx in seq_along(batches)) {
      batch <- to_do[batches[[b_idx]], ]
      
      lines <- paste0(
        seq_len(nrow(batch)), ". [id=", batch$track_id, "] ",
        batch$username, " - ", batch$title
      )
      user_prompt <- paste0("Classify these tracks:\n", paste(lines, collapse = "\n"))
      
      message("  Batch ", b_idx, "/", length(batches), " (", nrow(batch), " tracks)")
      resp <- claude_call(system_prompt, user_prompt, max_tokens = 1500)
      parsed <- parse_claude_json(resp)
      
      if (!is.null(parsed) && is.data.frame(parsed) && nrow(parsed) > 0) {
        parsed$track_id <- as.character(parsed$track_id)
        claude_cache_merge(parsed, c("is_dnb", "confidence", "subgenre", "genre_alt"))
      }
      
      if (b_idx %% 10 == 0) claude_cache_save()
      Sys.sleep(0.3)
    }
    
    claude_cache_save()
  }
  
  # Merge cache results into df
  cache <- claude_cache_load()
  m <- match(df$track_id, cache$track_id)
  df$is_dnb           <- cache$is_dnb[m]
  df$genre_confidence <- cache$confidence[m]
  df$subgenre         <- cache$subgenre[m]
  df$genre_alt        <- cache$genre_alt[m]
  
  n_dnb <- sum(df$is_dnb == TRUE, na.rm = TRUE)
  n_not <- sum(df$is_dnb == FALSE, na.rm = TRUE)
  n_na  <- sum(is.na(df$is_dnb))
  message("Genre results: ", n_dnb, " DNB, ", n_not, " non-DNB, ", n_na, " unclassified")
  
  df
}

# ---- Title cleaning ----
claude_clean_titles <- function(df) {
  if (!claude_is_available()) {
    message("Title cleaning: ANTHROPIC_API_KEY not set, skipping.")
    return(df)
  }
  
  cache <- claude_cache_load()
  cached_ids <- cache$track_id[!is.na(cache$clean_title) & nzchar(cache$clean_title)]
  needs <- !(df$track_id %in% cached_ids)
  
  if (!any(needs)) {
    message("Title cleaning: all ", nrow(df), " tracks already cached.")
  } else {
    to_do <- df[needs, ]
    n <- nrow(to_do)
    message("Cleaning titles for ", n, " tracks (", CLAUDE_BATCH_SIZE, " per batch)...")
    
    system_prompt <- paste(
      "You are a music metadata cleaner. For each track, remove promotional text",
      "from the title while keeping musical content.",
      "The format is: Uploader - Track Title. Only clean the Track Title.",
      "Remove: [FREE DOWNLOAD], (OUT NOW), FULL VERSION ON SPOTIFY, emoji spam,",
      "[4K FREE DOWNLOAD], ALL CAPS promotional phrases, URLs, 'click buy for free DL', etc.",
      "Keep: (Remix), (VIP), (feat. X), (Bootleg), [Artist Mix], artist names, song title.",
      "Respond with ONLY a valid JSON array. No markdown fences.",
      "Each element: {\"track_id\": \"string\", \"clean_title\": \"string\"}"
    )
    
    batches <- split(seq_len(n), ceiling(seq_len(n) / CLAUDE_BATCH_SIZE))
    
    for (b_idx in seq_along(batches)) {
      batch <- to_do[batches[[b_idx]], ]
      
      lines <- paste0(
        seq_len(nrow(batch)), ". [id=", batch$track_id, "] ",
        batch$username, " - ", batch$title
      )
      user_prompt <- paste0("Clean these track titles:\n", paste(lines, collapse = "\n"))
      
      message("  Batch ", b_idx, "/", length(batches), " (", nrow(batch), " tracks)")
      resp <- claude_call(system_prompt, user_prompt, max_tokens = 1500)
      parsed <- parse_claude_json(resp)
      
      if (!is.null(parsed) && is.data.frame(parsed) && nrow(parsed) > 0) {
        parsed$track_id <- as.character(parsed$track_id)
        claude_cache_merge(parsed, "clean_title")
      }
      
      if (b_idx %% 10 == 0) claude_cache_save()
      Sys.sleep(0.3)
    }
    
    claude_cache_save()
  }
  
  # Merge
  cache <- claude_cache_load()
  m <- match(df$track_id, cache$track_id)
  df$clean_title <- cache$clean_title[m]
  
  # Fill missing with original title
  missing <- is.na(df$clean_title) | !nzchar(df$clean_title)
  df$clean_title[missing] <- df$title[missing]
  
  changed <- sum(df$clean_title != df$title, na.rm = TRUE)
  message("Titles cleaned: ", changed, "/", nrow(df), " modified")
  
  df
}

# ---- Fuzzy duplicate detection ----
claude_fuzzy_dedup <- function(df) {
  if (!claude_is_available()) {
    message("Fuzzy dedup: ANTHROPIC_API_KEY not set, skipping.")
    return(df)
  }
  
  # Normalize titles to find candidate groups
  normalize <- function(t) {
    t <- tolower(t)
    t <- gsub("\\[.*?\\]", "", t)        # strip [...]
    t <- gsub("\\(.*?\\)", "", t)          # strip (...)
    t <- gsub("[^a-z0-9 ]", "", t)         # alphanumeric only
    t <- gsub("\\b(free|download|full|version|spotify|out now)\\b", "", t)
    t <- gsub("\\s+", " ", trimws(t))
    t
  }
  
  df$.norm <- normalize(df$title)
  
  # Find groups with identical normalized title from different uploaders
  groups <- split(seq_len(nrow(df)), df$.norm)
  candidate_groups <- list()
  for (key in names(groups)) {
    idx <- groups[[key]]
    if (length(idx) >= 2 && length(unique(df$username[idx])) >= 2) {
      candidate_groups[[length(candidate_groups) + 1]] <- idx
    }
  }
  
  if (length(candidate_groups) == 0) {
    message("Fuzzy dedup: no candidate duplicates found.")
    df$.norm <- NULL
    return(df)
  }
  
  message("Fuzzy dedup: ", length(candidate_groups), " candidate groups, verifying with Claude...")
  
  system_prompt <- paste(
    "You are detecting duplicate music tracks uploaded by different SoundCloud users.",
    "For each group, determine which tracks are the SAME song (same original + same remix).",
    "They're duplicates even if titles differ slightly or one has extra promo text.",
    "For each group of duplicates, pick the version with the most plays as the one to keep.",
    "Respond with ONLY a valid JSON array. No markdown fences.",
    "Each element: {\"group\": number, \"are_duplicates\": boolean,",
    "\"keep_id\": \"track_id to keep\" or null, \"remove_ids\": [\"ids to remove\"] or []}"
  )
  
  # Batch candidate groups (10 groups per API call)
  group_batches <- split(seq_along(candidate_groups), ceiling(seq_along(candidate_groups) / 10))
  all_remove_ids <- character()
  
  for (gb_idx in seq_along(group_batches)) {
    g_indices <- group_batches[[gb_idx]]
    
    lines <- character()
    for (g_num in seq_along(g_indices)) {
      g_idx <- g_indices[g_num]
      idx <- candidate_groups[[g_idx]]
      lines <- c(lines, paste0("Group ", g_num, ":"))
      for (i in idx) {
        lines <- c(lines, paste0("  [id=", df$track_id[i], "] ",
                                 df$username[i], " - ", df$title[i],
                                 " (plays: ", df$playback_count[i] %||% 0, ")"))
      }
    }
    
    user_prompt <- paste0("Check these groups for duplicates:\n", paste(lines, collapse = "\n"))
    
    message("  Group batch ", gb_idx, "/", length(group_batches))
    resp <- claude_call(system_prompt, user_prompt, max_tokens = 1500)
    parsed <- parse_claude_json(resp)
    
    if (!is.null(parsed) && is.data.frame(parsed) && nrow(parsed) > 0) {
      for (r in seq_len(nrow(parsed))) {
        if (isTRUE(parsed$are_duplicates[r])) {
          remove <- as.character(unlist(parsed$remove_ids[[r]]))
          all_remove_ids <- c(all_remove_ids, remove)
        }
      }
    }
    
    Sys.sleep(0.3)
  }
  
  df$.norm <- NULL
  
  if (length(all_remove_ids)) {
    before <- nrow(df)
    all_remove_ids <- unique(all_remove_ids)
    removed <- df[df$track_id %in% all_remove_ids, ]
    df <- df[!(df$track_id %in% all_remove_ids), , drop = FALSE]
    message("Fuzzy dedup removed ", before - nrow(df), " duplicate tracks:")
    for (j in seq_len(nrow(removed))) {
      message("  REMOVED: ", removed$username[j] %||% "?", " - ",
              removed$title[j] %||% "?", " (", removed$track_id[j], ")")
    }
  } else {
    message("Fuzzy dedup: no true duplicates confirmed.")
  }
  
  df
}

# ---- Playlist source scoring ----
claude_score_sources <- function(playlists_df) {
  # playlists_df: data.frame with id, title, track_count, user columns
  if (!claude_is_available()) {
    message("Source scoring: ANTHROPIC_API_KEY not set, skipping.")
    return(playlists_df)
  }
  
  n <- nrow(playlists_df)
  message("Scoring ", n, " playlist sources with Claude...")
  
  system_prompt <- paste(
    "You are evaluating SoundCloud playlists for drum & bass (DNB) content quality.",
    "Score each playlist 0-100 based on how likely it is to contain high-quality DNB tracks.",
    "Consider: title relevance to DNB, track count (more = better curated),",
    "curator name, specificity of genre terms.",
    "A playlist called 'DNB Bootleg Bangers' with 200 tracks scores high.",
    "A playlist called 'My Favorites' with 10 tracks scores low.",
    "Respond with ONLY a valid JSON array. No markdown fences.",
    "Each element: {\"playlist_id\": \"string\", \"score\": number, \"reason\": \"brief string\"}"
  )
  
  lines <- paste0(
    seq_len(n), ". [id=", playlists_df$id, "] \"", playlists_df$title, "\"",
    " (", ifelse(is.na(playlists_df$track_count), "?", playlists_df$track_count), " tracks",
    ", by: ", ifelse(is.na(playlists_df$user) | !nzchar(playlists_df$user), "unknown", playlists_df$user), ")"
  )
  user_prompt <- paste0("Score these playlists for DNB quality:\n", paste(lines, collapse = "\n"))
  
  resp <- claude_call(system_prompt, user_prompt, max_tokens = 1500)
  parsed <- parse_claude_json(resp)
  
  if (!is.null(parsed) && is.data.frame(parsed) && nrow(parsed) > 0) {
    parsed$playlist_id <- as.character(parsed$playlist_id)
    m <- match(as.character(playlists_df$id), parsed$playlist_id)
    playlists_df$source_score  <- parsed$score[m]
    playlists_df$source_reason <- parsed$reason[m]
    
    # Log scores
    for (i in seq_len(n)) {
      sc <- playlists_df$source_score[i]
      re <- playlists_df$source_reason[i]
      if (!is.na(sc)) {
        message("  [", sc, "/100] ", playlists_df$title[i], " — ", re)
      }
    }
  } else {
    playlists_df$source_score  <- NA_real_
    playlists_df$source_reason <- NA_character_
  }
  
  playlists_df
}

# ---- Claude cost estimation ----
# Haiku 4.5: $1 / MTok input, $5 / MTok output
CLAUDE_COST_INPUT  <- 1.00 / 1e6  # per token
CLAUDE_COST_OUTPUT <- 5.00 / 1e6  # per token

#' Estimate Claude API costs for all enabled tasks.
#' Prints a formatted breakdown and total. Returns total cost (invisible).
#' @param n_tracks Number of tracks to classify/clean
#' @param track_ids Character vector of track IDs (for cache-aware counts)
#' @param n_playlists Number of playlists to score (0 if not applicable)
#' @param n_dedup_groups Number of fuzzy dedup candidate groups
claude_estimate_costs <- function(n_tracks = 0, track_ids = character(),
                                  n_playlists = 0, n_dedup_groups = 0) {
  if (!claude_is_available()) return(invisible(0))
  
  tasks <- list()
  
  # Source scoring
  if (isTRUE(CLAUDE_SCORE_SOURCES) && n_playlists > 0) {
    in_tok  <- 200 + n_playlists * 35
    out_tok <- n_playlists * 35
    tasks[["Source scoring"]] <- list(
      items = n_playlists, batches = 1,
      input = in_tok, output = out_tok
    )
  }
  
  # Genre classification
  if (isTRUE(CLAUDE_GENRE_CLASSIFY) && n_tracks > 0) {
    cache <- claude_cache_load()
    cached_ids <- cache$track_id[!is.na(cache$is_dnb)]
    n_cached <- if (length(track_ids)) sum(track_ids %in% cached_ids) else 0
    n_need <- n_tracks - n_cached
    n_batches <- ceiling(max(0, n_need) / CLAUDE_BATCH_SIZE)
    in_tok  <- n_batches * (200 + CLAUDE_BATCH_SIZE * 30)
    out_tok <- n_batches * (CLAUDE_BATCH_SIZE * 50)
    tasks[["Genre classification"]] <- list(
      items = n_need, batches = n_batches,
      input = in_tok, output = out_tok,
      cached = n_cached
    )
  }
  
  # Title cleaning
  if (isTRUE(CLAUDE_CLEAN_TITLES) && n_tracks > 0) {
    cache <- claude_cache_load()
    cached_ids <- cache$track_id[!is.na(cache$clean_title) & nzchar(cache$clean_title)]
    n_cached <- if (length(track_ids)) sum(track_ids %in% cached_ids) else 0
    n_need <- n_tracks - n_cached
    n_batches <- ceiling(max(0, n_need) / CLAUDE_BATCH_SIZE)
    in_tok  <- n_batches * (200 + CLAUDE_BATCH_SIZE * 30)
    out_tok <- n_batches * (CLAUDE_BATCH_SIZE * 30)
    tasks[["Title cleaning"]] <- list(
      items = n_need, batches = n_batches,
      input = in_tok, output = out_tok,
      cached = n_cached
    )
  }
  
  # Fuzzy dedup
  if (isTRUE(CLAUDE_FUZZY_DEDUP) && n_dedup_groups > 0) {
    n_group_batches <- ceiling(n_dedup_groups / 10)
    in_tok  <- n_group_batches * (200 + 10 * 3 * 35)
    out_tok <- n_group_batches * (10 * 40)
    tasks[["Fuzzy dedup"]] <- list(
      items = n_dedup_groups, batches = n_group_batches,
      input = in_tok, output = out_tok
    )
  }
  
  if (!length(tasks)) {
    message("Claude AI: all tasks cached or disabled, no API calls needed.")
    return(invisible(0))
  }
  
  total_in <- sum(sapply(tasks, `[[`, "input"))
  total_out <- sum(sapply(tasks, `[[`, "output"))
  total_cost <- total_in * CLAUDE_COST_INPUT + total_out * CLAUDE_COST_OUTPUT
  
  cat("\n================ CLAUDE API COST ESTIMATE ================\n")
  cat("Model: ", CLAUDE_MODEL, "\n")
  cat("Pricing: $1.00/MTok input, $5.00/MTok output\n\n")
  
  for (name in names(tasks)) {
    t <- tasks[[name]]
    cost <- t$input * CLAUDE_COST_INPUT + t$output * CLAUDE_COST_OUTPUT
    cached_note <- if (!is.null(t$cached) && t$cached > 0) {
      paste0(" (", t$cached, " cached, ", t$items, " new)")
    } else {
      paste0(" (", t$items, " items)")
    }
    cat(sprintf("  %-22s %3d batches  ~%6d in  ~%6d out  $%.4f%s\n",
                name, t$batches, t$input, t$output, cost, cached_note))
  }
  
  cat(sprintf("\n  %-22s             ~%6d in  ~%6d out  $%.4f\n",
              "TOTAL", total_in, total_out, total_cost))
  cat("==========================================================\n\n")
  
  invisible(total_cost)
}

#' Quick dedup-group count estimate for cost estimation.
#' Doesn't call Claude — just counts groups with matching normalized titles
#' from different uploaders.
count_fuzzy_dedup_candidates <- function(df) {
  normalize <- function(t) {
    t <- tolower(t)
    t <- gsub("\\[.*?\\]", "", t)
    t <- gsub("\\(.*?\\)", "", t)
    t <- gsub("[^a-z0-9 ]", "", t)
    t <- gsub("\\b(free|download|full|version|spotify|out now)\\b", "", t)
    t <- gsub("\\s+", " ", trimws(t))
    t
  }
  norm <- normalize(df$title)
  groups <- split(seq_len(nrow(df)), norm)
  sum(sapply(groups, function(idx) {
    length(idx) >= 2 && length(unique(df$username[idx])) >= 2
  }))
}

# ---- Genre filter ----
genre_filter <- function(df) {
  if (!"is_dnb" %in% names(df)) return(df)
  
  before <- nrow(df)
  has_class <- !is.na(df$is_dnb)
  is_dnb <- has_class & df$is_dnb == TRUE
  confident <- has_class & !is.na(df$genre_confidence) & df$genre_confidence >= GENRE_FILTER_MIN_CONFIDENCE
  
  # Keep if: confirmed DNB with sufficient confidence, OR unclassified (if configured)
  keep <- (is_dnb & confident) |
    (has_class & is_dnb & !confident) |  # DNB but low confidence: keep anyway
    (!has_class & isTRUE(GENRE_KEEP_UNCLASSIFIED))
  
  removed <- df[!keep, , drop = FALSE]
  df <- df[keep, , drop = FALSE]
  
  if (nrow(removed) > 0) {
    message("\nGenre filter: ", before, " -> ", nrow(df), " tracks (",
            nrow(removed), " removed)")
    for (j in seq_len(min(nrow(removed), 50))) {
      message("  REMOVED: ", removed$username[j] %||% "?", " - ",
              removed$title[j] %||% "?",
              " (genre=", removed$genre_alt[j] %||% "?",
              ", confidence=", round(removed$genre_confidence[j] %||% 0, 2), ")")
    }
    if (nrow(removed) > 50) message("  ... and ", nrow(removed) - 50, " more")
    
    removed_path <- file.path(REPORT_DIR,
                              paste0("genre_filtered_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".csv"))
    write.csv(removed, removed_path, row.names = FALSE)
    message("Wrote genre-filtered tracks: ", removed_path)
  } else {
    message("\nGenre filter: all ", nrow(df), " tracks passed.")
  }
  
  df
}

# ============================================================
# 7) Create playlists + robust 422-safe batch add
# ============================================================

sc_create_playlist <- function(title, description, sharing, access_token) {
  body <- list(playlist = list(title = title, description = description, sharing = sharing))
  res <- sc_req("POST", "/playlists", access_token, body = body)
  if (res$status >= 300) sc_stop_for_http(res, paste0("POST /playlists failed for: ", title))
  res$json
}

as_id_num <- function(x) suppressWarnings(as.numeric(x))

sc_put_playlist_tracks <- function(playlist_id, track_ids, access_token) {
  track_ids <- track_ids[!is.na(track_ids) & nzchar(track_ids) & grepl("^\\d+$", track_ids)]
  body <- list(
    playlist = list(
      tracks = lapply(track_ids, function(x) list(id = as_id_num(x)))
    )
  )
  sc_req("PUT", paste0("/playlists/", playlist_id), access_token, body = body)
}

find_invalid_in_subset <- function(playlist_id, known_good, subset_ids, access_token) {
  subset_ids <- subset_ids[!is.na(subset_ids) & nzchar(subset_ids)]
  if (!length(subset_ids)) return(character(0))
  
  res <- sc_put_playlist_tracks(playlist_id, c(known_good, subset_ids), access_token)
  if (res$status < 300) return(character(0))
  
  if (res$status != 422) sc_stop_for_http(res, paste0("PUT /playlists/", playlist_id, " failed (non-422)"))
  
  if (length(subset_ids) == 1) return(subset_ids)
  
  mid <- floor(length(subset_ids) / 2)
  left <- subset_ids[1:mid]
  right <- subset_ids[(mid + 1):length(subset_ids)]
  
  Sys.sleep(0.10)
  bad_left <- find_invalid_in_subset(playlist_id, known_good, left, access_token)
  Sys.sleep(0.10)
  bad_right <- find_invalid_in_subset(playlist_id, known_good, right, access_token)
  
  c(bad_left, bad_right)
}

sc_add_tracks_safe <- function(playlist_id, known_good, new_ids, access_token) {
  known_good <- unique(known_good[!is.na(known_good) & nzchar(known_good)])
  new_ids <- unique(new_ids[!is.na(new_ids) & nzchar(new_ids) & grepl("^\\d+$", new_ids)])
  new_ids <- setdiff(new_ids, known_good)
  combined <- c(known_good, new_ids)
  
  res <- sc_put_playlist_tracks(playlist_id, combined, access_token)
  if (res$status < 300) {
    return(list(ok_ids = combined, bad_ids = character(0)))
  }
  
  if (res$status != 422) sc_stop_for_http(res, paste0("PUT /playlists/", playlist_id, " failed"))
  
  message("Received 422. Isolating invalid tracks in the NEW batch (fast)...")
  bad <- unique(find_invalid_in_subset(playlist_id, known_good, new_ids, access_token))
  ok_new <- setdiff(new_ids, bad)
  ok_all <- c(known_good, ok_new)
  
  res2 <- sc_put_playlist_tracks(playlist_id, ok_all, access_token)
  if (res2$status >= 300) sc_stop_for_http(res2, "Final PUT with filtered tracks still failed")
  
  list(ok_ids = ok_all, bad_ids = bad)
}

# ============================================================
# 8) MAIN
# ============================================================

main <- function() {
  access_token <- sc_get_access_token()
  
  message("Resolving playlists...")
  my_pls <- sc_list_my_playlists(access_token)
  src_pls <- resolve_source_playlists(my_pls, access_token)
  
  # ---- Preview selected playlists ----
  prev <- playlist_preview_tbl(src_pls)
  preview_path <- file.path(REPORT_DIR, paste0("source_playlists_preview_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".csv"))
  write.csv(prev, preview_path, row.names = FALSE)
  
  message("\nSelected source playlists (", nrow(prev), "):")
  if (nrow(prev)) {
    prev_show <- prev[order(prev$title), c("id","title","user","track_count","sharing")]
    print(utils::head(prev_show, PREVIEW_PRINT_MAX))
  }
  message("Wrote preview CSV: ", preview_path)
  
  # ---- Score playlist sources with Claude ----
  if (isTRUE(CLAUDE_SCORE_SOURCES) && claude_is_available() && nrow(prev) > 0) {
    claude_estimate_costs(n_playlists = nrow(prev))
    prev <- claude_score_sources(prev)
    # Re-write preview with scores
    write.csv(prev, preview_path, row.names = FALSE)
    
    # Sort src_pls by source score (highest first) so better playlists are fetched first
    if ("source_score" %in% names(prev) && any(!is.na(prev$source_score))) {
      score_order <- order(prev$source_score, decreasing = TRUE, na.last = TRUE)
      prev <- prev[score_order, , drop = FALSE]
      # Reorder src_pls to match
      id_order <- as.character(prev$id)
      src_pls <- src_pls[match(id_order, sapply(src_pls, function(p) as.character(p$id)))]
      src_pls <- src_pls[!sapply(src_pls, is.null)]
    }
  }
  
  if (isTRUE(PREVIEW_SOURCES_ONLY)) {
    message("\nPREVIEW_SOURCES_ONLY=TRUE so stopping here (no tracks fetched).")
    message("Set PREVIEW_SOURCES_ONLY <- FALSE to proceed.")
    return(invisible(prev))
  }
  
  # ---- Fetch tracks ----
  message("\nFetching tracks from each playlist...")
  all_rows <- list()
  bad_playlists <- list()
  
  for (pl in src_pls) {
    pid <- as.character(pl$id)
    ptitle <- as.character(pl$title %||% pid)
    message(" - ", ptitle)
    
    tr <- sc_get_playlist_tracks_safe(pid, access_token)
    if (!length(tr)) {
      bad_playlists[[length(bad_playlists) + 1]] <- data.frame(id = pid, title = ptitle, stringsAsFactors = FALSE)
      next
    }
    
    rows <- lapply(tr, track_to_row, src_playlist_id = pid, src_playlist_title = ptitle)
    all_rows <- c(all_rows, rows)
  }
  
  if (!length(all_rows)) stop("No tracks found across source playlists.", call. = FALSE)
  
  df <- do.call(rbind, all_rows)
  n_tracks_pulled <- nrow(df)
  n_src_used <- length(src_pls)
  
  message("Collected ", n_tracks_pulled, " rows (pre-dedup).")
  
  df <- fill_missing_track_metrics(df, access_token)
  df <- compute_score_cols(df)
  
  # Sort FIRST, then dedup — so the highest-scoring duplicate is kept
  df <- order_by_score(df)
  
  key <- ifelse(!is.na(df$track_urn) & nzchar(df$track_urn),
                paste0("urn:", df$track_urn),
                paste0("id:", df$track_id))
  
  df2 <- df[!duplicated(key), , drop = FALSE]
  n_unique <- nrow(df2)
  
  message("After dedup: ", n_unique, " unique tracks.")
  
  # Filter likely-unaddable access values (helps reduce 422 frequency)
  bad_access <- c("blocked", "preview", "no_rights", "snipped", "unknown")
  if ("access" %in% names(df2)) {
    before <- nrow(df2)
    df2 <- df2[is.na(df2$access) | !(tolower(df2$access) %in% bad_access), , drop = FALSE]
    message("Filtered likely-unaddable tracks by access: ", before, " -> ", nrow(df2))
  }
  
  df2 <- compute_score_cols(df2)
  df2 <- order_by_score(df2)
  
  # ---- Claude AI: cost estimate for track-level tasks ----
  any_claude_track_task <- isTRUE(CLAUDE_GENRE_CLASSIFY) || isTRUE(CLAUDE_CLEAN_TITLES) || isTRUE(CLAUDE_FUZZY_DEDUP)
  if (any_claude_track_task && claude_is_available()) {
    n_dedup_cands <- if (isTRUE(CLAUDE_FUZZY_DEDUP)) count_fuzzy_dedup_candidates(df2) else 0
    claude_estimate_costs(
      n_tracks = nrow(df2),
      track_ids = as.character(df2$track_id),
      n_dedup_groups = n_dedup_cands
    )
  }
  
  # ---- Claude AI: genre classification ----
  if (isTRUE(CLAUDE_GENRE_CLASSIFY)) {
    df2 <- claude_classify_genres(df2)
  }
  
  # ---- Claude AI: genre filter (remove non-DNB before BPM to save compute) ----
  if (isTRUE(CLAUDE_GENRE_CLASSIFY) && isTRUE(GENRE_FILTER_ENABLED)) {
    df2 <- genre_filter(df2)
  }
  
  # ---- Claude AI: title cleaning ----
  if (isTRUE(CLAUDE_CLEAN_TITLES)) {
    df2 <- claude_clean_titles(df2)
  }
  
  # ---- Claude AI: fuzzy duplicate detection ----
  if (isTRUE(CLAUDE_FUZZY_DEDUP)) {
    df2 <- claude_fuzzy_dedup(df2)
  }
  
  # ---- Fill BPMs + save tracks for all deduped tracks ----
  if (isTRUE(COMPUTE_BPM) || isTRUE(SAVE_TRACKS)) {
    if (isTRUE(COMPUTE_BPM)) {
      if (check_librosa()) {
        message("librosa found: ", LIBROSA_PYTHON)
      } else {
        message("WARNING: librosa not available at ", LIBROSA_PYTHON)
      }
      if (!is.na(BPM_RANGE_MIN) && !is.na(BPM_RANGE_MAX)) {
        message("BPM range: ", BPM_RANGE_MIN, "-", BPM_RANGE_MAX,
                " (start_bpm=", (BPM_RANGE_MIN + BPM_RANGE_MAX) / 2, ")")
      }
    }
    if (identical(DOWNLOAD_METHOD, "yt-dlp")) {
      if (ytdlp_is_available()) {
        message("yt-dlp found: ", Sys.which(YTDLP_BIN), " (full track download)")
      } else {
        message("WARNING: yt-dlp not found. Will fall back to API previews (~30s).")
      }
    }
    if (isTRUE(SAVE_TRACKS)) {
      message("Saving tracks to: ", TRACKS_DIR)
    }
    df2 <- fill_missing_bpms(df2, access_token)
  }
  
  manifest_path <- file.path(REPORT_DIR, paste0("manifest_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".csv"))
  write.csv(df2, manifest_path, row.names = FALSE)
  message("Wrote manifest: ", manifest_path)
  
  # ---- BPM filter: remove non-genre tracks ----
  if (!is.na(BPM_FILTER_MIN) && !is.na(BPM_FILTER_MAX) && "bpm" %in% names(df2)) {
    before_filter <- nrow(df2)
    has_bpm <- !is.na(df2$bpm)
    in_range <- has_bpm & df2$bpm >= BPM_FILTER_MIN & df2$bpm <= BPM_FILTER_MAX
    keep <- if (isTRUE(BPM_KEEP_NA)) (in_range | !has_bpm) else in_range
    
    removed <- df2[!keep, , drop = FALSE]
    df2 <- df2[keep, , drop = FALSE]
    
    if (nrow(removed) > 0) {
      message("\nBPM filter [", BPM_FILTER_MIN, "-", BPM_FILTER_MAX, "]: ",
              before_filter, " -> ", nrow(df2), " tracks (",
              nrow(removed), " removed)")
      for (j in seq_len(nrow(removed))) {
        message("  REMOVED: ", removed$username[j] %||% "?", " - ",
                removed$title[j] %||% "?", " (bpm=", removed$bpm[j], ")")
      }
      
      # Write filtered-out tracks to a separate CSV for review
      removed_path <- file.path(REPORT_DIR,
                                paste0("bpm_filtered_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".csv"))
      write.csv(removed, removed_path, row.names = FALSE)
      message("Wrote filtered tracks: ", removed_path)
    } else {
      message("\nBPM filter [", BPM_FILTER_MIN, "-", BPM_FILTER_MAX, "]: all ",
              nrow(df2), " tracks passed.")
    }
  }
  
  # ---- Retain only top N tracks (after BPM filter) ----
  if (!is.na(MAX_TRACKS_TO_RETAIN) && is.finite(MAX_TRACKS_TO_RETAIN) && MAX_TRACKS_TO_RETAIN > 0) {
    before <- nrow(df2)
    if (before > MAX_TRACKS_TO_RETAIN) {
      df2 <- df2[seq_len(MAX_TRACKS_TO_RETAIN), , drop = FALSE]
      message("Applied MAX_TRACKS_TO_RETAIN: ", before, " -> ", nrow(df2))
    }
  }
  
  if (length(bad_playlists)) {
    bad_pl_path <- file.path(REPORT_DIR, paste0("bad_playlists_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".csv"))
    write.csv(do.call(rbind, bad_playlists), bad_pl_path, row.names = FALSE)
    message("Wrote bad playlists list: ", bad_pl_path)
  }
  
  if (isTRUE(DRY_RUN)) {
    message("\nDRY_RUN=TRUE, skipping playlist creation.")
    return(invisible(df2))
  }
  
  # ---- Create output playlists, fill-forward to 500 valid tracks each ----
  n_total <- nrow(df2)
  message("\nCreating playlists of ", MAX_PER_PLAYLIST, " VALID tracks each (until exhausted).")
  
  global_bad_ids <- character(0)
  global_added_ids <- character(0)
  
  pool <- character(0)
  idx <- 1L
  part_num <- 0L
  created <- list()
  
  POOL_CHUNK <- 800L
  
  push_pool <- function() {
    if (idx > n_total) return(invisible(NULL))
    end <- min(n_total, idx + POOL_CHUNK - 1L)
    take_rows <- df2[idx:end, , drop = FALSE]
    idx <<- end + 1L
    
    new_ids <- take_rows$track_id
    new_ids <- new_ids[!is.na(new_ids) & nzchar(new_ids)]
    new_ids <- new_ids[grepl("^\\d+$", new_ids)]
    new_ids <- unique(new_ids)
    
    new_ids <- setdiff(new_ids, c(global_bad_ids, global_added_ids, pool))
    pool <<- c(pool, new_ids)
    invisible(NULL)
  }
  
  while (idx <= n_total || length(pool) > 0) {
    part_num <- part_num + 1L
    part_title <- sprintf("%s \u2014 Part %02d", OUT_BASE_TITLE, part_num)
    
    message("\nCreating: ", part_title, " (target ", MAX_PER_PLAYLIST, " tracks)")
    pl_new <- sc_create_playlist(part_title, OUT_DESCRIPTION, OUT_SHARING, access_token)
    playlist_id <- as.character(pl_new$id)
    
    added_ids <- character(0)
    skipped_ids <- character(0)
    rounds <- 0L
    
    while (length(added_ids) < MAX_PER_PLAYLIST) {
      rounds <- rounds + 1L
      if (rounds > 300L) stop("Safety stop: too many fill rounds; possible looping.", call. = FALSE)
      
      need <- MAX_PER_PLAYLIST - length(added_ids)
      
      while (length(pool) < need && idx <= n_total) push_pool()
      if (length(pool) == 0) break
      
      candidates <- head(pool, need)
      pool <- pool[-seq_len(length(candidates))]
      
      candidates <- setdiff(unique(candidates), c(global_bad_ids, global_added_ids, added_ids))
      if (!length(candidates)) next
      
      res <- sc_add_tracks_safe(
        playlist_id = playlist_id,
        known_good = added_ids,
        new_ids = candidates,
        access_token = access_token
      )
      
      newly_bad <- setdiff(c(added_ids, candidates), res$ok_ids)
      if (length(newly_bad)) {
        skipped_ids <- unique(c(skipped_ids, newly_bad))
        global_bad_ids <- unique(c(global_bad_ids, newly_bad))
      }
      
      added_ids <- res$ok_ids
      global_added_ids <- unique(c(global_added_ids, added_ids))
      
      message("  Filled: ", length(added_ids), "/", MAX_PER_PLAYLIST,
              " | skipped (this part): ", length(skipped_ids),
              " | global_bad: ", length(global_bad_ids),
              " | remaining pool: ", length(pool),
              " | idx: ", idx, "/", n_total)
      
      Sys.sleep(0.15)
      
      if (idx > n_total && length(pool) == 0 && length(added_ids) < MAX_PER_PLAYLIST) break
    }
    
    rep_path <- file.path(REPORT_DIR, sprintf("skipped_part_%02d.csv", part_num))
    write.csv(data.frame(track_id = skipped_ids), rep_path, row.names = FALSE)
    message("Wrote skipped-track report: ", rep_path)
    
    created[[length(created) + 1]] <- data.frame(
      id = playlist_id,
      title = part_title,
      n_added = length(added_ids),
      n_skipped = length(skipped_ids),
      stringsAsFactors = FALSE
    )
    
    message("Playlist created id=", playlist_id,
            " | added=", length(added_ids),
            " | skipped=", length(skipped_ids))
    
    if (length(added_ids) == 0 && idx > n_total && length(pool) == 0) break
    Sys.sleep(0.25)
  }
  
  out_created <- NULL
  if (length(created)) {
    out_created <- do.call(rbind, created)
    summary_path <- file.path(REPORT_DIR, paste0("created_playlists_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".csv"))
    write.csv(out_created, summary_path, row.names = FALSE)
    message("\nDone. Wrote creation summary: ", summary_path)
    print(out_created)
  }
  
  skipped_all_path <- file.path(REPORT_DIR, paste0("skipped_all_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".csv"))
  write.csv(data.frame(track_id = unique(global_bad_ids)), skipped_all_path, row.names = FALSE)
  message("Wrote skipped-all report: ", skipped_all_path)
  
  # ---- FINAL SUMMARY ----
  n_skipped_unique <- length(unique(global_bad_ids))
  n_added_unique   <- length(unique(global_added_ids))
  denom <- n_added_unique + n_skipped_unique
  pct_skipped <- if (denom > 0) round(100 * n_skipped_unique / denom, 2) else NA_real_
  
  cat("\n==================== FINAL SUMMARY ====================\n")
  cat("Source playlists used:        ", n_src_used, "\n", sep = "")
  cat("Total tracks pulled:          ", n_tracks_pulled, "\n", sep = "")
  cat("Unique tracks after dedup:    ", n_unique, "\n", sep = "")
  if ("is_dnb" %in% names(df2)) {
    cat("Claude genre: DNB=", sum(df2$is_dnb == TRUE, na.rm = TRUE),
        " non-DNB=", sum(df2$is_dnb == FALSE, na.rm = TRUE),
        " unclassified=", sum(is.na(df2$is_dnb)), "\n", sep = "")
  }
  if ("subgenre" %in% names(df2)) {
    subs <- table(df2$subgenre[!is.na(df2$subgenre)])
    if (length(subs)) cat("Top subgenres:                ", paste(names(sort(subs, decreasing = TRUE))[1:min(5, length(subs))], collapse = ", "), "\n", sep = "")
  }
  if ("clean_title" %in% names(df2)) {
    n_cleaned <- sum(df2$clean_title != df2$title, na.rm = TRUE)
    cat("Titles cleaned:               ", n_cleaned, "\n", sep = "")
  }
  cat("Unique tracks skipped (422):  ", n_skipped_unique, "\n", sep = "")
  cat("Percent skipped (422):        ", if (!is.na(pct_skipped)) paste0(pct_skipped, "%") else "NA", "\n", sep = "")
  if (!is.null(out_created)) {
    cat("Output playlists created:     ", nrow(out_created), "\n", sep = "")
    cat("Total tracks added (sum):     ", sum(out_created$n_added), "\n", sep = "")
  }
  cat("Manifest written:             ", manifest_path, "\n", sep = "")
  cat("=======================================================\n\n")
  
  invisible(list(
    created = out_created,
    manifest_path = manifest_path,
    skipped_all_path = skipped_all_path,
    preview_path = preview_path
  ))
}

# ============================================================
# RUN
# ============================================================
main()