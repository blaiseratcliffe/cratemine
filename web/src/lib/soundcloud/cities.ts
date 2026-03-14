/**
 * Hybrid city normalizer for SoundCloud user profiles.
 *
 * Strategy:
 * 1. Split messy strings by / and , into segments
 * 2. Clean each segment (strip country codes, parentheticals)
 * 3. Check aliases map for known corrections (NYC → New York)
 * 4. Skip segments that are country names
 * 5. Reject segments that look like slogans/garbage (blocklist words)
 * 6. Accept the first segment that passes all checks
 * 7. Fall back to "Unknown"
 */

/** Common aliases and abbreviations → canonical city name */
const CITY_ALIASES = new Map<string, string>([
  ["nyc", "New York"],
  ["ny", "New York"],
  ["la", "Los Angeles"],
  ["sf", "San Francisco"],
  ["dc", "Washington"],
  ["philly", "Philadelphia"],
  ["nola", "New Orleans"],
  ["bk", "Brooklyn"],
  ["bklyn", "Brooklyn"],
  ["ldn", "London"],
  ["mcr", "Manchester"],
  ["bris", "Bristol"],
  ["brizzle", "Bristol"],
  ["ams", "Amsterdam"],
  ["cph", "Copenhagen"],
  ["sthlm", "Stockholm"],
  ["hk", "Hong Kong"],
  ["melb", "Melbourne"],
  ["syd", "Sydney"],
  ["bne", "Brisbane"],
  ["akl", "Auckland"],
  ["welly", "Wellington"],
  ["muc", "Munich"],
  ["ffm", "Frankfurt"],
  ["bcn", "Barcelona"],
  ["cdmx", "Mexico City"],
  ["sp", "São Paulo"],
  ["rj", "Rio De Janeiro"],
  ["ist", "Istanbul"],
]);

/** Country names/codes — skip these as they're not cities */
const COUNTRIES = new Set([
  "uk", "united kingdom", "us", "usa", "united states", "america",
  "canada", "australia", "new zealand", "nz", "germany", "deutschland",
  "france", "netherlands", "holland", "belgium", "spain", "espana",
  "italy", "italia", "portugal", "ireland", "sweden", "norge",
  "norway", "denmark", "finland", "austria", "switzerland",
  "poland", "czech republic", "czechia", "hungary", "romania",
  "japan", "south korea", "korea", "china", "india", "brazil",
  "brasil", "mexico", "argentina", "south africa", "egypt",
  "nigeria", "kenya", "thailand", "indonesia", "malaysia",
  "singapore", "philippines", "vietnam", "russia", "ukraine",
  "turkey", "greece", "croatia", "serbia", "bulgaria",
  "scotland", "wales", "england", "worldwide", "global", "earth",
  "europe", "asia", "africa", "international",
]);

/**
 * Words/phrases that indicate the string is NOT a city.
 * Matched against lowercase segments.
 */
const GARBAGE_PATTERNS = [
  // Slogans / vibes
  "the jungle", "the rave", "the bass", "the underground", "the void",
  "the matrix", "the lab", "the studio", "the streets",
  "my home", "my house", "my room", "my mind", "my world",
  "your mom", "your mum",
  "nowhere", "everywhere", "somewhere", "anywhere",
  "outer space", "the moon", "the internet", "the cloud",
  "planet earth", "mother earth",
  // Music terms
  "born on road", "run tingz", "deep in the",
  "bass music", "drum and bass", "dubstep", "jungle music",
  "rave culture", "sound system", "dj booth",
  // Generic nonsense
  "home is", "is the", "is my", "in the",
  "follow me", "book me", "hire me", "contact",
  "independent", "unsigned", "producer", "artist",
  "beats", "records", "recordings", "music",
];

/**
 * Normalize a SoundCloud user's city string to a clean city name.
 *
 * Examples:
 * - "Run Tingz / Born On Road / Bristol" → "Bristol"
 * - "Cambridge/Uk" → "Cambridge"
 * - "Liverpool / London" → "Liverpool" (first valid)
 * - "The Jungle" → "Unknown"
 * - "My Home Is The Rave" → "Unknown"
 * - "Berlin, Germany" → "Berlin"
 * - "Edmonton AB" → "Edmonton"
 * - "NYC" → "New York"
 * - null → "Unknown"
 */
export function normalizeCity(raw: string | null): string {
  if (!raw || !raw.trim()) return "Unknown";

  // Split by / and , to get candidate segments
  const segments = raw
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const result = classifySegment(segment);
    if (result) return result;
  }

  return "Unknown";
}

/**
 * Classify a single segment: returns a clean city name or null if garbage.
 */
function classifySegment(segment: string): string | null {
  const cleaned = cleanSegment(segment);
  if (!cleaned || cleaned.length < 2) return null;

  const lower = cleaned.toLowerCase();

  // Check aliases first (NYC → New York)
  const alias = CITY_ALIASES.get(lower);
  if (alias) return alias;

  // Skip country names
  if (COUNTRIES.has(lower)) return null;

  // Reject garbage patterns
  for (const pattern of GARBAGE_PATTERNS) {
    if (lower.includes(pattern)) return null;
  }

  // Reject if it's too long (>40 chars) — probably a slogan
  if (cleaned.length > 40) return null;

  // Reject if it has too many words (>4) — probably a phrase, not a city
  const words = cleaned.split(/\s+/);
  if (words.length > 4) return null;

  // Reject if all lowercase and single word under 3 chars (likely an abbreviation we don't know)
  if (words.length === 1 && cleaned.length <= 2 && cleaned === cleaned.toLowerCase()) {
    return null;
  }

  // Reject strings that are all numbers or contain @ / # / emoji
  if (/^\d+$/.test(cleaned) || /[@#]/.test(cleaned) || /[\u{1F000}-\u{1FFFF}]/u.test(cleaned)) {
    return null;
  }

  // Passes all checks — treat as a city name
  return titleCase(cleaned);
}

/** Clean a single segment: strip trailing country codes, trim whitespace */
function cleanSegment(s: string): string {
  let cleaned = s.trim();
  if (!cleaned) return "";

  // Strip trailing 2-3 letter country/state codes: "Edmonton AB" → "Edmonton"
  // But don't strip if the whole string IS the 2-3 letter code (handled by aliases)
  if (cleaned.split(/\s+/).length > 1) {
    cleaned = cleaned.replace(/\s+[A-Za-z]{2,3}$/, "").trim();
  }

  // Strip parenthetical suffixes: "Bristol (UK)" → "Bristol"
  cleaned = cleaned.replace(/\s*\(.*?\)\s*$/, "").trim();

  return cleaned;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
