/**
 * Known major cities for matching SoundCloud user city strings.
 * This is a broad list — add more as needed.
 */
const KNOWN_CITIES = new Set([
  "london", "bristol", "manchester", "birmingham", "leeds", "liverpool",
  "glasgow", "edinburgh", "cardiff", "brighton", "nottingham", "sheffield",
  "newcastle", "belfast", "cambridge", "oxford", "bath", "exeter", "york",
  "southampton", "portsmouth", "coventry", "leicester", "bradford", "hull",
  "stoke", "reading", "norwich", "derby", "plymouth", "aberdeen", "dundee",
  "swansea", "bournemouth", "colchester", "croydon", "luton", "swindon",
  "new york", "los angeles", "chicago", "houston", "phoenix", "philadelphia",
  "san antonio", "san diego", "dallas", "san jose", "austin", "jacksonville",
  "fort worth", "columbus", "charlotte", "san francisco", "indianapolis",
  "seattle", "denver", "washington", "nashville", "oklahoma city", "portland",
  "las vegas", "memphis", "louisville", "baltimore", "milwaukee", "albuquerque",
  "tucson", "fresno", "sacramento", "mesa", "kansas city", "atlanta", "miami",
  "oakland", "minneapolis", "tulsa", "cleveland", "detroit", "boston",
  "new orleans", "pittsburgh", "st louis", "cincinnati", "orlando",
  "tampa", "raleigh", "richmond", "salt lake city",
  "toronto", "vancouver", "montreal", "calgary", "edmonton", "ottawa",
  "winnipeg", "quebec city", "hamilton", "halifax", "victoria",
  "berlin", "hamburg", "munich", "cologne", "frankfurt", "dusseldorf",
  "leipzig", "dortmund", "essen", "bremen", "dresden", "hannover", "stuttgart",
  "paris", "marseille", "lyon", "toulouse", "nice", "nantes", "bordeaux",
  "lille", "strasbourg", "rennes",
  "amsterdam", "rotterdam", "the hague", "utrecht", "eindhoven",
  "brussels", "antwerp", "ghent",
  "vienna", "zurich", "geneva", "basel", "bern",
  "prague", "warsaw", "budapest", "bucharest", "sofia", "belgrade",
  "athens", "lisbon", "porto", "madrid", "barcelona", "valencia", "seville",
  "rome", "milan", "naples", "turin", "florence", "venice", "bologna",
  "dublin", "cork", "galway",
  "stockholm", "gothenburg", "copenhagen", "oslo", "helsinki",
  "moscow", "st petersburg", "kyiv",
  "istanbul", "cairo", "johannesburg", "cape town", "lagos", "nairobi",
  "tokyo", "osaka", "seoul", "beijing", "shanghai", "hong kong", "singapore",
  "taipei", "bangkok", "hanoi", "jakarta", "kuala lumpur", "manila",
  "mumbai", "delhi", "bangalore", "chennai", "kolkata", "hyderabad",
  "sydney", "melbourne", "brisbane", "perth", "adelaide", "auckland",
  "wellington", "christchurch",
  "mexico city", "guadalajara", "monterrey", "sao paulo", "rio de janeiro",
  "bogota", "lima", "santiago", "buenos aires",
  "dubai", "abu dhabi", "riyadh", "tel aviv", "beirut",
]);

/**
 * Known country names and codes for filtering out country-only entries.
 */
const KNOWN_COUNTRIES = new Set([
  "uk", "united kingdom", "us", "usa", "united states", "canada",
  "australia", "new zealand", "germany", "france", "netherlands",
  "belgium", "spain", "italy", "portugal", "ireland", "sweden",
  "norway", "denmark", "finland", "austria", "switzerland",
  "poland", "czech republic", "hungary", "romania", "japan",
  "south korea", "china", "india", "brazil", "mexico", "argentina",
  "south africa", "egypt", "nigeria", "kenya", "thailand",
  "indonesia", "malaysia", "singapore", "philippines", "vietnam",
  "russia", "ukraine", "turkey", "greece", "croatia", "serbia",
  "bulgaria", "scotland", "wales", "england",
]);

/**
 * Normalize a SoundCloud user's city string to a clean city name.
 *
 * Handles:
 * - "Run Tingz / Born On Road / Bristol" → "Bristol"
 * - "Cambridge/Uk" → "Cambridge"
 * - "Liverpool / London" → "Liverpool" (take first)
 * - "The Jungle" → "Unknown"
 * - "My Home Is The Rave" → "Unknown"
 * - "Berlin, Germany" → "Berlin"
 * - "Edmonton AB" → "Edmonton"
 * - null → "Unknown"
 */
export function normalizeCity(raw: string | null): string {
  if (!raw || !raw.trim()) return "Unknown";

  // Split by / and , to get candidate segments
  const segments = raw
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Try each segment: look for a known city
  for (const segment of segments) {
    const cleaned = cleanSegment(segment);
    if (!cleaned) continue;

    const lower = cleaned.toLowerCase();

    // Skip if it's just a country name
    if (KNOWN_COUNTRIES.has(lower)) continue;

    // Direct match against known cities
    if (KNOWN_CITIES.has(lower)) {
      return titleCase(cleaned);
    }
  }

  // Second pass: try prefix matching (e.g. "Bristol UK" → "Bristol")
  for (const segment of segments) {
    const cleaned = cleanSegment(segment);
    if (!cleaned) continue;

    const words = cleaned.split(/\s+/);
    // Try progressively shorter prefixes
    for (let len = words.length; len >= 1; len--) {
      const candidate = words.slice(0, len).join(" ").toLowerCase();
      if (KNOWN_CITIES.has(candidate)) {
        return titleCase(candidate);
      }
    }
  }

  // Third pass: fuzzy check - does any segment look like a real place name?
  // (short, capitalized, no special chars — heuristic)
  for (const segment of segments) {
    const cleaned = cleanSegment(segment);
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (KNOWN_COUNTRIES.has(lower)) continue;

    // If it's 1-3 words, starts with uppercase, and doesn't look like a slogan
    const words = cleaned.split(/\s+/);
    if (
      words.length <= 3 &&
      words.length >= 1 &&
      /^[A-Z]/.test(cleaned) &&
      !lower.includes("the ") &&
      !lower.includes("my ") &&
      !lower.includes("is ") &&
      cleaned.length <= 30
    ) {
      return titleCase(cleaned);
    }
  }

  return "Unknown";
}

/** Clean a single segment: strip trailing country codes, trim whitespace */
function cleanSegment(s: string): string {
  let cleaned = s.trim();
  if (!cleaned) return "";

  // Strip trailing 2-3 letter country/state codes: "Edmonton AB" → "Edmonton"
  cleaned = cleaned.replace(/\s+[A-Za-z]{2,3}$/, "").trim();

  // Strip parenthetical suffixes: "Bristol (UK)" → "Bristol"
  cleaned = cleaned.replace(/\s*\(.*?\)\s*$/, "").trim();

  return cleaned;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
