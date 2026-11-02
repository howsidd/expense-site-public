// GET /api/balances, header X-Relay-Token -> { ok, qty: { BTC: 0.0021, USDT: 212.4, ... } }
// Runs on Vercel in Mumbai (bom1) because Binance turns away Cloudflare's servers (403 by location). The site's
// /api/binance (Cloudflare Pages) calls this with the shared RELAY_TOKEN.
// Env: BINANCE_API_KEY, BINANCE_API_SECRET (a READ-ONLY key) and RELAY_TOKEN.
// ponytail: Futures and Margin wallets are left out; add their balance endpoints if you hold coins there.
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = 'https://api.binance.com';

async function signed(path, method = 'GET', params = {}) {
  const q = new URLSearchParams({ ...params, timestamp: Date.now(), recvWindow: 10000 }).toString();
  const sig = createHmac('sha256', process.env.BINANCE_API_SECRET).update(q).digest('hex');
  const res = await fetch(`${BASE}${path}?${q}&signature=${sig}`, { method, headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } });
  if (!res.ok) throw new Error(`Binance ${res.status} on ${path}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

const sameToken = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const want = process.env.RELAY_TOKEN || '';
  if (want.length < 32 || !sameToken(request.headers.get('x-relay-token') || '', want)) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) return json({ ok: false, error: 'Binance key not set up on the relay' });
  try {
    const [spot, funding, flexible, locked, walletList] = await Promise.all([
      signed('/api/v3/account', 'GET', { omitZeroBalances: 'true' }),
      signed('/sapi/v1/asset/get-funding-asset', 'POST'),
      signed('/sapi/v1/simple-earn/flexible/position', 'GET', { size: 100 }),
      signed('/sapi/v1/simple-earn/locked/position', 'GET', { size: 100 }),
      signed('/sapi/v1/asset/wallet/balance', 'GET', { quoteAsset: 'USDT' }),
    ]);
    // Every wallet's total in USDT (Spot, Funding, Futures, Earn, Bots...), to see where coins sit that qty misses.
    const wallets = Object.fromEntries((walletList || []).filter((w) => Number(w.balance) > 0).map((w) => [w.walletName, Number(w.balance)]));
    const qty = {};
    const add = (asset, n) => { n = Number(n) || 0; if (n > 0 && !/^LD/.test(asset)) qty[asset] = (qty[asset] || 0) + n; }; // LD* are old Savings receipts
    for (const b of spot.balances || []) add(b.asset, Number(b.free) + Number(b.locked));
    for (const b of funding || []) add(b.asset, Number(b.free) + Number(b.locked) + Number(b.freeze));
    for (const p of flexible.rows || []) add(p.asset, p.totalAmount);
    for (const p of locked.rows || []) add(p.asset, p.amount);
    return json({ ok: true, at: new Date().toISOString(), qty, wallets });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) });
  }
}
