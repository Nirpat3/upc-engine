// UPC Engine HTTP Server
// Exposes the core engine over REST JSON endpoints for Web, .NET, iOS, and Android clients.
// Zero runtime dependencies -- uses Node.js native http module.

import http from 'node:http';
import { identify, toCanonical } from '../core.mjs';
import { applyProfile, reverseProfile, convertToProfile } from '../pipeline.mjs';
import { convertBatch, identifyBatch } from '../batch.mjs';
import { listProfiles, getProfile } from '../profiles.mjs';
import { detectProfileFromPairs, detectProfileFromDatabase } from '../detect.mjs';
import { setActiveProfile, getActiveProfile, listActiveProfiles, clearActiveProfile } from '../session.mjs';
import { decomposeAny, createBrandProfile, NUMBER_SYSTEM_MEANINGS } from '../decompose.mjs';
import { recordUpc, getUpcRecord, listUpcRecords, isDbConfigured } from '../db.mjs';
import { lookupGs1Country, isLatinAmericanGs1 } from '../gs1-country.mjs';

const PORT = process.env.PORT || 3842;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && pathname === '/') {
      sendJson(res, 200, {
        service: 'UPC Engine API',
        version: '0.1.0',
        endpoints: [
          'GET /api/profiles',
          'POST /api/identify',
          'POST /api/canonical',
          'POST /api/convert',
          'POST /api/decompose',
          'POST /api/batch/convert',
          'GET /api/country?code=...',
        ]
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/profiles') {
      sendJson(res, 200, { profiles: listProfiles() });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/country') {
      const code = url.searchParams.get('code');
      if (!code) {
        sendJson(res, 400, { error: 'Missing query parameter ?code=' });
        return;
      }
      const info = lookupGs1Country(code);
      sendJson(res, 200, info ?? { code, country: null, note: 'Unrecognized GS1 prefix' });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/identify') {
      const { code } = await parseBody(req);
      if (!code) {
        sendJson(res, 400, { error: 'Missing "code" in request body' });
        return;
      }
      sendJson(res, 200, identify(code));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/canonical') {
      const { code } = await parseBody(req);
      if (!code) {
        sendJson(res, 400, { error: 'Missing "code" in request body' });
        return;
      }
      sendJson(res, 200, toCanonical(code));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/convert') {
      const { code, profile, fromProfile } = await parseBody(req);
      if (!code || !profile) {
        sendJson(res, 400, { error: 'Missing "code" or "profile" in request body' });
        return;
      }
      if (fromProfile) {
        const canonical = reverseProfile(code, getProfile(fromProfile));
        const output = applyProfile(canonical, getProfile(profile));
        sendJson(res, 200, { input: code, from: fromProfile, to: profile, canonical, output });
      } else {
        sendJson(res, 200, { input: code, profile, output: applyProfile(toCanonical(code).canonical, getProfile(profile)) });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/decompose') {
      const { code, companyPrefixLength } = await parseBody(req);
      if (!code) {
        sendJson(res, 400, { error: 'Missing "code" in request body' });
        return;
      }
      const canonicalResult = toCanonical(code);
      if (!canonicalResult.canonical) {
        sendJson(res, 400, { error: `"${code}" did not canonicalize`, format: canonicalResult.format });
        return;
      }
      const opts = companyPrefixLength != null ? { companyPrefixLength: Number(companyPrefixLength) } : {};
      sendJson(res, 200, decomposeAny(canonicalResult, opts));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/batch/convert') {
      const { codes, to, from } = await parseBody(req);
      if (!Array.isArray(codes) || !to) {
        sendJson(res, 400, { error: 'Missing "codes" (array) or "to" (profile name) in request body' });
        return;
      }
      sendJson(res, 200, convertBatch(codes, { to, from }));
      return;
    }

    sendJson(res, 404, { error: 'Endpoint not found' });
  } catch (err) {
    sendJson(res, 400, { error: err.message, code: err.code || 'ERROR' });
  }
});

server.listen(PORT, () => {
  console.log(`UPC Engine HTTP server running on http://localhost:${PORT}`);
});
