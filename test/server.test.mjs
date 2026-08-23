import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Test the HTTP server end-to-end by spawning it on a random port
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '../src/server/index.mjs');

test('HTTP server starts, responds to root and /api/identify', async () => {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: '3843' },
    stdio: 'ignore'
  });

  // wait 500ms for server to boot
  await new Promise(r => setTimeout(r, 600));

  try {
    // 1. Root
    const res1 = await fetch('http://localhost:3843/');
    assert.equal(res1.status, 200);
    const json1 = await res1.json();
    assert.equal(json1.service, 'UPC Engine API');

    // 2. Identify
    const res2 = await fetch('http://localhost:3843/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '036000291452' })
    });
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.equal(json2.format, 'UPC_A_12');
    assert.equal(json2.digits, '036000291452');

    // 3. Country lookup
    const res3 = await fetch('http://localhost:3843/api/country?code=7501234567893');
    assert.equal(res3.status, 200);
    const json3 = await res3.json();
    assert.equal(json3.country, 'Mexico');

  } finally {
    child.kill();
  }
});
