import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeEan13, decomposeAny, decomposeUpcA } from '../src/decompose.mjs';
import { toCanonical } from '../src/core.mjs';

test('decomposeEan13 splits a valid Mexican EAN-13 and flags isLatinAmerican', () => {
  const d = decomposeEan13('7501234567893');
  assert.equal(d.country, 'Mexico');
  assert.equal(d.region, 'North America');
  assert.equal(d.isLatinAmerican, true);
  assert.equal(d.checkDigitValid, true);
  assert.equal(d.companyPrefix, null); // no prefix length supplied
});

test('decomposeEan13 splits a valid Brazilian EAN-13 and flags isLatinAmerican', () => {
  const d = decomposeEan13('7891234567895');
  assert.equal(d.country, 'Brazil');
  assert.equal(d.region, 'South America');
  assert.equal(d.isLatinAmerican, true);
  assert.equal(d.checkDigitValid, true);
});

test('decomposeEan13 with companyPrefixLength splits body correctly', () => {
  const d = decomposeEan13('7501234567893', { companyPrefixLength: 6 });
  assert.equal(d.companyPrefix, '750123');
  assert.equal(d.itemReference, '456789');
  assert.equal(d.companyPrefix.length + d.itemReference.length, 12);
});

test('decomposeEan13 flags a German EAN-13 as NOT Latin American', () => {
  const d = decomposeEan13('4006381333931');
  assert.equal(d.country, 'Germany');
  assert.equal(d.isLatinAmerican, false);
  assert.equal(d.checkDigitValid, true);
});

test('decomposeEan13 detects an invalid check digit rather than trusting it', () => {
  const d = decomposeEan13('7501234567899'); // wrong check digit (should be 3)
  assert.equal(d.checkDigitValid, false);
});

test('decomposeEan13 rejects non-13-digit input', () => {
  assert.throws(() => decomposeEan13('12345'), (err) => err.code === 'BAD_LENGTH');
});

test('decomposeAny routes UPC-A canonical results to decomposeUpcA', () => {
  const canonicalResult = toCanonical('036000291452');
  const d = decomposeAny(canonicalResult);
  assert.equal(d.numberSystem, '0'); // UPC-A-specific field present
});

test('decomposeAny routes EAN-13 canonical results to decomposeEan13', () => {
  const canonicalResult = toCanonical('7501234567893');
  const d = decomposeAny(canonicalResult);
  assert.equal(d.country, 'Mexico'); // EAN-13-specific field present
  assert.equal(d.numberSystem, undefined); // NOT a UPC-A field
});

test('decomposeAny throws a typed error for a non-canonicalizable input rather than silently returning garbage', () => {
  const canonicalResult = { format: 'NON_UPC_A', canonical: null, source: 'x' };
  assert.throws(() => decomposeAny(canonicalResult), (err) => err.code === 'NOT_CANONICAL');
});
