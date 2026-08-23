// GS1 country-prefix table.
//
// Identifies which country/region GS1 Member Organization issued a given
// EAN-13/UPC-A barcode, based on the leading 2-3 digits. Source: GS1's own
// published country-code / prefix ranges (verified against the official
// list; see DEFINE.md "Regional scope"). This is metadata about WHO issued
// the number, not proof of where the product was made or sold.
//
// Scope for this module: only the "which region/country" question. Whether
// a code is UPC-A-shaped (US/Canada 12-digit convention) vs plain EAN-13
// (everyone else, 13-digit with a nonzero leading 3-digit prefix) is a
// SEPARATE question already handled in core.mjs/toCanonical.

export const GS1_PREFIX_RANGES = [
  { start: 0, end: 139, country: 'United States', region: 'North America', upcACompatible: true },
  { start: 300, end: 379, country: 'France / Monaco', region: 'Europe', upcACompatible: false },
  { start: 400, end: 440, country: 'Germany', region: 'Europe', upcACompatible: false },
  { start: 450, end: 459, country: 'Japan', region: 'Asia', upcACompatible: false },
  { start: 460, end: 469, country: 'Russia', region: 'Europe/Asia', upcACompatible: false },
  { start: 500, end: 509, country: 'United Kingdom', region: 'Europe', upcACompatible: false },
  { start: 690, end: 699, country: 'China', region: 'Asia', upcACompatible: false },
  { start: 729, end: 729, country: 'Israel', region: 'Middle East', upcACompatible: false },
  { start: 740, end: 740, country: 'Guatemala', region: 'Central America', upcACompatible: false },
  { start: 741, end: 741, country: 'El Salvador', region: 'Central America', upcACompatible: false },
  { start: 742, end: 742, country: 'Honduras', region: 'Central America', upcACompatible: false },
  { start: 743, end: 743, country: 'Nicaragua', region: 'Central America', upcACompatible: false },
  { start: 744, end: 744, country: 'Costa Rica', region: 'Central America', upcACompatible: false },
  { start: 745, end: 745, country: 'Panama', region: 'Central America', upcACompatible: false },
  { start: 746, end: 746, country: 'Dominican Republic', region: 'Caribbean', upcACompatible: false },
  { start: 750, end: 750, country: 'Mexico', region: 'North America', upcACompatible: false },
  { start: 754, end: 755, country: 'Canada', region: 'North America', upcACompatible: true },
  { start: 759, end: 759, country: 'Venezuela', region: 'South America', upcACompatible: false },
  { start: 770, end: 771, country: 'Colombia', region: 'South America', upcACompatible: false },
  { start: 773, end: 773, country: 'Uruguay', region: 'South America', upcACompatible: false },
  { start: 775, end: 775, country: 'Peru', region: 'South America', upcACompatible: false },
  { start: 777, end: 777, country: 'Bolivia', region: 'South America', upcACompatible: false },
  { start: 778, end: 779, country: 'Argentina', region: 'South America', upcACompatible: false },
  { start: 780, end: 780, country: 'Chile', region: 'South America', upcACompatible: false },
  { start: 784, end: 784, country: 'Paraguay', region: 'South America', upcACompatible: false },
  { start: 786, end: 786, country: 'Ecuador', region: 'South America', upcACompatible: false },
  { start: 789, end: 790, country: 'Brazil', region: 'South America', upcACompatible: false },
  { start: 800, end: 839, country: 'Italy / San Marino / Vatican City', region: 'Europe', upcACompatible: false },
  { start: 840, end: 849, country: 'Spain', region: 'Europe', upcACompatible: false },
  { start: 850, end: 850, country: 'Cuba', region: 'Caribbean', upcACompatible: false },
  { start: 858, end: 858, country: 'Slovakia', region: 'Europe', upcACompatible: false },
  { start: 859, end: 859, country: 'Czech Republic', region: 'Europe', upcACompatible: false },
  { start: 890, end: 890, country: 'India', region: 'Asia', upcACompatible: false },
  { start: 955, end: 955, country: 'Malaysia', region: 'Asia', upcACompatible: false },
  { start: 977, end: 977, country: 'ISSN (serial publications)', region: 'International registry', upcACompatible: false },
  { start: 978, end: 979, country: 'ISBN/ISMN (books/music)', region: 'International registry', upcACompatible: false },
];

/**
 * Resolve the GS1 country/region for a given EAN-13 (13-digit) or UPC-A
 * (12-digit) code, by inspecting its leading 3-digit GS1 prefix range.
 *
 * For a 12-digit UPC-A code, the "prefix" checked is the number-system
 * digit + first 2 digits of the company prefix -- i.e. exactly what you'd
 * get by treating it as EAN-13 with a leading zero (which is what US/Canada
 * UPC-A actually is under the hood: EAN-13 with prefix 000-139/754-755).
 *
 * @param {string} code 12 or 13 digit numeric string
 * @returns {{prefix: string, country: string, region: string, upcACompatible: boolean} | null}
 *   null if the code isn't 12/13 digits or its prefix isn't in a known range.
 */
export function lookupGs1Country(code) {
  if (!/^\d{12,13}$/.test(code)) return null;
  const ean13 = code.length === 12 ? '0' + code : code;
  const prefixNum = Number(ean13.slice(0, 3));
  const match = GS1_PREFIX_RANGES.find((r) => prefixNum >= r.start && prefixNum <= r.end);
  if (!match) return null;
  return {
    prefix: ean13.slice(0, 3),
    country: match.country,
    region: match.region,
    upcACompatible: match.upcACompatible,
  };
}

/** Convenience: is this code issued under a Latin American GS1 Member Organization? */
export function isLatinAmericanGs1(code) {
  const info = lookupGs1Country(code);
  if (!info) return false;
  return (
    (info.region === 'South America' || info.region === 'Central America' || info.region === 'Caribbean') ||
    info.country === 'Mexico'
  );
}

