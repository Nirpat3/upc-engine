import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identify,
  computeCheckDigit,
  isValidCheckDigit,
  toCanonical,
  expandUpcE6,
  compressUpcA11,
  UpcError,
} from '../src/core.mjs';

test('identify classifies by digit length', () => {
  assert.equal(identify('123456').format, 'UPC_E_6');
  assert.equal(identify('0123456').format, 'UPC_E_7');
  assert.equal(identify('01234565').format, 'UPC_E_8');
  assert.equal(identify('12345678901').format, 'UPC_A_11');
  assert.equal(identify('123456789012').format, 'UPC_A_12');
  assert.equal(identify('1234567890123').format, 'EAN_13');
  assert.equal(identify('12345678901234').format, 'GTIN_14');
});

test('identify rejects non-numeric and bad lengths as typed UpcError', () => {
  assert.throws(() => identify('12A456'), UpcError);
  assert.throws(() => identify('123'), UpcError);
  try {
    identify('123');
  } catch (e) {
    assert.equal(e.code, 'BAD_LENGTH');
  }
});

test('computeCheckDigit matches known UPC-A example (036000291452)', () => {
  // Real-world UPC-A: 036000291452 (Kellogg's example widely cited)
  const payload = '03600029145';
  assert.equal(computeCheckDigit(payload), '2');
  assert.equal(isValidCheckDigit('036000291452'), true);
  assert.equal(isValidCheckDigit('036000291459'), false);
});

test('toCanonical never trusts a supplied check digit', () => {
  const result = toCanonical('036000291459'); // wrong check digit on purpose
  assert.equal(result.canonical, '036000291452');
});

test('toCanonical: 11-digit UPC-A payload gets a computed check digit', () => {
  const result = toCanonical('03600029145');
  assert.equal(result.canonical, '036000291452');
});

test('toCanonical: EAN-13 with leading 0 unwraps to UPC-A', () => {
  const result = toCanonical('0036000291452');
  assert.equal(result.format, 'UPC_A_12');
  assert.equal(result.canonical, '036000291452');
});

test('toCanonical: EAN-13 not starting with 0 (non-US/Canada, e.g. German GS1 prefix) canonicalizes as EAN_13, not NON_UPC_A', () => {
  const result = toCanonical('4006381333931'); // real EAN-13, German GS1 prefix (400-440 range)
  assert.equal(result.format, 'EAN_13');
  assert.equal(result.canonical, '4006381333931');
});


test('expandUpcE6 / compressUpcA11 are exact inverses for all 4 GS1 patterns', () => {
  // Construct UPC-E codes BY PATTERN (not guessed) so we know ground truth,
  // run them through expand -> compress, and assert we get the same 6 digits
  // and number system back out. This is the actual property under test:
  // expand and compress must be exact inverses on every code compress can produce.
  const upcEVectors = [
    '425261', // terminal 0-2 pattern
    '425271', // terminal 0-2 pattern, different mfr
    '023450', // terminal 0-2, terminal=0
    '123453', // terminal 3 pattern
    '789453', // terminal 3 pattern, different mfr
    '123454', // terminal 4 pattern
    '567894', // terminal 4 pattern, different mfr
    '123456', // terminal 5-9 pattern
    '123458', // terminal 5-9 pattern
    '999999', // terminal 5-9, edge case all-9s
  ];
  for (const upcE of upcEVectors) {
    for (const ns of ['0', '1']) {
      const expanded = expandUpcE6(upcE, ns);
      assert.equal(expanded.length, 11);
      const compressed = compressUpcA11(expanded);
      assert.ok(compressed, `expected ${expanded} (from UPC-E ${upcE}, ns ${ns}) to be compressible`);
      assert.equal(compressed.upcE6, upcE, `round trip mismatch for ${upcE} (ns ${ns})`);
      assert.equal(compressed.numberSystem, ns);
    }
  }
});

test('compressUpcA11 returns null (not throw) for non-compressible UPC-A', () => {
  // number system 2-9 is never compressible
  const result = compressUpcA11('29999999999'.slice(0, 11));
  assert.equal(result, null);
});

test('compressUpcA11 returns null for number system 0/1 that does not fit any pattern', () => {
  const result = compressUpcA11('01111111111');
  assert.equal(result, null);
});

test('expandUpcE6 rejects bad number system', () => {
  assert.throws(() => expandUpcE6('123456', '5'), UpcError);
});

test('toCanonical for UPC-E 6/7/8 digit forms all expand + recompute check digit', () => {
  const c6 = toCanonical('123453'); // terminal 3 pattern, ns defaults 0
  const c7 = toCanonical('0123453'); // same with explicit ns=0
  const c8 = toCanonical('01234531'); // 8-digit; trailing check digit ignored & recomputed
  assert.equal(c6.canonical, c7.canonical);
  assert.equal(c6.canonical, c8.canonical);
  assert.equal(isValidCheckDigit(c6.canonical), true);
});
