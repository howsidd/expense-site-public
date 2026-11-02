// GET /api/binance -> { ok, qty: { BTC: 0.0021, USDT: 212.4, ... } }: live coin amounts across Spot, Funding and
// Simple Earn, so the Investments page doesn't wait for the nightly snapshot. Prices stay in the browser (app.js).
// Binance turns away Cloudflare's servers (403 by location), so this asks the binance-relay on Vercel in Mumbai
// (binance-relay/ in this repo), which holds the read-only key. Secrets here: BINANCE_RELAY_URL and RELAY_TOKEN.
// Without them it answers { ok: false } and the page keeps using the nightly snapshot.

export async function onRequestGet({ env }) {
  const json = (body) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  if (!env.BINANCE_RELAY_URL || !env.RELAY_TOKEN) return json({ ok: false, error: 'Binance relay not set up' });
  try {
    const res = await fetch(env.BINANCE_RELAY_URL, { headers: { 'X-Relay-Token': env.RELAY_TOKEN } });
    return json(await res.json());
  } catch (e) {
    return json({ ok: false, error: `relay: ${String(e.message || e)}` });
  }
}
