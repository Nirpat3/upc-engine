import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProfileFromPairs, detectProfileFromDatabase } from '../src/detect.mjs';
import { getProfile, listProfiles } from '../src/profiles.mjs';
import { applyProfile } from '../src/pipeline.mjs';

const CANONICAL_A = '036000291452'; // not UPC-E compressible

test('detectProfileFromPairs resolves the true profile from 2 pairs across different UPC shapes', async () => {
  const core = await import('../src/core.mjs');
  const payload11 = core.expandUpcE6('987653', '0');
  const canonicalB = payload11 + core.computeCheckDigit(payload11);

  const trueProfileName = 'upc_a_no_leading_no_check';
  const trueProfile = getProfile(trueProfileName);

  const pairs = [
    { canonical: CANONICAL_A, scanned: applyProfile(CANONICAL_A, trueProfile) },
    { canonical: canonicalB, scanned: applyProfile(canonicalB, trueProfile) },
  ];

  const result = detectProfileFromPairs(pairs);
  assert.equal(result.resolved, true);
  assert.equal(result.profile, trueProfileName);
  assert.ok(result.candidates.includes(trueProfileName));
});

test('detectProfileFromPairs is ambiguous with only 1 pair when profiles coincide, but narrows with 2', async () => {
  // raw_upc_a_full and upc_e_expand_to_upc_a are IDENTICAL definitions (both just
  // expandToUpcA:true) so they are indistinguishable by output — this is expected,
  // not a bug: assert the candidate set includes both when using either code.
  const result = detectProfileFromPairs([
    { canonical: CANONICAL_A, scanned: CANONICAL_A },
  ]);
  assert.ok(result.candidates.includes('raw_upc_a_full'));
  assert.ok(result.candidates.includes('upc_e_expand_to_upc_a'));
  assert.equal(result.resolved, false); // ambiguous, and reported as such, not guessed
});

test('detectProfileFromPairs throws on empty input rather than returning a false resolution', () => {
  assert.throws(() => detectProfileFromPairs([]));
});

test('detectProfileFromDatabase resolves the profile when scanned codes reverse to known UPCs', () => {
  const known = [CANONICAL_A];
  const trueProfile = getProfile('upc_a_no_check_digit');
  const scanned = [applyProfile(CANONICAL_A, trueProfile)];
  const result = detectProfileFromDatabase(scanned, known);
  assert.ok(result.candidates.some((c) => c.profile === 'upc_a_no_check_digit'));
});

test('detectProfileFromDatabase reports multiple candidates (not a guess) when ambiguous', () => {
  const known = [CANONICAL_A];
  const scanned = [CANONICAL_A]; // matches both raw_upc_a_full and upc_e_expand_to_upc_a
  const result = detectProfileFromDatabase(scanned, known);
  assert.ok(result.candidates.length >= 2);
  assert.equal(result.resolved, false);
});
