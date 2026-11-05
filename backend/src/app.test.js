import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';

process.env.SUPABASE_URL = 'https://portfolio-tests.invalid';
process.env.SUPABASE_SERVICE_KEY = 'local-test-key';
process.env.RESEND_API_KEY = '';
process.env.FRONTEND_URL = 'https://portfolio.example';
process.env.FRONTEND_URL_WWW = '';

const { default: app } = await import('./app.js');
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeIdleConnections?.();
  });
});

test('allows configured and loopback frontend origins', async () => {
  for (const origin of [
    'https://portfolio.example',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
  ]) {
    const response = await fetch(`${baseUrl}/api/contact`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(response.status, 204, origin);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
});

test('rejects unknown origins without exposing internal error details', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Origin not allowed.' });
});

test('returns a client error for malformed JSON', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"name":',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON payload.' });
});

test('rejects oversized request bodies', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(12000) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Request body is too large.' });
});

test('validates every contact field before any persistence', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'A', email: 'invalid', message: 'short' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'Validation failed');
  assert.deepEqual(body.details.map((detail) => detail.field).sort(), ['email', 'message', 'name']);
});

test('serves health and preserves JSON not-found responses', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const missing = await fetch(`${baseUrl}/api/missing`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not found' });
});