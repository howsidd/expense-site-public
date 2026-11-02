// Live value of the Binance coins you hold, ticking with Binance's own prices (one update a second per coin).
// Liveline is a React chart, so React comes along from esm.sh, loaded only once the Invest page opens;
// the rest of the site stays plain JS. app.js moves the one element below into each fresh render.
import { createElement as h } from "https://esm.sh/react@19.1.0";
import { createRoot } from "https://esm.sh/react-dom@19.1.0/client?deps=react@19.1.0";
import { Liveline } from "https://esm.sh/liveline@0.0.7?deps=react@19.1.0";

const WINDOWS = [{ label: "1m", secs: 60 }, { label: "5m", secs: 300 }, { label: "15m", secs: 900 }];
const host = Object.assign(document.createElement("div"), { className: "live-chart" });
let root, ws, retry, key = "", pts = [], px = {}, opt;

// coins: { BTC: qty, ... }. o: { rate (₹ per USDT), fmt (₹ → the page's currency, starred when private), color }.
export function show(coins, o) {
  opt = o;
  const k = Object.entries(coins).sort().join();
  if (k !== key) { stop(); key = k; start(coins, k); }
  draw();
  return host;
}
export function stop() { key = ""; clearTimeout(retry); ws?.close(); ws = null; }

// Every coin needs a price before the total means anything.
function value(coins) {
  let s = 0;
  for (const c in coins) { if (px[c] == null) return null; s += coins[c] * px[c]; }
  return s * opt.rate;
}

async function start(coins, k) {
  pts = []; px = {};
  const syms = Object.keys(coins);
  // The last 15 minutes of 1-second candles, so the chart opens with history instead of an empty line.
  const hist = await Promise.all(syms.map((c) => fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${c}USDT&interval=1s&limit=900`).then((r) => r.json()).catch(() => [])));
  if (k !== key) return;
  const at = {};
  hist.forEach((rows, i) => Array.isArray(rows) && rows.forEach((r) => ((at[r[0]] ||= {})[syms[i]] = +r[4])));
  for (const t of Object.keys(at).sort((a, b) => a - b)) {
    Object.assign(px, at[t]);
    const v = value(coins); if (v != null) pts.push({ time: t / 1000, value: v });
  }
  draw();
  connect(coins, k);
}

function connect(coins, k) {
  ws = new WebSocket("wss://data-stream.binance.vision/stream?streams=" + Object.keys(coins).map((c) => c.toLowerCase() + "usdt@miniTicker").join("/"));
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data).data; px[d.s.replace(/USDT$/, "")] = +d.c;
    const v = value(coins); if (v == null) return;
    pts.push({ time: Date.now() / 1000, value: v });
    if (pts.length > 2400) pts = pts.slice(-1800);
    draw();
  };
  ws.onclose = () => { if (k === key) retry = setTimeout(() => k === key && connect(coins, k), 3000); };
}

function draw() {
  root ||= createRoot(host);
  const last = pts.at(-1);
  root.render(h(Liveline, { data: pts.slice(), value: last ? last.value : 0, loading: !last, color: opt.color, theme: "light",
    pulse: false, formatValue: opt.fmt, windows: WINDOWS, windowStyle: "rounded" }));
}
