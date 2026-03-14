/**
 * Hybrid city normalizer for SoundCloud user profiles.
 *
 * Strategy:
 * 1. Split messy strings by / and , into segments
 * 2. Clean each segment (strip country codes, parentheticals)
 * 3. Strip accents for consistent matching
 * 4. Check aliases map for corrections (NYC → New York, Köln → Cologne)
 * 5. Check neighborhood → parent city map (South London → London)
 * 6. Skip segments that are country names
 * 7. Reject segments that look like slogans/garbage (blocklist words)
 * 8. Validate against GeoNames top 10K cities database
 * 9. Accept the first segment that passes all checks
 * 10. Fall back to "Unknown"
 */

import { GEONAMES_CITIES } from "./city-data";

/**
 * Strip diacritics/accents: São → Sao, Zürich → Zurich, Malmö → Malmo
 */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Common aliases, abbreviations, and cross-language synonyms → canonical name.
 * Keys are lowercase and accent-stripped.
 */
const CITY_ALIASES = new Map<string, string>([
  // English abbreviations
  ["nyc", "New York"],
  ["ny", "New York"],
  ["la", "Los Angeles"],
  ["sf", "San Francisco"],
  ["dc", "Washington"],
  ["philly", "Philadelphia"],
  ["nola", "New Orleans"],
  ["chi", "Chicago"],
  ["atl", "Atlanta"],
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
  ["ist", "Istanbul"],

  // St / Saint variants
  ["st petersburg", "Saint Petersburg"],
  ["st. petersburg", "Saint Petersburg"],
  ["saint petersburg", "Saint Petersburg"],
  ["st louis", "Saint Louis"],
  ["st. louis", "Saint Louis"],
  ["saint louis", "Saint Louis"],
  ["st paul", "Saint Paul"],
  ["st. paul", "Saint Paul"],
  ["saint paul", "Saint Paul"],

  // Cross-language city names
  ["koln", "Cologne"],          // Köln → Cologne (accent-stripped key)
  ["cologne", "Cologne"],
  ["munchen", "Munich"],        // München → Munich
  ["munich", "Munich"],
  ["wien", "Vienna"],
  ["vienna", "Vienna"],
  ["zurich", "Zurich"],         // Zürich → Zurich
  ["geneve", "Geneva"],         // Genève → Geneva
  ["geneva", "Geneva"],
  ["kobenhavn", "Copenhagen"],  // København → Copenhagen
  ["copenhagen", "Copenhagen"],
  ["goteborg", "Gothenburg"],   // Göteborg → Gothenburg
  ["gothenburg", "Gothenburg"],
  ["malmo", "Malmö"],           // Malmö stays as Malmö
  ["moskva", "Moscow"],
  ["moscow", "Moscow"],
  ["roma", "Rome"],
  ["rome", "Rome"],
  ["milano", "Milan"],
  ["milan", "Milan"],
  ["napoli", "Naples"],
  ["naples", "Naples"],
  ["firenze", "Florence"],
  ["florence", "Florence"],
  ["venezia", "Venice"],
  ["venice", "Venice"],
  ["torino", "Turin"],
  ["turin", "Turin"],
  ["lisboa", "Lisbon"],
  ["lisbon", "Lisbon"],
  ["warszawa", "Warsaw"],
  ["warsaw", "Warsaw"],
  ["praha", "Prague"],
  ["prague", "Prague"],
  ["athina", "Athens"],
  ["athens", "Athens"],
  ["bukarest", "Bucharest"],
  ["bucharest", "Bucharest"],
  ["den haag", "The Hague"],
  ["the hague", "The Hague"],
  ["sao paulo", "São Paulo"],
  ["rio de janeiro", "Rio De Janeiro"],

  // Brooklyn abbreviations
  ["bk", "Brooklyn"],
  ["bklyn", "Brooklyn"],

  // São Paulo / Rio abbreviations
  ["sp", "São Paulo"],
  ["rj", "Rio De Janeiro"],
]);

/**
 * Neighborhood / district → parent city mapping.
 * Keys are lowercase and accent-stripped.
 */
const NEIGHBORHOOD_TO_CITY = new Map<string, string>([
  // London
  ["south london", "London"],
  ["north london", "London"],
  ["east london", "London"],
  ["west london", "London"],
  ["central london", "London"],
  ["south east london", "London"],
  ["south west london", "London"],
  ["north east london", "London"],
  ["north west london", "London"],
  ["hackney", "London"],
  ["brixton", "London"],
  ["camden", "London"],
  ["shoreditch", "London"],
  ["dalston", "London"],
  ["peckham", "London"],
  ["lewisham", "London"],
  ["croydon", "London"],
  ["tottenham", "London"],
  ["stratford", "London"],
  ["woolwich", "London"],
  ["deptford", "London"],
  ["bermondsey", "London"],
  ["islington", "London"],
  ["soho", "London"],

  // New York
  ["brooklyn", "New York"],
  ["manhattan", "New York"],
  ["queens", "New York"],
  ["bronx", "New York"],
  ["the bronx", "New York"],
  ["staten island", "New York"],
  ["harlem", "New York"],
  ["bushwick", "New York"],
  ["williamsburg", "New York"],
  ["bed stuy", "New York"],
  ["bed-stuy", "New York"],

  // Los Angeles
  ["hollywood", "Los Angeles"],
  ["silver lake", "Los Angeles"],
  ["echo park", "Los Angeles"],
  ["downtown la", "Los Angeles"],
  ["dtla", "Los Angeles"],
  ["south la", "Los Angeles"],
  ["east la", "Los Angeles"],
  ["west la", "Los Angeles"],
  ["koreatown", "Los Angeles"],
  ["venice beach", "Los Angeles"],

  // Paris
  ["montmartre", "Paris"],
  ["belleville", "Paris"],
  ["pigalle", "Paris"],

  // Berlin
  ["kreuzberg", "Berlin"],
  ["neukolln", "Berlin"],   // Neukölln
  ["friedrichshain", "Berlin"],
  ["prenzlauer berg", "Berlin"],
  ["mitte", "Berlin"],

  // Manchester
  ["salford", "Manchester"],
  ["hulme", "Manchester"],
  ["moss side", "Manchester"],

  // Bristol
  ["stokes croft", "Bristol"],
  ["st pauls", "Bristol"],
  ["st. pauls", "Bristol"],
  ["easton", "Bristol"],
  ["montpelier", "Bristol"],

  // Tokyo
  ["shibuya", "Tokyo"],
  ["shinjuku", "Tokyo"],
  ["harajuku", "Tokyo"],
  ["roppongi", "Tokyo"],
  ["akihabara", "Tokyo"],
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
 * - "Köln" → "Cologne"
 * - "South London" → "London"
 * - "São Paulo" and "Sao Paulo" → "São Paulo"
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
  const stripped = stripAccents(lower);

  // Check aliases first (NYC → New York, Köln → Cologne)
  const alias = CITY_ALIASES.get(stripped) || CITY_ALIASES.get(lower);
  if (alias) return alias;

  // Check neighborhood → parent city (South London → London)
  const neighborhood = NEIGHBORHOOD_TO_CITY.get(stripped) || NEIGHBORHOOD_TO_CITY.get(lower);
  if (neighborhood) return neighborhood;

  // Skip country names
  if (COUNTRIES.has(stripped) || COUNTRIES.has(lower)) return null;

  // Reject garbage patterns
  for (const pattern of GARBAGE_PATTERNS) {
    if (lower.includes(pattern) || stripped.includes(pattern)) return null;
  }

  // Validate against GeoNames top 10K cities (exact match on accent-stripped lowercase)
  if (GEONAMES_CITIES.has(stripped)) {
    return titleCase(cleaned);
  }

  // Also try prefix matching: "Bristol UK" → check "bristol"
  const words = cleaned.split(/\s+/);
  for (let len = words.length - 1; len >= 1; len--) {
    const prefix = stripAccents(words.slice(0, len).join(" ").toLowerCase());
    if (GEONAMES_CITIES.has(prefix)) {
      return titleCase(words.slice(0, len).join(" "));
    }
  }

  // Not in the database — reject as Unknown
  return null;
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
