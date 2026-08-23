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

import { UpcError, computeCheckDigit } from './core.mjs';

/** GS1 number-system digit semantics (from GS1 General Specifications). */
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
