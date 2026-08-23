import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'upc-engine.mjs');

function run(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = execFile('node', [CLI, ...args], (error, stdout, stderr) => {
      resolve({ error, stdout, stderr, code: error?.code ?? 0 });
    });
    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

test('CLI identify returns JSON with format', async () => {
  const { stdout, code } = await run(['identify', '036000291452']);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.format, 'UPC_A_12');
  assert.equal(code, 0);
});

test('CLI convert applies a named profile', async () => {
  const { stdout } = await run(['convert', '036000291452', 'upc_a_no_check_digit']);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.output, '03600029145');
});

test('CLI list-profiles enumerates the catalog', async () => {
  const { stdout } = await run(['list-profiles']);
  const parsed = JSON.parse(stdout);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.some((p) => p.name === 'upc_e_full'));
});

test('CLI batch-convert reads JSON array from stdin and exits 1 on partial failure', async () => {
  const { stdout, code } = await run(
    ['batch-convert', '--to', 'raw_upc_a_full'],
    JSON.stringify(['036000291452', 'bad']),
  );
  const parsed = JSON.parse(stdout);
  assert.equal(parsed[0].ok, true);
  assert.equal(parsed[1].ok, false);
  assert.equal(code, 1);
});

test('CLI errors on bad usage without crashing with a stack trace', async () => {
  const { stderr, code } = await run(['convert']);
  assert.equal(code, 1);
  assert.match(stderr, /usage/i);
});
