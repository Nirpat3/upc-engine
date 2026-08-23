// Declarative scanner-profile pipeline: transforms a canonical UPC-A(12)
// into the exact byte shape a given POS/scanner is configured to expect,
// and reverses that transform.
//
// A profile is a plain-data object of primitive toggles/params (see
// profiles/catalog.json). Composing named vendor-menu options is done at
// the profile-authoring layer, not in code — adding a new POS's config
// should never require a code change, only a new catalog entry.

import { UpcError, computeCheckDigit, compressUpcA11, expandUpcE6, toCanonical } from './core.mjs';

/**
 * @typedef {object} Profile
 * @property {boolean} [expandToUpcA] - UPC-E: expand to UPC-A on output.
 * @property {boolean} [compressToUpcE] - UPC-A: compress to UPC-E on output (only when compressible).
 * @property {boolean} [stripLeadingDigit] - drop the number-system digit.
 * @property {boolean} [stripCheckDigit] - drop the trailing check digit.
 * @property {boolean} [prependZeroForEan13] - prepend '0' to make EAN-13 from UPC-A.
 * @property {number} [padWidth] - zero-pad (left) to this total width.
 * @property {boolean} [truncateToWidth] - if true, padWidth also truncates (right) longer codes.
 * @property {string} [symbologyPrefix] - literal prefix to prepend (e.g. ']E0').
 * @property {'strict'|'lenient'} [onNotCompressible] - 'strict' throws when compressToUpcE requested
 *   but the code has no UPC-E form; 'lenient' (default) falls back to UPC-A un-compressed.
 */

/**
 * outbound: canonical UPC-A(12) -> device-specific string, per profile.
 * @param {string} canonicalUpc12
 * @param {Profile} profile
 */
export function applyProfile(canonicalUpc12, profile) {
  if (!/^\d{12}$/.test(canonicalUpc12)) {
    throw new UpcError('applyProfile requires a canonical 12-digit UPC-A', 'BAD_CANONICAL');
  }
  const numberSystem = canonicalUpc12[0];
  const payload11 = canonicalUpc12.slice(0, 11);
  const checkDigit = canonicalUpc12[11];

  let body; // digits only, before prefix/pad
  if (profile.compressToUpcE) {
    const compressed = compressUpcA11(payload11);
    if (!compressed) {
      if (profile.onNotCompressible === 'strict') {
        throw new UpcError('Code is not UPC-E compressible', 'NOT_COMPRESSIBLE');
      }
      body = canonicalUpc12; // lenient fallback: emit full UPC-A
    } else {
      let e = compressed.upcE6;
      if (!profile.stripLeadingDigit) e = compressed.numberSystem + e;
      if (!profile.stripCheckDigit) {
        // check digit for UPC-E is defined as the UPC-A check digit (computed on the
        // expanded 11-digit payload), per GS1 — reuse the one we already have.
        e = e + checkDigit;
      }
      body = e;
    }
  } else if (profile.expandToUpcA) {
    body = canonicalUpc12; // already expanded; nothing to do
  } else {
    // stay UPC-A shape
    let a = canonicalUpc12;
    if (profile.stripCheckDigit) a = a.slice(0, 11);
    if (profile.stripLeadingDigit) a = a.slice(1);
    body = a;
  }

  // stripLeadingDigit/stripCheckDigit for the plain UPC-A branch handled above;
  // for compress/expand branches those flags are consumed inside those branches
  // except expandToUpcA which still honors them here:
  if (profile.expandToUpcA) {
    if (profile.stripCheckDigit) body = body.slice(0, 11);
    if (profile.stripLeadingDigit) body = body.slice(1);
  }

  if (profile.prependZeroForEan13) body = '0' + body;

  if (typeof profile.padWidth === 'number') {
    if (body.length < profile.padWidth) {
      body = body.padStart(profile.padWidth, '0');
    } else if (body.length > profile.padWidth && profile.truncateToWidth) {
      body = body.slice(0, profile.padWidth);
    }
  }

  if (profile.symbologyPrefix) body = profile.symbologyPrefix + body;

  return body;
}

/**
 * inbound: device-specific string -> canonical UPC-A(12), given the SAME
 * profile that produced it (the profile describes the scanner's config,
 * so the reverse transform is deterministic from the same declaration).
 */
export function reverseProfile(deviceCode, profile) {
  let s = String(deviceCode ?? '');
  if (profile.symbologyPrefix && s.startsWith(profile.symbologyPrefix)) {
    s = s.slice(profile.symbologyPrefix.length);
  }
  if (!/^\d+$/.test(s)) {
    throw new UpcError(`"${deviceCode}" is not numeric after prefix strip`, 'NOT_NUMERIC');
  }
  // Undo left-zero-padding introduced purely for width (padWidth), but only
  // when we know the expected pre-pad length; reconstruct expected length
  // from the other flags to avoid eating "real" leading zeros.
  if (typeof profile.padWidth === 'number' && s.length === profile.padWidth) {
    const expectedLen = expectedPrePadLength(profile);
    if (expectedLen != null && expectedLen < s.length) {
      s = s.slice(s.length - expectedLen);
    }
  }

  if (profile.prependZeroForEan13 && s[0] === '0') {
    s = s.slice(1);
  }

  if (profile.compressToUpcE) {
    // s is now UPC-E shaped per stripLeadingDigit/stripCheckDigit
    let e = s;
    let numberSystem = '0';
    if (!profile.stripLeadingDigit) {
      numberSystem = e[0];
      e = e.slice(1);
    }
    if (!profile.stripCheckDigit) {
      e = e.slice(0, 6); // drop trailing check digit, we recompute
    }
    if (e.length !== 6) {
      throw new UpcError(`Expected 6-digit UPC-E body, got "${e}"`, 'BAD_LENGTH');
    }
    const payload11 = expandUpcE6(e, numberSystem);
    const checkDigit = computeCheckDigit(payload11);
    return payload11 + checkDigit;
  }

  // UPC-A / expanded shape
  let a = s;
  if (profile.stripLeadingDigit) {
    // number system digit was dropped; without side info we cannot recover it
    // with certainty, but US retail defaults to '0' for non-compressed UPC-A
    // when a profile strips it (documented assumption — see RESEARCH.md).
    a = '0' + a;
  }
  if (profile.stripCheckDigit || a.length === 11) {
    const checkDigit = computeCheckDigit(a.slice(0, 11));
    a = a.slice(0, 11) + checkDigit;
  }
  if (a.length !== 12) {
    throw new UpcError(`Could not reconstruct 12-digit UPC-A from "${deviceCode}"`, 'BAD_LENGTH');
  }
  return a;
}

function expectedPrePadLength(profile) {
  if (profile.compressToUpcE) {
    let len = 6;
    if (!profile.stripLeadingDigit) len += 1;
    if (!profile.stripCheckDigit) len += 1;
    return len;
  }
  let len = 12;
  if (profile.stripLeadingDigit) len -= 1;
  if (profile.stripCheckDigit) len -= 1;
  if (profile.prependZeroForEan13) len += 1;
  return len;
}

/** Convenience: parse arbitrary input, canonicalize, then apply a profile. */
export function convertToProfile(inputCode, profile) {
  const { canonical, format } = toCanonical(inputCode);
  if (format !== 'UPC_A_12' || !canonical) {
    throw new UpcError(`Input "${inputCode}" is not UPC-A representable`, 'NON_UPC_A');
  }
  return applyProfile(canonical, profile);
}
