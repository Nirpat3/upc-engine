import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.mjs reads env vars at call-time (not import-time), so tests can freely
// set/unset them per-test without needing a real Supabase project. Network
// calls are intercepted via a mocked global.fetch -- no real HTTP happens.

async function freshDb() {
  // bust the module cache isn't needed since db.mjs has no top-level state;
  // env vars are read fresh on every exported function call.
  return import('../src/db.mjs');
}

test('isDbConfigured reflects env vars without throwing', async () => {
  const { isDbConfigured } = await freshDb();
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_KEY;
    assert.equal(isDbConfigured(), false);

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    assert.equal(isDbConfigured(), true);
  } finally {
    if (savedUrl) process.env.SUPABASE_URL = savedUrl; else delete process.env.SUPABASE_URL;
    if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('recordUpc throws a typed, clear error when Supabase env vars are not set', async () => {
  const { recordUpc } = await freshDb();
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_KEY;
  try {
    await assert.rejects(() => recordUpc('036000291452'), /DB_NOT_CONFIGURED|not configured/);
  } finally {
    if (savedUrl) process.env.SUPABASE_URL = savedUrl;
    if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  }
});

test('recordUpc calls the correct PostgREST upsert endpoint with decomposed fields, using a mocked fetch', async () => {
  const { recordUpc } = await freshDb();
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([{ upc_a: '036000291452', seen_count: 1 }]),
    };
  };
  try {
    const result = await recordUpc('036000291452', {
      brandName: 'Acme',
      productName: 'Widget',
      sourceProfile: 'raw_upc_a_full',
      companyPrefixLength: 6,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/upc_records?on_conflict=upc_a');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.apikey, 'fake-service-role-key');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer fake-service-role-key');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.upc_a, '036000291452');
    assert.equal(body.company_prefix, '036000');
    assert.equal(body.brand_name, 'Acme');
    assert.equal(result.upc_a, '036000291452');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('getUpcRecord returns null (not throw) on an empty result set', async () => {
  const { getUpcRecord } = await freshDb();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => '[]' });
  try {
    const result = await getUpcRecord('036000291452');
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('a non-2xx PostgREST response surfaces as a typed DB_REQUEST_FAILED error, not a silent failure', async () => {
  const { recordUpc } = await freshDb();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'invalid api key' });
  try {
    await assert.rejects(() => recordUpc('036000291452'), /DB_REQUEST_FAILED|401/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
