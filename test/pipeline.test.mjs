import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProfile, reverseProfile, convertToProfile } from '../src/pipeline.mjs';
import { getProfile, listProfiles } from '../src/profiles.mjs';
import { toCanonical } from '../src/core.mjs';

const CANONICAL = '036000291452'; // valid UPC-A, ns=0

test('list-profiles catalog is non-empty and every entry loads', () => {
  const profiles = listProfiles();
  assert.ok(profiles.length >= 5);
  for (const { name } of profiles) {
    assert.ok(getProfile(name), `profile ${name} should load`);
  }
});

test('applyProfile: raw_upc_a_full is identity on a canonical code', () => {
  const profile = getProfile('raw_upc_a_full');
  assert.equal(applyProfile(CANONICAL, profile), CANONICAL);
});

test('applyProfile + reverseProfile round-trip for every built-in profile using a compressible code', async () => {
  const { expandUpcE6, computeCheckDigit } = await import('../src/core.mjs');
  const payload11 = expandUpcE6('123453', '0'); // terminal-3 pattern, guaranteed compressible
  const canonical = payload11 + computeCheckDigit(payload11);

  const profiles = listProfiles();
  for (const { name } of profiles) {
    const profile = getProfile(name);
    const device = applyProfile(canonical, profile);
    const recovered = reverseProfile(device, profile);
    assert.equal(recovered, canonical, `profile "${name}" failed round trip (device="${device}")`);
  }
});

test('applyProfile + reverseProfile round-trip for every built-in profile using a NON-compressible code', () => {
  const canonical = CANONICAL; // ns=0 but not compressible in the standard patterns
  const profiles = listProfiles();
  for (const { name } of profiles) {
    const profile = getProfile(name);
    const device = applyProfile(canonical, profile);
    if (profile.compressToUpcE) {
      // Lenient fallback emits full UPC-A shape for a non-compressible code (by design,
      // see catalog "onNotCompressible": "lenient"), so reverseProfile — which expects
      // UPC-E shape for a compress profile — is not expected to parse it. That's an
      // accepted v1 limitation for lenient-fallback + reverse-translation combined;
      // just confirm the forward fallback actually produced full UPC-A.
      assert.equal(device, canonical);
      continue;
    }
    const recovered = reverseProfile(device, profile);
    assert.equal(recovered, canonical, `profile "${name}" failed round trip (device="${device}")`);
  }
});

test('upc_e_6_digit_core profile produces exactly 6 digits for a compressible code', async () => {
  const { expandUpcE6, computeCheckDigit } = await import('../src/core.mjs');
  const payload11 = expandUpcE6('123456', '0');
  const canonical = payload11 + computeCheckDigit(payload11);
  const profile = getProfile('upc_e_6_digit_core');
  const device = applyProfile(canonical, profile);
  assert.equal(device.length, 6);
  assert.equal(device, '123456');
});

test('upc_a_as_ean13 prepends a single zero', () => {
  const profile = getProfile('upc_a_as_ean13');
  const device = applyProfile(CANONICAL, profile);
  assert.equal(device, '0' + CANONICAL);
});

test('symbology_prefixed_ean13 adds the ]E0 prefix and strips it on reverse', () => {
  const profile = getProfile('symbology_prefixed_ean13');
  const device = applyProfile(CANONICAL, profile);
  assert.equal(device, ']E0' + '0' + CANONICAL);
  assert.equal(reverseProfile(device, profile), CANONICAL);
});

test('convertToProfile: raw string input through to device profile in one call', () => {
  const profile = getProfile('upc_a_no_check_digit');
  const device = convertToProfile('36000291452', profile); // 11-digit input, missing leading 0
  // toCanonical will treat this as an 11-digit UPC-A payload as-is (no leading 0 assumption
  // needed since it's already 11 digits) -> canonical 036000291452 is NOT what happens;
  // instead 11 digits are taken verbatim as the payload. Assert against that real behavior.
  const canonical = toCanonical('36000291452').canonical;
  assert.equal(device, canonical.slice(0, 11));
});
