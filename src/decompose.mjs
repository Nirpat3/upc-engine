// UPC-A structural decomposition: number system, manufacturer/company
// prefix, item reference (product code), and check digit -- plus the GS1
// semantics of each number system value.
//
// IMPORTANT CAVEAT (see RESEARCH.md): GS1 does NOT publish a fixed manufacturer-
// prefix-length table. Prefix length (6/7/8/9/10 digits) is assigned per-company
// by GS1 US based on how many items that company needs to code, and is only
// authoritatively knowable by looking the prefix up in GS1's own database (or a
// product database that has already resolved it). This module:
//   1. Always returns the GS1-guaranteed-correct fields: number system digit,
//      check digit, and the "structure-unknown" 10 or 11 digit body.
//   2. Optionally splits body into (companyPrefix, itemReference) IF the caller
//      supplies a known prefix length for that number system's manufacturer
//      range (from a resolved lookup, a GS1 subscription export, or a brand
//      table you maintain) -- never guesses a length silently.
//   3. Ships a small, clearly-labeled table of DEFAULT assumed lengths (6, the
//      most common one for suffix-brands) that callers can override per number
//      system or per specific prefix.
//
// REGIONAL SCOPE (verified against GS1's own country-prefix table, see
// DEFINE.md "Regional scope"): the number-system-digit table below and the
// UPC-A/UPC-E 12/6-digit format this whole engine targets are a US and
// Canada convention (GS1 US 000-139, GS1 Canada 754-755, both UPC-A
// compatible). Mexico/Central America/South America use standard EAN-13
// with their own GS1 country prefixes -- decomposeUpcA's check-digit math
// still applies (same GS1 algorithm), but NUMBER_SYSTEM_MEANINGS below does
// NOT describe a Latin American EAN-13 code's leading digits, and such
// codes are never UPC-E-compressible (that's a North-American-only feature).

import { UpcError, computeCheckDigit } from './core.mjs';
import { lookupGs1Country } from './gs1-country.mjs';


/**
 * GS1 number-system digit semantics (US/Canada UPC-A numbering convention
 * only -- see "REGIONAL SCOPE" above; does not apply to Latin American
 * EAN-13 country-prefix codes).
 */
export const NUMBER_SYSTEM_MEANINGS = {
  '0': 'Standard UPC-A numbering (most grocery/retail items)',
  '1': 'Standard UPC-A numbering (reserved/expansion of NS 0)',
  '2': 'Variable-weight items (fresh meat, produce, deli) -- assigned at store level, NOT globally unique',
  '3': 'National Drug Code (NDC) / National Health Related Items Code (HRI) -- pharmacy/drug products',
  '4': 'Store-internal use (loyalty programs, in-store marketing) -- NOT globally unique, retailer-defined',
  '5': 'Coupons',
  '6': 'Standard UPC-A numbering (reserved/expansion of NS 0)',
  '7': 'Standard UPC-A numbering (reserved/expansion of NS 0)',
  '8': 'Reserved for future use',
  '9': 'Reserved for future use',
};

/** Number systems where the body is a globally-unique GS1 company prefix + item ref. */
const GLOBALLY_UNIQUE_NUMBER_SYSTEMS = new Set(['0', '1', '6', '7']);

/**
 * Default company-prefix lengths GS1 US actually issues, most common first.
 * This is NOT a lookup table for a SPECIFIC prefix -- it's the menu of valid
 * lengths a prefix COULD be. Real length must come from a resolved source.
 * (GS1 issues 6/7/8/9/10-digit company prefixes depending on the company's
 * declared item-count needs; 6 digits, giving a 5-digit item reference range
 * of 00000-99999, is the classic/historical default most small brands got.)
 */
export const KNOWN_PREFIX_LENGTHS = [6, 7, 8, 9, 10];

/**
 * Decompose a canonical 12-digit UPC-A into its GS1 structural parts.
 * @param {string} canonicalUpcA - exactly 12 digits, valid check digit.
 * @param {object} [opts]
 * @param {number} [opts.companyPrefixLength] - override the assumed split point
 *   (digits after the number system digit that belong to the company prefix).
 *   Only meaningful for number systems 0/1/6/7. If omitted, companyPrefix/
 *   itemReference are left null and only the GS1-guaranteed fields are returned.
 * @returns {{
 *   raw: string, numberSystem: string, numberSystemMeaning: string,
 *   isGloballyUnique: boolean, body: string, checkDigit: string,
 *   checkDigitValid: boolean, companyPrefix: string|null,
 *   itemReference: string|null, companyPrefixLength: number|null,
 * }}
 */
export function decomposeUpcA(canonicalUpcA, opts = {}) {
  if (typeof canonicalUpcA !== 'string' || !/^\d{12}$/.test(canonicalUpcA)) {
    throw new UpcError(`decomposeUpcA requires exactly 12 digits, got "${canonicalUpcA}"`, 'BAD_LENGTH');
  }
  const numberSystem = canonicalUpcA[0];
  const body = canonicalUpcA.slice(1, 11); // 10 digits: company prefix + item ref
  const checkDigit = canonicalUpcA[11];
  const expectedCheck = computeCheckDigit(canonicalUpcA.slice(0, 11));
  const isGloballyUnique = GLOBALLY_UNIQUE_NUMBER_SYSTEMS.has(numberSystem);

  let companyPrefix = null;
  let itemReference = null;
  let companyPrefixLength = null;

  if (opts.companyPrefixLength != null) {
    const len = opts.companyPrefixLength;
    if (!KNOWN_PREFIX_LENGTHS.includes(len)) {
      throw new UpcError(`companyPrefixLength must be one of ${KNOWN_PREFIX_LENGTHS.join(',')}, got ${len}`, 'BAD_PREFIX_LENGTH');
    }
    companyPrefixLength = len;
    companyPrefix = numberSystem + body.slice(0, len - 1); // GS1 prefix includes the number system digit
    itemReference = body.slice(len - 1);
  }

  return {
    raw: canonicalUpcA,
    numberSystem,
    numberSystemMeaning: NUMBER_SYSTEM_MEANINGS[numberSystem] ?? 'Unknown/unassigned number system',
    isGloballyUnique,
    body,
    checkDigit,
    checkDigitValid: checkDigit === expectedCheck,
    companyPrefix,
    itemReference,
    companyPrefixLength,
  };
}

/**
 * Decompose a canonical 13-digit EAN-13 code (Latin American, European,
 * Asian, etc. -- anything NOT US/Canada UPC-A/UPC-E, per gs1-country.mjs).
 * Structure: GS1 country prefix (2-3 digits) + company prefix + item
 * reference + check digit. Unlike decomposeUpcA, there is no "number
 * system digit" concept -- that's a US/Canada-only convention.
 *
 * @param {string} canonicalEan13 - exactly 13 digits, valid check digit.
 * @param {object} [opts]
 * @param {number} [opts.companyPrefixLength] - digits after the GS1 country
 *   prefix that belong to the company (GS1 doesn't publish a universal
 *   table for this either -- same honesty caveat as decomposeUpcA).
 * @returns {{
 *   raw: string, gs1Prefix: string|null, country: string|null,
 *   region: string|null, isLatinAmerican: boolean, body: string,
 *   checkDigit: string, checkDigitValid: boolean,
 *   companyPrefix: string|null, itemReference: string|null,
 *   companyPrefixLength: number|null,
 * }}
 */
export function decomposeEan13(canonicalEan13, opts = {}) {
  if (typeof canonicalEan13 !== 'string' || !/^\d{13}$/.test(canonicalEan13)) {
    throw new UpcError(`decomposeEan13 requires exactly 13 digits, got "${canonicalEan13}"`, 'BAD_LENGTH');
  }
  const body = canonicalEan13.slice(0, 12);
  const checkDigit = canonicalEan13[12];
  const expectedCheck = computeCheckDigit(body);
  const countryInfo = lookupGs1Country(canonicalEan13);
  const isLatinAmerican =
    !!countryInfo &&
    (countryInfo.region === 'South America' ||
      countryInfo.region === 'Central America' ||
      countryInfo.region === 'Caribbean' ||
      countryInfo.country === 'Mexico');

  let companyPrefix = null;
  let itemReference = null;
  let companyPrefixLength = null;

  if (opts.companyPrefixLength != null) {
    const len = opts.companyPrefixLength;
    if (!KNOWN_PREFIX_LENGTHS.includes(len)) {
      throw new UpcError(`companyPrefixLength must be one of ${KNOWN_PREFIX_LENGTHS.join(',')}, got ${len}`, 'BAD_PREFIX_LENGTH');
    }
    companyPrefixLength = len;
    companyPrefix = body.slice(0, len);
    itemReference = body.slice(len);
  }

  return {
    raw: canonicalEan13,
    gs1Prefix: countryInfo ? countryInfo.prefix : null,
    country: countryInfo ? countryInfo.country : null,
    region: countryInfo ? countryInfo.region : null,
    isLatinAmerican,
    body,
    checkDigit,
    checkDigitValid: checkDigit === expectedCheck,
    companyPrefix,
    itemReference,
    companyPrefixLength,
  };
}

/**
 * Unified entry point: decompose whatever canonical form was produced by
 * toCanonical() -- UPC-A-12 (US/Canada) or EAN-13 (everyone else) -- by
 * routing to the correct decomposer. Throws for any other format (the
 * caller should have already rejected NON_UPC_A/etc. from toCanonical).
 * @param {{format: 'UPC_A_12'|'EAN_13', canonical: string}} canonicalResult
 * @param {object} [opts] forwarded to decomposeUpcA/decomposeEan13
 */
export function decomposeAny(canonicalResult, opts = {}) {
  if (!canonicalResult || !canonicalResult.canonical) {
    throw new UpcError('decomposeAny requires a canonical result with a non-null canonical code', 'NOT_CANONICAL');
  }
  if (canonicalResult.format === 'UPC_A_12') return decomposeUpcA(canonicalResult.canonical, opts);
  if (canonicalResult.format === 'EAN_13') return decomposeEan13(canonicalResult.canonical, opts);
  throw new UpcError(`decomposeAny cannot handle format "${canonicalResult.format}"`, 'UNSUPPORTED_FORMAT');
}


/**
 * Build (or merge into) a scanner/POS profile definition from structural
 * facts about a brand/company -- e.g. "this company's items should always
 * be tagged with companyPrefixLength=6" so future decomposes for that brand
 * don't need the length passed in every call. Returns a plain object meant
 * to be persisted by the caller (e.g. into the brand-profile table / DB
 * layer in db.mjs), not a built-in scanner-shape profile from profiles.mjs
 * (different concern: this is about UPC *structure*, not device *transmit shape*).
 */
export function createBrandProfile({ companyPrefix, brandName, companyPrefixLength, notes } = {}) {
  if (!companyPrefix || !/^\d{6,10}$/.test(companyPrefix)) {
    throw new UpcError('createBrandProfile requires a 6-10 digit companyPrefix (number system digit + prefix)', 'BAD_PREFIX');
  }
  if (!brandName) {
    throw new UpcError('createBrandProfile requires brandName', 'MISSING_BRAND_NAME');
  }
  const len = companyPrefixLength ?? companyPrefix.length;
  if (!KNOWN_PREFIX_LENGTHS.includes(len)) {
    throw new UpcError(`companyPrefixLength must be one of ${KNOWN_PREFIX_LENGTHS.join(',')}, got ${len}`, 'BAD_PREFIX_LENGTH');
  }
  return {
    companyPrefix,
    companyPrefixLength: len,
    brandName,
    notes: notes ?? null,
    createdAt: new Date().toISOString(),
  };
}
