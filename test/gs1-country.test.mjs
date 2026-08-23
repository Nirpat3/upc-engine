import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupGs1Country, isLatinAmericanGs1, GS1_PREFIX_RANGES } from '../src/gs1-country.mjs';

test('lookupGs1Country identifies Mexico, Brazil, Argentina, Colombia by real EAN-13 prefixes', () => {
  assert.equal(lookupGs1Country('7501234567895').country, 'Mexico');
  assert.equal(lookupGs1Country('7891234567890').country, 'Brazil');
  assert.equal(lookupGs1Country('7781234567891').country, 'Argentina');
  assert.equal(lookupGs1Country('7701234567892').country, 'Colombia');
});

test('lookupGs1Country identifies US and Canada as upcACompatible; Latin America as not', () => {
  const us = lookupGs1Country('036000291452');
  assert.equal(us.country, 'United States');
  assert.equal(us.upcACompatible, true);
  const canada = lookupGs1Country('7541234567890'); // 13-digit, prefix 754
  assert.equal(canada.country, 'Canada');
  assert.equal(canada.upcACompatible, true);
  const mexico = lookupGs1Country('7501234567895');
  assert.equal(mexico.upcACompatible, false);
});

test('isLatinAmericanGs1 flags Mexico/Central/South America/Caribbean, not US/Canada/Europe', () => {
  assert.equal(isLatinAmericanGs1('7501234567895'), true); // Mexico
  assert.equal(isLatinAmericanGs1('7891234567890'), true); // Brazil
  assert.equal(isLatinAmericanGs1('7461234567891'), true); // Dominican Republic (Caribbean)
  assert.equal(isLatinAmericanGs1('036000291452'), false); // US
  assert.equal(isLatinAmericanGs1('7541234567890'), false); // Canada (13-digit, prefix 754)
  assert.equal(isLatinAmericanGs1('4006381333931'), false); // Germany
});

test('lookupGs1Country returns null for unrecognized prefix or malformed input', () => {
  assert.equal(lookupGs1Country('9999999999999'), null); // 13-digit, prefix 999 not in any range
  assert.equal(lookupGs1Country('abc'), null);
  assert.equal(lookupGs1Country('123'), null);
});

test('GS1_PREFIX_RANGES has no internal overlaps (each prefix number maps to exactly one range)', () => {
  const sorted = [...GS1_PREFIX_RANGES].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].start > sorted[i - 1].end,
      `overlap between ${JSON.stringify(sorted[i - 1])} and ${JSON.stringify(sorted[i])}`);
  }
});
