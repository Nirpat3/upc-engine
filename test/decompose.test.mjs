import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeUpcA, createBrandProfile, NUMBER_SYSTEM_MEANINGS, KNOWN_PREFIX_LENGTHS } from '../src/decompose.mjs';

test('decomposeUpcA returns GS1-guaranteed fields without a prefix length', () => {
  const d = decomposeUpcA('036000291452');
  assert.equal(d.numberSystem, '0');
  assert.equal(d.checkDigit, '2');
  assert.equal(d.checkDigitValid, true);
  assert.equal(d.body, '3600029145');
  assert.equal(d.isGloballyUnique, true);
  assert.equal(d.companyPrefix, null, 'should not guess a split without an explicit length');
  assert.equal(d.itemReference, null);
});

test('decomposeUpcA splits company prefix / item reference when length is given', () => {
  // number system 0 + companyPrefixLength 6 -> prefix = ns + first 5 body digits
  const d = decomposeUpcA('036000291452', { companyPrefixLength: 6 });
  assert.equal(d.companyPrefixLength, 6);
  assert.equal(d.companyPrefix, '036000'); // 6 digits: ns(1) + body[0:5]
  assert.equal(d.itemReference, '29145'); // remaining 5 digits of the 10-digit body
  assert.equal(d.companyPrefix + d.itemReference, d.numberSystem + d.body);
});

test('decomposeUpcA detects an invalid check digit rather than trusting it', () => {
  const d = decomposeUpcA('036000291459'); // wrong check digit (real is ...452)
  assert.equal(d.checkDigitValid, false);
  assert.equal(d.checkDigit, '9');
});

test('decomposeUpcA rejects non-12-digit input', () => {
  assert.throws(() => decomposeUpcA('12345'), /BAD_LENGTH|12 digits/);
});

test('decomposeUpcA rejects an out-of-range companyPrefixLength', () => {
  assert.throws(() => decomposeUpcA('036000291452', { companyPrefixLength: 3 }), (err) => err.code === 'BAD_PREFIX_LENGTH');
});

test('decomposeUpcA flags non-globally-unique number systems (2=variable weight, 4=store internal)', () => {
  const d2 = decomposeUpcA('236000291456'); // correct check digit for this payload
  assert.equal(d2.numberSystem, '2');
  assert.equal(d2.checkDigitValid, true);
  assert.equal(d2.isGloballyUnique, false);
  assert.match(d2.numberSystemMeaning, /variable-weight/i);

  const d4 = decomposeUpcA('436000291450'); // correct check digit for this payload
  assert.equal(d4.numberSystem, '4');
  assert.equal(d4.checkDigitValid, true);
  assert.equal(d4.isGloballyUnique, false);
  assert.match(d4.numberSystemMeaning, /store-internal/i);
});

test('NUMBER_SYSTEM_MEANINGS covers all 10 digits 0-9', () => {
  for (let i = 0; i <= 9; i++) {
    assert.ok(NUMBER_SYSTEM_MEANINGS[String(i)], `missing meaning for number system ${i}`);
  }
});

test('createBrandProfile builds a valid brand profile record', () => {
  const profile = createBrandProfile({ companyPrefix: '036000', brandName: 'Acme Foods', companyPrefixLength: 6 });
  assert.equal(profile.brandName, 'Acme Foods');
  assert.equal(profile.companyPrefix, '036000');
  assert.equal(profile.companyPrefixLength, 6);
  assert.ok(profile.createdAt);
});

test('createBrandProfile rejects missing brandName or malformed prefix', () => {
  assert.throws(() => createBrandProfile({ companyPrefix: '036000' }), (err) => err.code === 'MISSING_BRAND_NAME');
  assert.throws(() => createBrandProfile({ companyPrefix: 'abc123', brandName: 'X' }), (err) => err.code === 'BAD_PREFIX');
});

test('KNOWN_PREFIX_LENGTHS lists the real GS1 US prefix length menu', () => {
  assert.deepEqual(KNOWN_PREFIX_LENGTHS, [6, 7, 8, 9, 10]);
});
