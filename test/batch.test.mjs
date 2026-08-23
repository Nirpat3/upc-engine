import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertBatch, identifyBatch } from '../src/batch.mjs';

test('convertBatch: order-preserving, per-item error isolation', () => {
  const codes = ['036000291452', 'not-a-upc', '12345678901', '4006381333931'];
  const results = convertBatch(codes, { toProfile: 'raw_upc_a_full' });
  assert.equal(results.length, 4);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].output, '036000291452');
  assert.equal(results[1].ok, false);
  assert.equal(results[1].code, 'NOT_NUMERIC');
  assert.equal(results[2].ok, true);
  assert.equal(results[3].ok, false); // EAN-13 non-UPC representable
  assert.equal(results[3].code, 'NON_UPC_A');
  // indices preserved even with failures interspersed
  results.forEach((r, i) => assert.equal(r.index, i));
});

test('convertBatch: device-A to device-B translation via fromProfile+toProfile', () => {
  const deviceCodes = ['12345678901']; // 11-digit, no-check-digit shape
  const results = convertBatch(deviceCodes, {
    fromProfile: 'upc_a_no_check_digit',
    toProfile: 'upc_a_as_ean13',
  });
  assert.equal(results[0].ok, true);
  assert.ok(results[0].output.startsWith('0'));
  assert.equal(results[0].output.length, 13);
});

test('identifyBatch classifies a mixed batch without throwing', () => {
  const results = identifyBatch(['123456', '036000291452', 'garbage', '1234567890123']);
  assert.equal(results[0].format, 'UPC_E_6');
  assert.equal(results[1].format, 'UPC_A_12');
  assert.equal(results[2].ok, false);
  assert.equal(results[3].format, 'EAN_13');
});

test('convertBatch throws (not silently returns) when given a non-array', () => {
  assert.throws(() => convertBatch('036000291452', {}));
});
