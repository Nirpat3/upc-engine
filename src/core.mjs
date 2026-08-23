// Core UPC/EAN math: check digit, identify, canonicalize, UPC-E <-> UPC-A.
// No I/O, no config — pure functions so they're trivially testable.

/** @typedef {'UPC_A_12'|'UPC_A_11'|'UPC_E_6'|'UPC_E_7'|'UPC_E_8'|'EAN_13'|'GTIN_14'} UpcFormat */

export class UpcError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UpcError';
    this.code = code || 'INVALID_UPC';
  }
}

/** Strict digit-only check; throws UpcError (not a bare Error) so batch code can catch by type. */
function assertDigits(code) {
  const s = String(code ?? '');
  if (!/^\d+$/.test(s)) {
    throw new UpcError(`"${code}" is not numeric-only`, 'NOT_NUMERIC');
  }
  return s;
}

/**
 * GS1 mod-10 check digit for a 11-digit (UPC-A payload) or 12-digit (EAN-13 payload) string.
 * Positions counted from the RIGHT per GS1 spec, but the common left-to-right formulation
 * for a 12-digit UPC-A (11 data + 1 check) is: odd positions (1,3,5,7,9,11) from left x3,
 * even positions x1, sum, subtract from next multiple of 10.
 * @param {string} payload 11 digits (UPC-A) or 12 digits (EAN-13/GTIN-14 minus check digit)
 */
export function computeCheckDigit(payload) {
  const digits = assertDigits(payload);
  let sum = 0;
  // Weight from the right: rightmost payload digit (which sits just left of the
  // check digit) gets weight 3, alternating. This is equivalent for both 11- and
  // 12-digit payloads and matches GS1's official right-to-left definition exactly.
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    const weight = i % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidCheckDigit(fullCode) {
  const digits = assertDigits(fullCode);
  const payload = digits.slice(0, -1);
  const check = digits.slice(-1);
  return computeCheckDigit(payload) === check;
}

/**
 * Identify the format of a digit string. Throws UpcError for anything that
 * isn't a recognized length/shape (never crashes on bad input, caller decides
 * whether to catch-per-item in a batch).
 * @returns {{format: UpcFormat, digits: string}}
 */
export function identify(code) {
  const digits = assertDigits(code);
  switch (digits.length) {
    case 6:
      return { format: 'UPC_E_6', digits };
    case 7:
      return { format: 'UPC_E_7', digits };
    case 8:
      return { format: 'UPC_E_8', digits };
    case 11:
      return { format: 'UPC_A_11', digits };
    case 12:
      return { format: 'UPC_A_12', digits };
    case 13:
      return { format: 'EAN_13', digits };
    case 14:
      return { format: 'GTIN_14', digits };
    default:
      throw new UpcError(
        `"${code}" has ${digits.length} digits; expected 6,7,8,11,12,13, or 14`,
        'BAD_LENGTH',
      );
  }
}

/**
 * Expand a 6-digit UPC-E payload (no number system, no check digit) to the
 * 11-digit UPC-A payload (no check digit), given the number system digit
 * (0 or 1). Implements the GS1 zero-suppression table.
 */
export function expandUpcE6(upcE6, numberSystem = '0') {
  const e = assertDigits(upcE6);
  if (e.length !== 6) throw new UpcError('expandUpcE6 requires exactly 6 digits', 'BAD_LENGTH');
  if (!['0', '1'].includes(String(numberSystem))) {
    throw new UpcError('UPC-E number system digit must be 0 or 1', 'BAD_NUMBER_SYSTEM');
  }
  const d = e.split('');
  const last = d[5];
  let mfr;
  let product;
  if (['0', '1', '2'].includes(last)) {
    mfr = d[0] + d[1] + last + '00';
    product = '00' + d[2] + d[3] + d[4];
  } else if (last === '3') {
    mfr = d[0] + d[1] + d[2] + '00';
    product = '000' + d[3] + d[4];
  } else if (last === '4') {
    mfr = d[0] + d[1] + d[2] + d[3] + '0';
    product = '0000' + d[4];
  } else {
    // 5-9
    mfr = d[0] + d[1] + d[2] + d[3] + d[4];
    product = '0000' + last;
  }
  return numberSystem + mfr + product; // 11 digits
}

/**
 * Compress an 11-digit UPC-A payload (no check digit) to a 6-digit UPC-E
 * payload, if — and only if — it fits one of the GS1 zero-suppression
 * patterns. Returns null (not a throw) when the code is not compressible;
 * "not every UPC-A has a UPC-E form" is expected, normal control flow.
 * @returns {{upcE6: string, numberSystem: string} | null}
 */
export function compressUpcA11(upcA11) {
  const p = assertDigits(upcA11);
  if (p.length !== 11) throw new UpcError('compressUpcA11 requires exactly 11 digits', 'BAD_LENGTH');
  const numberSystem = p[0];
  if (!['0', '1'].includes(numberSystem)) return null;
  const mfr = p.slice(1, 6); // 5 digits
  const product = p.slice(6, 11); // 5 digits

  // Pattern: mfr ends in 00, and matches {0,1,2}00; product is 00XXX.
  // Note the pattern digit (X3, held in mfr[2]) becomes the LAST UPC-E digit,
  // not the 3rd — easy transcription error, caught by the round-trip test.
  if (mfr.slice(3) === '00' && ['0', '1', '2'].includes(mfr[2]) && product.slice(0, 2) === '00') {
    return { upcE6: mfr[0] + mfr[1] + product[2] + product[3] + product[4] + mfr[2], numberSystem };
  }
  // Pattern: mfr digit3-9, ends 00, product 000XX
  if (mfr.slice(3) === '00' && mfr[2] >= '3' && mfr[2] <= '9' && product.slice(0, 3) === '000') {
    return { upcE6: mfr[0] + mfr[1] + mfr[2] + product[3] + product[4] + '3', numberSystem };
  }
  // Pattern: mfr digit4 1-9, mfr[4]==0, product 0000X
  if (mfr[4] === '0' && mfr[3] >= '1' && mfr[3] <= '9' && product.slice(0, 4) === '0000') {
    return { upcE6: mfr[0] + mfr[1] + mfr[2] + mfr[3] + product[4] + '4', numberSystem };
  }
  // Pattern: mfr digit5 5-9, product 0000X
  if (mfr[4] >= '5' && mfr[4] <= '9' && product.slice(0, 4) === '0000') {
    return { upcE6: mfr.slice(0, 5) + product[4], numberSystem };
  }
  return null;
}

/**
 * Normalize ANY recognized input to canonical form: a full 12-digit UPC-A
 * string with a freshly computed (never trusted) check digit.
 * - UPC-E (6/7/8): number system defaults to '0' unless embedded (7/8-digit
 *   forms carry it explicitly); expanded via GS1 table.
 * - UPC-A (11/12): 11-digit payload gets a computed check digit appended;
 *   12-digit input has its check digit re-verified/recomputed (never trusted).
 * - EAN-13 starting with '0': treated as UPC-A with a leading 0 (strip it).
 * - GTIN-14 starting with '00': treated as UPC-A padded to 14 (strip the 00).
 * Anything else (EAN-13/GTIN-14 not UPC-A-representable) is returned as-is
 * with format tagged NON_UPC_A so callers can decide how to handle it.
 */
export function toCanonical(code) {
  const { format, digits } = identify(code);
  switch (format) {
    case 'UPC_E_6': {
      const payload11 = expandUpcE6(digits, '0');
      return finishUpcA(payload11);
    }
    case 'UPC_E_7': {
      const numberSystem = digits[0];
      const payload11 = expandUpcE6(digits.slice(1), numberSystem);
      return finishUpcA(payload11);
    }
    case 'UPC_E_8': {
      const numberSystem = digits[0];
      const payload11 = expandUpcE6(digits.slice(1, 7), numberSystem);
      return finishUpcA(payload11); // trailing check digit in input is ignored/recomputed
    }
    case 'UPC_A_11':
      return finishUpcA(digits);
    case 'UPC_A_12':
      return finishUpcA(digits.slice(0, 11));
    case 'EAN_13':
      if (digits[0] === '0') return finishUpcA(digits.slice(1, 12));
      return finishEan13(digits.slice(0, 12));
    case 'GTIN_14':
      if (digits.slice(0, 2) === '00') return finishUpcA(digits.slice(2, 13));
      return { format: 'NON_UPC_A', canonical: null, source: digits };
    default:
      throw new UpcError(`Unhandled format ${format}`, 'UNHANDLED_FORMAT');
  }
}

function finishUpcA(payload11) {
  const check = computeCheckDigit(payload11);
  const canonical = payload11 + check;
  return { format: 'UPC_A_12', canonical, source: payload11 };
}

/**
 * Canonicalize a non-US/Canada EAN-13 (Latin American, European, etc.):
 * recompute the check digit against the 12-digit payload (never trust the
 * input's), same GS1 algorithm as UPC-A -- just one digit wider. Returned
 * as format 'EAN_13' (not force-fit into UPC-A/UPC-E, which don't apply
 * outside the US/Canada numbering convention -- see gs1-country.mjs).
 */
function finishEan13(payload12) {
  const check = computeCheckDigit(payload12);
  const canonical = payload12 + check;
  return { format: 'EAN_13', canonical, source: payload12 };
}

