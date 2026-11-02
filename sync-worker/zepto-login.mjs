// node zepto-login.mjs [out-dir] — one-time Zepto login for the Worker (see README, "Zepto orders").
// Opens Zepto's login page; you sign in with your phone and OTP. The login is saved straight into the Worker's
// secrets (ZEPTO_CLIENT_ID, ZEPTO_REFRESH_TOKEN) and never printed. Writes the MCP's tool list and your latest
// orders as JSON to out-dir (default: this folder) so the parser can be checked against real data.
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const AUTH = 'https://auth.zepto.co.in', MCP = 'https://mcp.zepto.co.in/mcp', RESOURCE = 'https://mcp.zepto.co.in';
// Zepto's firewall refuses 127.0.0.1 as a redirect, and a "scope" field in the registration.
const PORT = 8976, REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = process.env.ZEPTO_SCOPE || 'tools:read';
const out = process.argv[2] || '.';
const b64u = (b) => Buffer.from(b).toString('base64url');

const reg = await (await fetch(`${AUTH}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
  client_name: 'hdfc-sync (read order history)', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'], token_endpoint_auth_method: 'none' }) })).json();
if (!reg.client_id) throw new Error('registration failed: ' + JSON.stringify(reg));

const verifier = b64u(crypto.randomBytes(32)), state = b64u(crypto.randomBytes(12));
const url = `${AUTH}/authorize?` + new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, scope: SCOPE,
  state, resource: RESOURCE, code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });

const code = await new Promise((resolve, reject) => {
  const srv = http.createServer((req, res) => {
    const q = new URL(req.url, REDIRECT).searchParams;
    if (!req.url.startsWith('/callback')) return res.writeHead(404).end();
    res.end(q.get('code') ? 'Zepto connected. You can close this tab.' : `Login failed: ${q.get('error') || 'no code'}`);
    srv.close();
    q.get('state') === state && q.get('code') ? resolve(q.get('code')) : reject(new Error(q.get('error_description') || q.get('error') || 'bad callback'));
  }).listen(PORT, 'localhost', () => { console.log('Opening Zepto login in your browser...'); execFileSync('open', [url]); });
  setTimeout(() => { srv.close(); reject(new Error('timed out after 10 minutes')); }, 600e3).unref();
});

const tok = await (await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
  grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier, resource: RESOURCE }) })).json();
if (!tok.access_token) throw new Error('token exchange failed: ' + (tok.error_description || tok.error));
console.log('Logged in. Scope:', tok.scope || SCOPE, '| access token lasts', tok.expires_in, 's | refresh token:', tok.refresh_token ? 'yes' : 'NO');

// MCP over HTTP: JSON-RPC, answered as JSON or as one SSE event.
let session;
async function rpc(method, params, id = crypto.randomUUID()) {
  const res = await fetch(MCP, { method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream', ...(session && { 'Mcp-Session-Id': session }) }, body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id && { id }) }) });
  session = res.headers.get('mcp-session-id') || session;
  const text = await res.text();
  if (!id) return null;
  const json = res.headers.get('content-type')?.includes('event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() : text;
  return JSON.parse(json);
}
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hdfc-sync', version: '1' } });
await rpc('notifications/initialized', {}, null);
const tools = (await rpc('tools/list', {})).result?.tools || [];
writeFileSync(`${out}/zepto-tools.json`, JSON.stringify(tools, null, 2));
console.log('Tools:', tools.map((t) => t.name).join(', '));
const hist = tools.find((t) => /order/i.test(t.name) && /hist|list|past|get_orders/i.test(t.name)) || tools.find((t) => /order/i.test(t.name) && !/place|create|cancel|checkout/i.test(t.name));
if (hist) {
  const r = await rpc('tools/call', { name: hist.name, arguments: {} });
  writeFileSync(`${out}/zepto-orders.json`, JSON.stringify(r, null, 2));
  console.log(`Called ${hist.name}:`, r.error ? 'ERROR ' + JSON.stringify(r.error) : 'ok, saved zepto-orders.json');
  const first = r.result?.structuredContent?.orders?.[0];
  if (first) {
    writeFileSync(`${out}/zepto-order-detail.json`, JSON.stringify(await rpc('tools/call', { name: 'get_order_detail', arguments: { orderId: first.id } }), null, 2));
    console.log('Saved zepto-order-detail.json');
  }
}

// Save the login into the Worker. Values go through stdin, never the command line or the screen.
if (tok.refresh_token && process.env.ZEPTO_NO_SAVE !== '1') {
  for (const [k, v] of [['ZEPTO_CLIENT_ID', reg.client_id], ['ZEPTO_REFRESH_TOKEN', tok.refresh_token]]) {
    const r = spawnSync('npx', ['wrangler', 'secret', 'put', k], { input: v, encoding: 'utf8' });
    console.log(k, r.status === 0 ? 'saved to the Worker' : 'NOT saved: ' + r.stderr.split('\n').slice(-3).join(' '));
  }
}
