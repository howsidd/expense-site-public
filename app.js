// ₹ Dashboard. Reads /api/data (Notion), writes through /api/update. No framework, no build step.

// ---------- motion: Web Animations on transform and opacity only, so nothing re-lays out mid-flight ----------
// Reduce motion keeps the fades and drops the movement.
const EASE = "cubic-bezier(.2,.8,.2,1)", EASE_IN = "cubic-bezier(.4,0,1,1)";
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = () => matchMedia("(max-width:760px)").matches;
const els = (t) => (!t ? [] : t instanceof Element ? [t] : [...t]);
// Fade and lift in, one after another (the stagger is capped so long lists don't drag). An element already moving restarts cleanly.
function rise(targets, { stagger = 40, delay = 0, y = 10, ms = 420 } = {}) {
  const still = calm();
  return els(targets).map((el, i) => {
    for (const a of el.getAnimations()) a.cancel();
    return el.animate(still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: `0 ${y}px` }, { opacity: 1, translate: "0 0" }],
      { duration: still ? 200 : ms, delay: delay + Math.min(i * stagger, 320), easing: EASE, fill: "backwards" });
  });
}
// Fade out towards `to`, from wherever it is now. Holds the end until the element is removed or rises again.
function leave(targets, { to = "0 8px", ms = 180 } = {}) {
  return els(targets).map((el) => el.animate(calm() ? [{ opacity: 0 }] : [{ opacity: 0, translate: to }], { duration: ms, easing: EASE_IN, fill: "forwards" }));
}
// Below the fold: hidden until it scrolls into view, then it rises (and its bars grow). Returns a disconnect.
function reveal(targets) {
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); e.target.classList.remove("pending"); rise(e.target); grow(e.target); }
  }, { rootMargin: "0px 0px -6% 0px" });
  for (const el of targets) { el.classList.add("pending"); io.observe(el); }
  return () => { io.disconnect(); for (const el of targets) el.classList.remove("pending"); };
}
// Bars, columns and rings fill in from zero when their card first appears.
function grow(root) {
  if (calm()) return;
  const o = { duration: 700, easing: EASE, fill: "backwards" };
  root.querySelectorAll(".bar>span,.stackbar").forEach((el, i) => el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { ...o, delay: 80 + Math.min(i * 30, 240) }));
  root.querySelectorAll(".chart .col").forEach((el, i) => el.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { ...o, delay: 60 + i * 25 }));
  root.querySelectorAll(".donut>svg").forEach((el) => el.animate([{ opacity: 0, rotate: "-50deg" }, { opacity: 1, rotate: "0deg" }], { ...o, duration: 800 }));
  root.querySelectorAll(".chart-box>svg").forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { ...o, duration: 500, delay: 120 }));
}
// A changed value slides up into place (the faces trick without the blur, which repainted every frame).
function morphFace(el) {
  el.animate(calm() ? [{ opacity: 0.3 }, { opacity: 1 }] : [{ opacity: 0, translate: "0 0.35em" }, { opacity: 1, translate: "0 0" }], { duration: 260, easing: EASE });
}

// ---------- constants ----------
const CAT = {
  "Foods & Drinks": "#FF6B2C", "Home": "#2F7BFF", "Subscription": "#8B5CF6", "Transport": "#F2A900",
  "Personal Expense": "#EC4899", "Fitness & Diet": "#12B76A", "Business": "#14B8A6", "In Cash": "#7CC118", "Sweety": "#F43F5E",
  "Investing & Trading": "#6366F1", "Income": "#12B76A", "Savings": "#06B6D4", "Transfers": "#787774",
  "Unsorted": "#C3C2BF",
};
const CATEGORIES = Object.keys(CAT).filter((c) => c !== "Unsorted");
// Transfers is money moving between you and people (lending, being paid back, swapping cash with a friend):
// it moves the bank balance but is never spending or income.
const NON_SPEND = ["Investing & Trading", "Income", "Savings", "Transfers"];
const SPEND_CATS = CATEGORIES.filter((c) => !NON_SPEND.includes(c));
const PLATFORM = { Binance: "#F2A900", INDmoney: "#12B76A" }; // bank is blue #2F7BFF
// Platforms being closed: left out of every total, chart and snapshot.
const CLOSED = ["Coinbase"];
// Where a subscription is paid, and so where to cancel it. The first one a subscription has wins.
const PAY = {
  "App Store": { color: "#0A84FF", icon: "appstore", how: "On your iPhone: Settings → your name → Subscriptions." },
  "Google Pay": { color: "#1E8E3E", icon: "gpay", how: "In Google Pay: tap your photo → Autopay, then cancel the mandate." },
  "HDFC Card": { color: "#004C8F", icon: "card", how: "On the service’s own website or app. The HDFC card is only how it’s charged." },
  "Manual": { color: "#787774", icon: "cash", how: "You pay this by hand, so there’s nothing to cancel. Just don’t pay next time." },
};
const ASSET_TYPE = { Stablecoin: "#14B8A6", Crypto: "#8B5CF6", "Mutual fund": "#2F7BFF", Stock: "#EC4899", "US stock": "#6366F1", "Stocks & funds": "#12B76A" };
// Asset class names the nightly INDmoney sync writes, mapped onto ours.
const TYPE_ALIAS = { "Mutual Funds": "Mutual fund", "Indian Stocks": "Stock", "US Stocks": "US stock", "Crypto": "Crypto" };
// Cash categories always count as spending: cash isn't part of the bank balance.
const CASH = ["In Cash"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ICON = {
  home: [21, "M2.6 9.2 10.5 2.6l7.9 6.6v8.3a.9.9 0 0 1-.9.9h-4.4v-5.3H7.9v5.3H3.5a.9.9 0 0 1-.9-.9V9.2Z"],
  lines: [21, "M3.5 6.1h14M3.5 10.5h14M3.5 14.9h8.8"],
  trend: [21, "M2.6 15.8 7.9 10.5l3.9 3.1 6.6-7.5m0 0h-4.8m4.8 0v4.8"],
  goals: [21, "M10.5 19.3a8.8 8.8 0 1 0 0-17.6 8.8 8.8 0 0 0 0 17.6ZM10.5 15.8a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6ZM10.5 12.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z"],
  plus: [15, "M7.5 3.1v8.8M3.1 7.5h8.8"],
  lock: [18, "M5.5 8V5.8a3.5 3.5 0 0 1 7 0V8M4 8h10v7.5H4z"],
  eye: [16, "M1.3 8S3.7 3.3 8 3.3 14.7 8 14.7 8 12.3 12.7 8 12.7 1.3 8 1.3 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  eyeOff: [16, "M1.3 8S3.7 3.3 8 3.3 14.7 8 14.7 8 12.3 12.7 8 12.7 1.3 8 1.3 8ZM2 2l12 12"],
  refresh: [14, "M1.8 7a5.3 5.3 0 1 0 1.7-3.9L1.8 4.7M1.8 1.8v2.9h2.9"],
  left: [16, "M10 12 6 8l4-4"], right: [16, "M6 4l4 4-4 4"],
  search: [14, "M6.4 10.5a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2ZM11.7 11.7 9.6 9.6"],
  sparkle: [14, "M7 1.8v1.7M7 10.5v1.7M1.8 7h1.7M10.5 7h1.7M3.3 3.3l1.2 1.2M9.5 9.5l1.2 1.2M3.3 10.7l1.2-1.2M9.5 4.5l1.2-1.2"],
  pencil: [15, "M13.3 4.3a1.8 1.8 0 0 0-2.5-2.5L2.4 10.1l-.8 2.8.2.4.4.2 2.8-.8 8.3-8.4ZM9.4 3.1l2.5 2.5"],
  close: [14, "M3.5 3.5l7 7m0-7-7 7"],
  up: [13, "M6.5 10.3V2.7m3.8 3.8L6.5 2.7 2.7 6.5"], down: [13, "M6.5 2.7v7.6m-3.8-3.8 3.8 3.8 3.8-3.8"],
  warn: [15, "M13.6 11.3 8.6 2.5a1.3 1.3 0 0 0-2.2 0l-5 8.8a1.3 1.3 0 0 0 1.1 1.9h10a1.3 1.3 0 0 0 1.1-1.9ZM7.5 5.6v2.5m0 2.5h0"],
  wallet: [24, "M3 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3M16 13h2"],
  cart: [24, "M3 4h2l2.4 10.2a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.2L20 7H6M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01"],
  check: [24, "M5 12.5l4.5 4.5L19 7.5"],
  food: [24, "M6 3v8a2 2 0 0 0 4 0V3M8 11v10M17 3c-1.5 1.2-2 3-2 5s.6 3 2 3v10"],
  car: [24, "M5 16v2M19 16v2M4 13l1.6-4.4A2 2 0 0 1 7.5 7h9a2 2 0 0 1 1.9 1.6L20 13M4 13h16v3H4zM7 16h1M16 16h1"],
  cup: [24, "M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM16 9h2a2 2 0 0 1 0 4h-2M5 3v2M9 3v2M13 3v2"],
  bolt: [24, "M13 3 5 14h6l-1 7 8-11h-6z"],
  chart: [24, "M4 20V10M10 20V4M16 20v-7M22 20H2"],
  play: [24, "M4 5h16v12H4zM10 9l4 2.5-4 2.5zM8 20h8"],
  phone: [24, "M7 3h10v18H7zM10 18h4"],
  house: [24, "M4 11 12 4l8 7M6 10v10h12V10"],
  tag: [24, "M3 12V4h8l9 9-8 8-9-9zM7.5 7.5v.01"],
  swap: [24, "M4 8h13l-3-3M20 16H7l3 3"],
  pill: [24, "M8 3h8v18H8zM8 12h8"],
  music: [24, "M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-2.5-2.5H9M19 16a2.5 2.5 0 1 1-2.5-2.5H19"],
  appstore: [24, "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM8.5 16.5 12 8l3.5 8.5M9.7 13.5h4.6"],
  gpay: [24, "M19 12a7 7 0 1 1-2.05-4.95M19 12h-6"],
  card: [24, "M3 6h18v12H3zM3 10h18M7 15h3"],
  cash: [24, "M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 10v.01M18 14v.01"],
};
const ICON_RULES = [
  [/grocer|bigbasket|blinkit|zepto|instamart|dmart/i, "cart"], [/food|zomato|swiggy|restaurant|biryani|pizza/i, "food"],
  [/auto|rapido|uber|ola|cab|metro|petrol|fuel|irctc|train/i, "car"], [/electric|bescom|power|water|gas|lpg/i, "bolt"],
  [/tea|caf[ée]|coffee|starbucks|tokai/i, "cup"], [/sip|invest|zerodha|groww|binance|coinbase|indmoney|mutual/i, "chart"],
  [/netflix|prime|hotstar|youtube|stream/i, "play"], [/spotify|music|audio/i, "music"], [/mobile|postpaid|airtel|jio|recharge/i, "phone"],
  [/salary|payout|income|refund|cashback/i, "wallet"], [/rent|house|maid|home/i, "house"], [/transfer|self|neft/i, "swap"],
  [/pharm|medic|apollo|hospital/i, "pill"],
];

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Hide numbers swaps every amount for stars when the page is drawn, so nothing readable is left underneath.
const STARS = "₹****";
// The Investments page reads in US dollars (Binance holds USDT), at Coinbase's live USD→INR rate. Values stay ₹ underneath.
const usd = () => (S.route === "investments" && S.cur === "usd" && S.fx) || 0;
const inr = (n, dp = 0) => S.private ? STARS : (n < 0 ? "−" : "") + (usd() ? "$" + Math.abs(n / usd()).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const amt = (n, dp = 0, cls = "", key) => `<span class="amt num ${cls}"${key ? ` data-m="${key}"` : ""}>${inr(n, dp)}</span>`;
const short = (n) => S.private ? "****" : usd() ? ((v) => v >= 1e6 ? "$" + +(v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + +(v / 1e3).toFixed(1) + "k" : "$" + Math.round(v))(n / usd()) : (n >= 1e7 ? "₹" + +(n / 1e7).toFixed(1) + "Cr" : n >= 1e5 ? "₹" + +(n / 1e5).toFixed(1) + "L" : n >= 1e3 ? "₹" + +(n / 1e3).toFixed(0) + "k" : "₹" + Math.round(n));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const mask = (s) => S.private ? String(s).replace(/(₹|Rs\.?)\s?[\d,]+(\.\d+)?/g, STARS) : s;
const qty = (q) => S.private ? "****" : q.toLocaleString("en-IN", { maximumFractionDigits: 8 });
const share = (a, b) => { const p = b ? (a / b) * 100 : 0; return p > 0 && p < 1 ? "<1%" : Math.round(p) + "%"; };
const icon = (name, size) => { const [vb, d] = ICON[name]; return `<svg width="${size || vb}" height="${size || vb}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="${vb === 24 ? 1.7 : 1.6}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`; };
const tint = (hex) => hex + "1f";
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dayKey(new Date());
const monthKey = (k) => k.slice(0, 7);
const addMonths = (mk, n) => { let [y, m] = mk.split("-").map(Number); m += n; y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1; return `${y}-${pad(m)}`; };
const monthLabel = (mk) => { const [y, m] = mk.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const dayLabel = (k) => { const [y, m, d] = k.split("-").map(Number); return `${WD[new Date(y, m - 1, d).getDay()]}, ${d} ${MON[m - 1]}`; };
const shortDay = (k) => { const [, m, d] = k.split("-").map(Number); return `${d} ${MON[m - 1]}`; };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
// Transfers (cash swaps with friends and family: UPI for cash, or paying someone back) is stored under that name, which
// the Worker and the routines write, and shown as "Exchange".
const catName = (c) => (c === "Transfers" ? "Exchange" : c);
const chip = (text, kind = "") => `<span class="chip ${kind ? "chip--" + kind : ""}">${text}</span>`;
const tag = (cat) => cat ? `<span class="tag" style="background:${tint(CAT[cat] || "#C3C2BF")}"><i style="background:${CAT[cat] || "#C3C2BF"}"></i>${esc(catName(cat))}</span>` : `<span class="tag tag--empty">Choose category</span>`;
const iconFor = (t) => { const s = `${t.title} ${t.payee} ${t.note}`; const hit = ICON_RULES.find(([re]) => re.test(s)); return hit ? hit[1] : "tag"; };
const txTile = (t) => { const c = CAT[t.category] || "#9B9A97"; return `<span class="tile" style="background:${tint(c)};color:${c}">${icon(iconFor(t), 18)}</span>`; };
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// Wait for animations, but never longer than they should take: browsers pause them in hidden tabs.
const done = (anims) => Promise.race([Promise.allSettled(anims.map((a) => a.finished)), new Promise((r) => setTimeout(r, 700))]);

// ---------- state ----------
const S = {
  live: null, D: null, loading: true, error: null, month: null, route: "overview",
  q: "", type: "all", cats: new Set(), sel: new Set(), prices: {}, pricesAt: 0,
  private: ls.get("private") === "1", cur: ls.get("cur") || "usd",
};

// ---------- data ----------
// The last data this browser saw paints the page instantly; fresh data from Notion replaces it quietly.
const CACHE = "data-v1";
// The saved copy paints at once only while it's under 10 minutes old: an older one flashed yesterday's numbers and then
// jumped. Offline, loadData falls back to it at any age, under the "Couldn't reach Notion" banner.
function fromCache(anyAge) {
  try { const j = JSON.parse(localStorage.getItem(CACHE)); if (!j?.transactions || (!anyAge && !(Date.now() - Date.parse(j.syncedAt) < 10 * 6e4))) return false;
    S.live = j; S.D = derive(j); S.month = S.D.defaultMonth; return true; }
  catch { return false; }
}
async function loadData(quiet, retried) {
  S.loading = true; if (!quiet) { S.error = null; render(); }
  try {
    // The first load uses the request index.html already started; later ones (Refresh, retries) ask again.
    const early = window.early; window.early = null;
    const r = await (early || fetch("/api/data"));
    if (r.status === 401) return location.reload(); // signed out (30 days passed, or the password changed): show the lock page
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    try { localStorage.setItem(CACHE, JSON.stringify(j)); } catch {}
    S.live = j; S.D = derive(j); S.error = null;
    if (!S.month || !S.D.monthKeys.includes(S.month)) S.month = S.D.defaultMonth;
    // Live prices before the first paint, so numbers don't jump a moment after the page appears.
    if (!quiet && !S.pricesAt) await Promise.race([loadPrices(false, true), new Promise((r) => setTimeout(r, 1200))]);
  } catch (e) {
    // Notion fails now and then for a moment. With data already on screen, try once more quietly before raising the banner.
    if (S.live && !retried) { setTimeout(() => loadData(true, true), 8000); return; }
    if (!S.live) fromCache(true);
    S.error = String(e.message || e);
  }
  S.loading = false; quiet ? renderQuiet() : render();
  loadPrices();
  if (S.D && !S.error) autoFile();
}

// Files the review items the model is sure of, as "Auto-filed" (see them under that tab; editing one confirms it).
let autoFiling = false;
async function autoFile() {
  if (autoFiling) return;
  const groups = {}, add = (c, id) => { if (!Object.values(groups).some((g) => g.includes(id))) (groups[c] ||= []).push(id); };
  // A friend paying you back: the credit takes the payment's category (Transfers when that was a loan or still
  // unsorted, else "paid back" for that category), so it's never counted as income.
  for (const [cid, d] of Object.entries(S.D.pairs)) {
    const c = S.D.tx.find((x) => x.id === cid); if (!c || !(c.review || c.auto)) continue;
    const loan = d.review || d.auto || !d.category || d.category === "Transfers" || d.category === "In Cash";
    if (loan && (d.review || d.auto) && d.category !== "Transfers") add("Transfers", d.id);
    add(loan ? "Transfers" : d.category, c.id);
  }
  for (const t of S.D.tx) { const l = t.review && S.D.autoFor(t); if (l) add(l.cat, t.id); }
  const ids = Object.values(groups).flat(); if (!ids.length) return;
  autoFiling = true;
  for (const t of S.live.transactions) for (const [c, g] of Object.entries(groups)) if (g.includes(t.id)) Object.assign(t, { category: c, status: "Auto-filed" });
  S.D = derive(S.live); renderQuiet(); toast(`${ids.length} filed for you. Check them under Auto-filed`);
  try { for (const [c, g] of Object.entries(groups)) for (let i = 0; i < g.length; i += 50) await api({ action: "bulk", pageIds: g.slice(i, i + 50), category: c, auto: true }); }
  catch (e) { toast("Could not save: " + e.message); }
  autoFiling = false;
}

// What counts: Income credits are income; spending is debits outside the non-spend categories (cash always counts);
// a confirmed credit filed under a spending category is money paid back (a friend covering dinner) and lowers it.
const isSpend = (t) => t.type === "Debit" && !NON_SPEND.includes(t.category) && (CASH.includes(t.category) || !t.exclude);
const isPayback = (t) => t.type === "Credit" && !t.review && !t.exclude && SPEND_CATS.includes(t.category) && !CASH.includes(t.category);
// A pay-back only cancels spending in its own category: ₹704 back for Personal Expense can't wipe out food and travel.
function tally(list) {
  let income = 0; const cats = {};
  for (const t of list) {
    if (t.type === "Credit" && t.category === "Income") income += t.amount;
    // Waiting for review counts as Unsorted, not as its guessed category (usually Personal Expense), so category budgets
    // only hold what you've filed. It is still money spent, so it stays in the month's total.
    if (isSpend(t)) { const c = t.review || !t.category ? "Unsorted" : t.category; cats[c] = (cats[c] || 0) + t.amount; }
    if (isPayback(t)) cats[t.category] = (cats[t.category] || 0) - t.amount;
  }
  for (const c in cats) if (cats[c] <= 0) delete cats[c];
  return { income, cats, spent: Object.values(cats).reduce((a, b) => a + b, 0) };
}
const daysIn = (y, m) => new Date(y, m, 0).getDate();
// Next charge on or after today: Notion's date only moves when the sync spots the charge, and App Store or
// Google Pay charges rarely carry the service's name, so roll it forward a cycle at a time.
function nextCharge(date, cycle) {
  if (!date) return null;
  let [y, m, d] = date.slice(0, 10).split("-").map(Number), k = date.slice(0, 10);
  for (let g = 0; k < today() && g < 400; g++) { if (cycle === "Yearly") y++; else if (++m > 12) { m = 1; y++; } k = `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`; }
  return k;
}

// Naive Bayes over what you've confirmed: payee, words in the name and note, amount size, time of day, account.
// Every review retrains it. A suggestion only counts as "learned" when it's sure (80%+) and a payee or word you've
// filed at least twice points mostly (80%+) at that category, so a common word like "UPI" never decides alone.
// ponytail: retrains on every load, fine for a few thousand rows.
const words = (s) => String(s || "").toLowerCase().match(/[a-z]{3,}/g) || [];
function feats(t) {
  const key = [...new Set([t.payee && "p:" + t.payee.toLowerCase(), ...words(t.entry).map((w) => "w:" + w), ...words(t.note).map((w) => "n:" + w)].filter(Boolean))];
  const f = [...key, "a:" + Math.round(Math.log2((t.amount || 0) + 1)), "s:" + (t.source || "")];
  if (t.payee) f.push(key[0], key[0]); // the payee is the strongest signal, so it counts three times
  if (t.time) f.push("h:" + Math.floor(+t.time.slice(0, 2) / 3));
  return { f, key };
}
function trainModel(rows) {
  const m = {}, vocab = new Set(); // type -> category -> { n, total, f: { feature: count } }
  for (const t of rows) {
    const c = ((m[t.type] ||= {})[t.category] ||= { n: 0, total: 0, f: {} }); c.n++;
    for (const x of feats(t).f) { c.f[x] = (c.f[x] || 0) + 1; c.total++; vocab.add(x); }
  }
  const V = vocab.size + 1;
  return (t) => {
    const cats = m[t.type]; if (!cats) return null;
    const N = Object.values(cats).reduce((s, c) => s + c.n, 0), { f, key } = feats(t);
    const sc = Object.entries(cats).map(([cat, c]) => [cat, Math.log(c.n / N) + f.reduce((s, x) => s + Math.log(((c.f[x] || 0) + 1) / (c.total + V)), 0)]);
    const top = Math.max(...sc.map((s) => s[1])), z = sc.reduce((s, [, v]) => s + Math.exp(v - top), 0);
    const seen = (c, x) => (c.f[x] || 0) / (x[0] === "p" ? 3 : 1);
    return sc.map(([cat, v]) => {
      // n: how many times you filed this payee or word here, counted only if it mostly lands here.
      const n = Math.max(0, ...key.map((x) => { const all = Object.values(cats).reduce((s, c) => s + seen(c, x), 0), mine = seen(cats[cat], x); return mine / (all || 1) >= 0.8 ? mine : 0; }));
      return { cat, p: Math.exp(v - top) / z, n };
    }).sort((a, b) => b.p - a.p);
  };
}

// Your latest choice for each payee. One correction changes the first suggestion next time, and while the model's
// favourite disagrees with it nothing is filed without you (the model needs two more rows to change its mind).
function lastPicks(rows) {
  const last = {};
  for (const t of [...rows].sort((a, b) => atMs(a.date || "") - atMs(b.date || ""))) if (t.payee) last[t.type + "|" + t.payee] = t.category;
  return (t) => (t.payee && last[t.type + "|" + t.payee]) || null;
}

// How often the model is right: each of your last `max` reviews is hidden in turn and guessed from all the others.
// `sure` counts the guesses it would offer as "learned" (80%+), `auto` the ones it would file by itself (90%+).
// ponytail: retrains once per row, O(n²); fine for a few hundred rows, subtract one row's counts if it gets slow.
function evalModel(rows, max = 300) {
  const R = { n: 0, top: 0, sure: 0, sureOk: 0, auto: 0, autoOk: 0 };
  for (const t of rows.slice(-max)) {
    const r = trainModel(rows.filter((x) => x !== t))(t)?.[0]; if (!r) continue;
    const ok = r.cat === t.category; R.n++; R.top += ok;
    if (r.p >= 0.8 && r.n >= 2) { R.sure++; R.sureOk += ok; }
    if (r.p >= 0.9 && r.n >= 2) { R.auto++; R.autoOk += ok; }
  }
  return R;
}

// Bank balance = the latest balance you checked (typed in, or a statement's closing balance) plus every bank
// transaction after it, minus those between a past day and that moment. Only rows with a bank Ref ID count:
// "manual-" ones are cash or bookkeeping. A date-only check means the end of that day (statement closing balance).
const atMs = (d) => new Date(d.length > 10 ? d : d + "T23:59:59+05:30").getTime();
function bankBalance(anchor, txs) {
  if (!anchor) return null;
  const a = atMs(anchor.date), bank = txs.filter((t) => t.refId && !/^manual-/.test(t.refId) && t.amount)
    .map((t) => ({ ms: atMs(t.date), v: (t.type === "Credit" ? 1 : -1) * Math.abs(t.amount) }));
  const at = (ms) => bank.reduce((s, t) => s + (t.ms > a && t.ms <= ms ? t.v : t.ms > ms && t.ms <= a ? -t.v : 0), anchor.bank);
  return { at, since: bank.filter((t) => t.ms > a).length, anchor };
}

// Paid back: a credit from the same person, for the same amount (within ₹1), up to 45 days after a payment to them.
// Returns the pairs (credit id -> debit). ponytail: O(n²) scan, fine for a year of rows.
function lending(tx) {
  const pairs = {}, used = new Set(), asc = [...tx].sort((a, b) => atMs(a.date) - atMs(b.date));
  for (const c of asc) {
    if (c.type !== "Credit" || !c.payee) continue;
    const d = asc.find((d) => d.type === "Debit" && !used.has(d.id) && d.payee === c.payee && Math.abs(d.amount - c.amount) <= 1 && atMs(d.date) < atMs(c.date) && atMs(c.date) - atMs(d.date) <= 45 * 864e5);
    if (d) { used.add(d.id); pairs[c.id] = d; }
  }
  return pairs;
}


function derive(live) {
  const all = (live.transactions || []).map((t) => {
    let day = t.date.slice(0, 10), time = "";
    if (t.date.length > 10) { const d = new Date(t.date); if (!isNaN(d)) { day = dayKey(d); time = `${pad(d.getHours())}:${pad(d.getMinutes())}`; } }
    return { ...t, amount: Math.abs(t.amount || 0), day, time, month: monthKey(day), title: t.entry || t.payee || "Transaction", review: t.status === "Needs review" || !t.category, auto: t.status === "Auto-filed" };
  }).filter((t) => !(t.exclude && !t.amount)) // originals of split transactions are zeroed and excluded
    .sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time));
  // Hide ₹1-style round trips: a tiny credit and debit of the same amount with the same person within an hour.
  const hidden = new Set(), tiny = all.filter((t) => t.amount > 0 && t.amount <= 10);
  for (const a of tiny) {
    if (a.type !== "Credit" || hidden.has(a.id)) continue;
    const b = tiny.find((b) => b.type === "Debit" && !hidden.has(b.id) && b.amount === a.amount && Math.abs(new Date(b.date) - new Date(a.date)) <= 3600e3 && (!a.payee || !b.payee || a.payee === b.payee));
    if (b) { hidden.add(a.id); hidden.add(b.id); }
  }
  // Goal "Add money" rows (Savings, note "Goal: <name>") belong to the Goals page: its history, not your transactions.
  const isGoal = (t) => t.category === "Savings" && /^Goal: /.test(t.note || "");
  const tx = all.filter((t) => !hidden.has(t.id) && !isGoal(t));

  const months = {};
  const M = (k) => (months[k] ||= { income: 0, spent: 0, cats: {}, tx: [] });
  for (const t of tx) M(t.month).tx.push(t);
  for (const m of Object.values(months)) Object.assign(m, tally(m.tx));
  const cur = monthKey(today());
  M(cur);
  const monthKeys = Object.keys(months).sort();
  const defaultMonth = months[cur].tx.length || !monthKeys.length ? cur : monthKeys[monthKeys.length - 1];

  // Snapshots: carry the last known values forward so gaps don't read as drops. "Investments" is what the
  // nightly INDmoney sync writes; Binance is its own column, so the total is both.
  const days = new Map();
  for (const s of live.snapshots || []) {
    const k = s.date.slice(0, 10), p = days.get(k);
    if (!p) { days.set(k, { ...s, date: k }); continue; }
    const m = { ...p };
    for (const f of ["bank", "investments", "binance", "coinbase", "indmoney"]) if (s[f] != null) m[f] = s[f];
    if (s.holdings?.length) m.holdings = s.holdings;
    if (s.insights) { m.insights = s.insights; m.id = s.id; }
    days.set(k, m);
  }
  // Coinbase is being closed, so it's left out of every point and the history stays like for like.
  let bank = null, inv = null, bin = null;
  const snaps = [...days.values()].map((s) => {
    if (s.bank != null) bank = s.bank; if (s.investments != null) inv = s.investments; if (s.binance != null) bin = s.binance;
    const total = inv == null && bin == null ? null : (inv || 0) + (bin || 0);
    return { ...s, holdings: (s.holdings || []).filter((h) => !CLOSED.includes(h.platform)), bankC: bank, invC: total, full: s.binance != null };
  });
  // The synced "Bank balance" was a running sum that drifted (any missed alert stayed in it), so once you've checked
  // a balance, every point is recounted from it.
  const bal = bankBalance([...(live.snapshots || [])].filter((s) => s.checked && s.bank != null).sort((x, y) => atMs(x.date) - atMs(y.date)).pop(), all);
  if (bal) for (const s of snaps) s.bankC = bal.at(atMs(s.date.slice(0, 10)));

  const budgets = {};
  for (const b of live.budgets || []) if (b.category && b.category !== "Savings goal") budgets[b.category] = { id: b.id, amount: b.amount || 0 };

  const contributions = all.filter(isGoal);
  const goals = (live.goals || []).map((g) => {
    const target = g.target || 0, saved = g.saved || 0, left = Math.max(0, target - saved);
    const monthsLeft = g.deadline ? Math.max(1, Math.ceil(daysBetween(today(), g.deadline) / 30.4)) : null;
    const need = monthsLeft ? Math.ceil(left / monthsLeft) : null;
    const mine = contributions.filter((c) => c.note === "Goal: " + g.name);
    const recent = mine.filter((c) => daysBetween(c.day, today()) <= 92).reduce((s, c) => s + c.amount, 0) / 3;
    // Without any Add money history we can't judge pace, so don't call it "Behind".
    const status = g.status === "Paused" ? "Paused" : saved >= target && target ? "Reached" : !need ? "No deadline" : !mine.length ? "Active" : recent >= need ? "On track" : "Behind";
    return { ...g, target, saved, left, monthsLeft, need, recent, hasHistory: mine.length > 0, status };
  });

  // "Ending" runs until its date and doesn't renew; "Watch" means the sync expected a charge and saw none.
  const subs = (live.subscriptions || []).filter((s) => s.status !== "Cancelled" && !(s.status === "Ending" && s.nextDue && s.nextDue.slice(0, 10) < today()))
    .map((s) => ({ ...s, paidVia: s.paidVia || [], due: s.status === "Ending" ? s.nextDue?.slice(0, 10) : nextCharge(s.nextDue, s.cycle),
      monthly: (s.amount || 0) / (s.cycle === "Yearly" ? 12 : 1), where: Object.keys(PAY).find((k) => (s.paidVia || []).includes(k)) || null }))
    .sort((a, b) => String(a.due || "9").localeCompare(String(b.due || "9")));

  // What the review tab taught: a classifier trained on every transaction you've confirmed.
  // Only what you confirmed trains it: its own guesses (Auto-filed) would just teach it its mistakes.
  const confirmed = tx.filter((t) => !t.review && !t.auto && t.category && t.amount);
  const rank = trainModel(confirmed), last = lastPicks(confirmed);
  const learnedFor = (t) => { const r = rank(t)?.[0], l = last(t); return r && r.p >= 0.8 && r.n >= 2 && (!l || l === r.cat) ? r : null; };
  // Filed without asking: surer still. Anything less stays in To review.
  // A small credit is often a friend paying you back, so Income is only filed for you when it's big (salary-sized)
  // or this payee's credits were confirmed as Income at least twice.
  const incomeFrom = (p) => tx.filter((x) => x.type === "Credit" && x.payee === p && x.category === "Income" && !x.review && !x.auto).length;
  // Income only files itself from someone who has paid you twice before. A big credit from anyone else (INDmoney paying
  // out, a bounced IMPS coming back, your own money from Binance) waits for you: Sep 2026 showed ₹16.8 lakh "income" that way.
  const autoFor = (t) => { const r = learnedFor(t); return r && r.p >= 0.9 && (r.cat !== "Income" || incomeFrom(t.payee) >= 2) ? r : null; };
  const pairs = lending(tx);

  return { tx, months, monthKeys, defaultMonth, snaps, budgets, goals, subs, contributions, isSpend, learnedFor, autoFor, rank, last, confirmed, bal, pairs };
}

// Latest snapshot values, with holdings revalued at live prices when available.
function portfolio() {
  const D = S.D; if (!D) return null;
  // INDmoney holdings come from the nightly Holdings Snapshots table; other platforms from snapshot text.
  const ind = (S.live.indHoldings || []).map((h) => ({ ...h, type: TYPE_ALIAS[h.type] || h.type }));
  const snap = [...D.snaps].reverse().find((s) => s.holdings && s.holdings.some((h) => !ind.length || h.platform !== "INDmoney")) || null;
  let fromSnap = (snap ? snap.holdings : []).filter((h) => (!ind.length || h.platform !== "INDmoney") && !CLOSED.includes(h.platform));
  // Live Binance amounts (/api/binance, read-only key) replace the snapshot's; the snapshot still carries each coin's cost.
  // Sold some: the cost shrinks in proportion (average cost). Bought more: the cost is unknown until tonight's snapshot
  // records it, so that coin shows no gain rather than counting the new coins as profit.
  if (S.binLive) {
    const old = fromSnap.filter((h) => h.platform === "Binance");
    fromSnap = [...fromSnap.filter((h) => h.platform !== "Binance"), ...Object.entries(S.binLive).map(([asset, qty]) => {
      const o = old.find((h) => h.asset === asset);
      if (!o) return { platform: "Binance", asset, type: asset === "USDT" ? "Stablecoin" : "Crypto", value: 0, qty };
      const f = o.qty ? qty / o.qty : 1, kept = f <= 1.0001;
      return { ...o, qty, investedUsdt: o.investedUsdt != null && kept ? o.investedUsdt * f : null, invested: o.invested != null && kept ? o.invested * f : null };
    })];
  }
  // If the Holdings Snapshots table can't be read, fall back to the nightly INDmoney total on the snapshot.
  if (!ind.length && !fromSnap.some((h) => h.platform === "INDmoney")) {
    const last = [...D.snaps].reverse().find((s) => s.investments != null);
    if (last) ind.push({ platform: "INDmoney", asset: "INDmoney portfolio", type: "Stocks & funds", qty: 0, value: last.investments, invested: null, date: last.date.slice(0, 10) });
  }
  const holdings = [...fromSnap, ...ind].map((h) => {
    const price = S.prices[h.asset];
    const value = price && h.qty ? h.qty * price : h.value;
    // Binance coins: cost recorded in USDT, turned into ₹ at the same live USDT rate as the value, so only the coin's own move shows as gain.
    const invested = h.investedUsdt != null && S.prices.USDT ? h.investedUsdt * S.prices.USDT : h.invested;
    return { ...h, value, invested, live: !!price };
  }).sort((a, b) => b.value - a.value);
  const total = holdings.length ? holdings.reduce((s, h) => s + h.value, 0) : (snap?.investments ?? [...D.snaps].reverse().find((s) => s.investments != null)?.investments ?? 0);
  const byPlatform = {}; for (const h of holdings) byPlatform[h.platform] = (byPlatform[h.platform] || 0) + h.value;
  const byType = {}; for (const h of holdings) byType[h.type] = (byType[h.type] || 0) + h.value;
  // Gain only on holdings with a real cost: INDmoney reports its own, Binance coins carry the cost of their trades.
  // Stablecoins are cash and have none. Never inferred from balance changes or bank transactions: both made up gains.
  const platforms = Object.entries(byPlatform).sort((a, b) => b[1] - a[1]).map(([p, value]) => {
    const hs = holdings.filter((h) => h.platform === p && h.invested != null);
    const invested = hs.length ? hs.reduce((s, h) => s + h.invested, 0) : null;
    return { p, value, invested, pnl: invested != null ? hs.reduce((s, h) => s + h.value, 0) - invested : null,
      untracked: holdings.filter((h) => h.platform === p && h.invested == null && h.type !== "Stablecoin").map((h) => h.asset) };
  });
  const known = platforms.filter((x) => x.invested != null);
  const pnl = known.reduce((s, x) => s + x.pnl, 0);
  return { snap, holdings, total, byPlatform, byType, platforms, known, pnl, live: holdings.some((h) => h.live) };
}

async function loadPrices(force, silent) {
  if (!S.D || (!force && Date.now() - S.pricesAt < 5 * 60e3)) return;
  const live = await fetch("/api/binance").then((r) => r.json()).catch(() => null);
  if (live?.ok) S.binLive = live.qty;
  const p = portfolio(); if (!p || !p.holdings.length) return;
  // Coins at Binance's own USDT prices (Coinbase's INR prices for small coins were off by 1000x), times Coinbase's USDT→INR.
  const coins = [...new Set(p.holdings.filter((h) => h.type === "Crypto").map((h) => h.asset))];
  const get = (u) => fetch(u).then((r) => r.json()).catch(() => null);
  let [usdt, fx, bin] = await Promise.all([get("https://api.coinbase.com/v2/prices/USDT-INR/spot"), get("https://api.coinbase.com/v2/exchange-rates?currency=USD"),
    coins.length ? get(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(coins.map((c) => c + "USDT")))}`) : []]);
  const rate = Number(usdt?.data?.amount);
  // One coin with no USDT pair (dust) fails the whole batch, so then ask coin by coin.
  if (coins.length && !Array.isArray(bin)) bin = (await Promise.all(coins.map((c) => get(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${c}USDT`)))).filter((t) => t?.symbol);
  if (rate) { S.prices.USDT = rate; for (const t of Array.isArray(bin) ? bin : []) S.prices[t.symbol.replace(/USDT$/, "")] = Number(t.price) * rate; }
  S.fx = Number(fx?.data?.rates?.INR) || S.fx;
  S.pricesAt = Date.now();
  if (!silent && (S.route === "investments" || S.route === "overview")) renderQuiet();
}

async function api(body) {
  const r = await fetch("/api/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 401) { location.reload(); throw new Error("you were signed out"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (r.status >= 500 ? "the server didn’t answer, try again in a moment" : "HTTP " + r.status));
  return j;
}
// The primary button that started a save morphs to "Saving" until Notion answers.
function busy() {
  const el = S.pressed; S.pressed = null;
  if (!el || !el.classList.contains("btn--primary") || !el.closest("dialog")) return () => {};
  const from = el.innerHTML; el.innerHTML = "Saving"; morphFace(el); el.disabled = true;
  return () => { if (el.isConnected) { el.innerHTML = from; morphFace(el); el.disabled = false; } };
}
// After a write, pull fresh data quietly a moment later; several quick edits share one reload.
let syncTimer;
const syncSoon = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => loadData(true), 2500); };
async function save(body, msg) {
  const undo = busy();
  try { await api(body); closeAll(); toast(msg); syncSoon(); }
  catch (e) { undo(); toast("Could not save: " + e.message); }
}
async function saveMany(bodies, msg) {
  const undo = busy();
  try { for (const b of bodies) await api(b); closeAll(); toast(msg); syncSoon(); }
  catch (e) { undo(); toast("Could not save: " + e.message); syncSoon(); }
}
// Transaction edits show instantly; Notion is updated in the background and rolled back if it fails.
function quick(body, ids, patch, msg) {
  const txs = (S.live.transactions || []).filter((t) => ids.includes(t.id)), before = txs.map((t) => ({ ...t }));
  txs.forEach((t) => Object.assign(t, patch, patch.confirm ? { status: "Confirmed" } : {}));
  S.D = derive(S.live); closeAll(); render(); toast(msg);
  api(body).then(syncSoon, (e) => { txs.forEach((t, i) => Object.assign(t, before[i])); S.D = derive(S.live); render(); toast("Could not save: " + e.message); });
}

// ---------- charts: every one shows its values under the cursor, or on tap ----------
let CH = [], SPECS = []; // hover handlers, and chart drawers for the current render
// A chart is a fixed-height box; drawCharts() fills it with an SVG at the box's real width (no stretching).
const chartBox = (draw, h) => `<div class="chart-box" data-c="${SPECS.push(draw) - 1}" style="height:${h}px"></div>`;
function drawCharts(root = document) {
  for (const box of root.querySelectorAll(".chart-box")) {
    const W = Math.max(140, Math.round(box.clientWidth));
    if (!box.dataset.watched) { box.dataset.watched = "1"; sizes.observe(box); }
    if (+box.dataset.w === W) continue;
    box.dataset.w = W; box.innerHTML = SPECS[+box.dataset.c](W);
  }
}
let redraw; const sizes = new ResizeObserver(() => { cancelAnimationFrame(redraw); redraw = requestAnimationFrame(() => drawCharts()); });
const tipRow = (color, name, value) => `<div class="tip-row"><i style="background:${color}"></i><span>${esc(name)}</span><b class="amt">${value}</b></div>`;
const tipBox = (title, rows) => `${title ? `<div class="tip-title">${esc(title)}</div>` : ""}${rows.join("")}`;
const tipAttr = (html) => ` data-tip="${esc(html)}"`;
// Crosshair + one dot per series, then a transparent hit area on top that owns the pointer.
const hoverLayer = (colors, W, H) => `<g class="hv" style="display:none"><line y1="0" y2="${H}" stroke="#C3C2BF" stroke-dasharray="2 3"/>${colors.map((c) => `<circle r="4.5" fill="${c}" stroke="#fff" stroke-width="2"/>`).join("")}</g><rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`;

// A small area line from zero up, with the last point marked; values under the cursor like every chart.
function spark(vals, color, labels = [], name = "", W = 120, H = 44) {
  if (vals.length < 2) { vals = [vals[0] || 0, vals[0] || 0]; labels = [labels[0] || "", labels[0] || ""]; }
  const mx = Math.max(...vals), mn = Math.min(0, ...vals), r = mx - mn || 1, n = vals.length;
  const X = (i) => 5 + (i * (W - 10)) / (n - 1), Y = (v) => H - 3 - ((v - mn) / r) * (H - 10);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const id = CH.push({ W, x0: 5, pw: W - 10, n, pts: [vals.map((v, i) => [X(i), Y(v)])], tip: (i) => tipBox(labels[i], [tipRow(color, name, inr(vals[i]))]) }) - 1;
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-chart="${id}" aria-hidden="true"><path d="${d} L${X(n - 1)} ${H} L${X(0)} ${H} Z" fill="${color}" opacity=".1"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${X(n - 1)}" cy="${Y(vals[n - 1])}" r="3.5" fill="${color}" stroke="#fff" stroke-width="2"/>${hoverLayer([color], W, H)}</svg>`;
}
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
const lineChart = (o) => chartBox((W) => lineSvg({ ...o, W }), (o.H || 200) + 24);
function lineSvg({ series, labels, tipLabels = labels, tip, W, H = 200 }) {
  const YW = 44, pw = W - YW - 8, n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.vals)));
  const x = (i) => YW + (n < 2 ? pw / 2 : (i * pw) / (n - 1)), y = (v) => H - (v / max) * H;
  let g = "";
  for (let k = 0; k <= 4; k++) { const v = (max * k) / 4; g += `<line x1="${YW}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="#E9E9E7" ${k ? 'stroke-dasharray="2 4"' : ""}/><text x="0" y="${y(v) + 4}">${short(v)}</text>`; }
  const step = Math.max(1, Math.ceil(n / 6));
  labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H + 18}" text-anchor="middle">${esc(l)}</text>`; });
  for (const s of series) {
    const pts = s.vals.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
    if (s.fill) g += `<path d="M${pts.join(" L")} L${x(n - 1)} ${H} L${x(0)} ${H} Z" fill="${s.color}" opacity="${s.opacity || 0.16}"/>`;
    g += `<path d="M${pts.join(" L")}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="4 4"' : ""}/>`;
    if (n) g += `<circle cx="${x(n - 1)}" cy="${y(s.vals[n - 1])}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"/>`;
  }
  const id = CH.push({ W, x0: YW, pw, n, pts: series.map((s) => s.vals.map((v, i) => [x(i), y(v)])),
    tip: tip || ((i) => tipBox(tipLabels[i], series.map((s) => tipRow(s.color, s.name || "", inr(s.vals[i]))))) }) - 1;
  return `<svg class="chart amt" width="${W}" height="${H + 24}" viewBox="0 0 ${W} ${H + 24}" role="img" data-chart="${id}">${g}${hoverLayer(series.map((s) => s.color), W, H + 24)}</svg>`;
}
const cashChart = (rows, H = 190) => chartBox((W) => cashSvg(rows, W, H), H + 24);
function cashSvg(rows, W, H) {
  const YW = 44, pw = W - YW - 36, max = niceMax(Math.max(1, ...rows.flatMap((r) => [r.income, r.spent]))), slot = pw / rows.length, bw = Math.min(22, slot / 3);
  const y = (v) => H - (v / max) * H;
  let g = "", hits = "";
  for (let k = 0; k <= 2; k++) { const v = (max * k) / 2; g += `<line x1="${YW}" x2="${YW + pw}" y1="${y(v)}" y2="${y(v)}" stroke="#E9E9E7" ${k ? 'stroke-dasharray="2 4"' : ""}/><text x="0" y="${y(v) + 4}">${short(v)}</text><text x="${W}" y="${H - (k / 2) * H + 4}" text-anchor="end" style="fill:#8B5CF6">${k * 50}%</text>`; }
  const pts = [];
  rows.forEach((r, i) => {
    const cx = YW + i * slot + slot / 2, saved = r.income - r.spent;
    g += `<rect class="col" x="${cx - bw - 2}" y="${y(r.income)}" width="${bw}" height="${H - y(r.income)}" rx="5" fill="#12B76A"/><rect class="col" x="${cx + 2}" y="${y(r.spent)}" width="${bw}" height="${H - y(r.spent)}" rx="5" fill="#FF6B2C"/><text x="${cx}" y="${H + 18}" text-anchor="middle">${r.label}</text>`;
    if (r.income) pts.push([cx, H - Math.max(0, Math.min(1, saved / r.income)) * H]);
    hits += `<rect class="slot" x="${YW + i * slot}" y="0" width="${slot}" height="${H + 24}" fill="transparent"${tipAttr(tipBox(r.full || r.label, [tipRow("#12B76A", "Income", inr(r.income)), tipRow("#FF6B2C", "Spent", inr(r.spent)), tipRow("#191919", "Saved", inr(saved)), ...(r.income ? [tipRow("#8B5CF6", "Savings rate", pct(saved, r.income) + "%")] : [])]))}/>`;
  });
  if (pts.length > 1) g += `<path d="M${pts.map((p) => p.join(" ")).join(" L")}" fill="none" stroke="#8B5CF6" stroke-width="2"/>`;
  g += pts.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="4" fill="#8B5CF6" stroke="#fff" stroke-width="2"/>`).join("");
  return `<svg class="chart amt" width="${W}" height="${H + 24}" viewBox="0 0 ${W} ${H + 24}" role="img">${g}${hits}</svg>`;
}
function donut(segs, size, center) {
  const total = segs.reduce((s, x) => s + x.v, 0) || 1, r = size / 2 - 12, C = 2 * Math.PI * r;
  let off = 0, arcs = "";
  for (const s of segs) { const len = (s.v / total) * C; arcs += `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${s.c}" stroke-width="22" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-off}"${s.n ? tipAttr(tipBox(s.n, [tipRow(s.c, share(s.v, total), inr(s.v))])) : ""}/>`; off += len; }
  if (!segs.length) arcs = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="#F1F1EF" stroke-width="22"/>`;
  return `<div class="donut" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" style="transform:rotate(-90deg)">${arcs}</svg><div class="c">${center}</div></div>`;
}
function ring(p, color, size = 104, tip = "") {
  const r = size / 2 - 8, C = 2 * Math.PI * r, len = Math.min(1, p) * C;
  return `<div class="donut" style="width:${size}px;height:${size}px"${tip ? tipAttr(tip) : ""}><svg width="${size}" height="${size}" style="transform:rotate(-90deg)"><circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${tint(color)}" stroke-width="14"/><circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${len} ${C}"/></svg><div class="c"><span class="money-m">${Math.round(p * 100)}%</span></div></div>`;
}
const bar = (p, color, thick, tip) => `<div class="bar ${thick ? "thick" : ""}"${tip ? tipAttr(tip) : ""}><span style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%;background:${color}"></span></div>`;
// One segment of a stacked bar, with its own tooltip.
const segment = (w, color, name, value, total) => `<span style="width:${w}%;background:${color}"${tipAttr(tipBox(name, [tipRow(color, share(value, total), inr(value))]))}></span>`;

// ---------- shared pieces ----------
function header(title, voice, actions, primary = "") {
  return `<header class="head"><div class="head-t"><h1 class="hello" data-m="title">${title}</h1><p class="voice" data-m="voice">${voice}</p></div><div class="wrap actions">${actions}</div>${primary ? `<div class="head-p">${primary}</div>` : ""}</header>`;
}
const primaryBtn = (a, label, x = "") => `<button class="btn btn--primary" data-a="${a}"${x ? ` data-x="${x}"` : ""} aria-label="${label}">${icon("plus")}<span class="txt">${label}</span></button>`;
function stepper() {
  const i = S.D.monthKeys.indexOf(S.month), first = i <= 0, last = i >= S.D.monthKeys.length - 1;
  return `<div class="seg"><button aria-label="Previous month" data-a="month" data-x="-1" ${first ? "disabled" : ""}>${icon("left")}</button><button class="on" data-m="month">${MON[+S.month.slice(5) - 1]} ${S.month.slice(0, 4)}</button><button aria-label="Next month" data-a="month" data-x="1" ${last ? "disabled" : ""}>${icon("right")}</button></div>`;
}
const privacyBtn = () => `<button class="btn privacy ${S.private ? "on" : ""}" data-a="privacy" aria-label="${S.private ? "Show numbers" : "Hide numbers"}"><span class="row" style="gap:6px" data-m="privacy">${icon(S.private ? "eyeOff" : "eye")}<span class="txt">${S.private ? "Show numbers" : "Hide numbers"}</span></span></button>`;
const refreshBtn = () => `<button class="btn btn--icon" data-a="refresh" aria-label="Refresh">${icon("refresh")}</button>`;
const synced = () => S.live ? `<span class="meta hide-sm" data-m="synced">Synced ${new Date(S.live.syncedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>` : "";
function errorBanner() {
  const notion = S.error ? `<div class="banner rise"><span style="color:var(--yellow)">${icon("warn", 18)}</span><div class="grow"><div class="strong">Couldn’t reach Notion</div><div class="meta" style="color:var(--ink)">${/\b5\d\d\b/.test(S.error) ? "Notion’s servers are having trouble right now. Your data is fine; try again in a few minutes" : esc(S.error)}. ${S.live ? "Showing what loaded last." : ""}</div></div><button class="btn btn--primary" data-a="refresh">Try again</button></div>` : "";
  return notion + healthBanner();
}
// What the sync Worker's health check says has stopped (functions/api/health.js): one banner per problem, under every
// page's title, until it's fixed. "Bank sync: not working for 3 hours (...)" -> "Bank sync needs a look" + the rest.
const healthBanner = () => (S.health || []).map((p) => { const i = p.indexOf(": ");
  return `<div class="banner rise"><span style="color:var(--yellow)">${icon("warn", 18)}</span><div class="grow"><div class="strong">${esc(i > 0 ? p.slice(0, i) : "Sync")} needs a look</div><div class="meta" style="color:var(--ink)">${esc((i > 0 ? p.slice(i + 2) : p).replace(/^./, (c) => c.toUpperCase()))}</div></div></div>`; }).join("");
async function loadHealth() {
  try { const r = await fetch("/api/health"); if (r.ok) { S.health = (await r.json()).problems || []; renderQuiet(); } } catch {}
}
function skeleton() {
  const bone = (w, h, cls = "") => `<span class="skel ${cls}" style="width:${w};height:${h}px"></span>`;
  const card = (rows) => `<div class="card stack" style="gap:12px">${bone("40%", 14)}${Array.from({ length: rows }, () => `<div class="row">${bone("36px", 36)}<div class="stack grow" style="gap:6px">${bone("70%", 12)}${bone("40%", 10)}</div></div>`).join("")}</div>`;
  return `<div class="head"><div class="stack" style="gap:12px">${bone("280px", 32, "dark")}${bone("360px", 18, "dark")}</div></div>
    <div class="grid g3">${[1, 2, 3].map(() => `<div class="card stack" style="gap:10px">${bone("30%", 12)}${bone("55%", 30)}${bone("40%", 14)}</div>`).join("")}</div>
    <div class="grid g3">${card(5)}${card(4)}${card(5)}</div>`;
}
function txRow(t) {
  return `<button class="tx" data-a="edit" data-x="${t.id}">${txTile(t)}<div class="grow"><div class="row"><span class="name ellip">${esc(t.title)}</span>${t.review ? chip("Review", "yellow") : ""}</div><div class="meta ellip">${esc(t.category || "Choose a category")}${t.source ? " · " + esc(t.source) : ""}</div></div><div style="text-align:right;flex:none"><div class="strong num">${t.type === "Credit" ? `<span class="amt pos">+${inr(t.amount)}</span>` : amt(t.amount)}</div><div class="meta">${t.time || shortDay(t.day)}</div></div></button>`;
}

// A Notion table the site's connection can't see comes back as a warning; say so plainly instead of "nothing here".
const unshared = (name) => (S.live?.warnings || []).some((w) => w.startsWith(name));
const shareNote = (table) => `<div class="stack" style="gap:6px"><span class="strong">Notion isn’t sharing “${table}” with this site</span><span class="meta" style="color:var(--ink)">In Notion, open ${table}, then ••• → Connections → add “expense-site”. It shows up here on the next refresh.</span></div>`;

// ---------- subscriptions: where each is paid, so you know where to go to cancel ----------
const payBadge = (k, size = 26) => { const p = PAY[k]; return p ? `<span class="pay" style="width:${size}px;height:${size}px;background:${tint(p.color)};color:${p.color}"${tipAttr(tipBox("Paid via " + k, [`<div class="tip-note">${esc(p.how)}</div>`]))}>${icon(p.icon, Math.round(size * 0.6))}</span>` : ""; };
function dueChip(s) {
  if (!s.due) return s.where === "Manual" ? chip("By hand", "line") : "";
  const n = daysBetween(today(), s.due), when = n === 0 ? "today" : n === 1 ? "tomorrow" : n < 7 ? `in ${n} days` : shortDay(s.due);
  if (s.status === "Ending") return chip("Ends " + when, "line");
  if (s.status === "Watch") return `<span${tipAttr(tipBox("No charge seen", [`<div class="tip-note">The sync expected a charge and didn’t find one. Check it’s still running.</div>`]))}>${chip("Check", "yellow")}</span>`;
  return chip(when, n <= 3 ? "yellow" : "line");
}
const subRow = (s) => `<button class="list-row sub-row" data-a="subs"><div class="pays">${s.paidVia.length ? s.paidVia.map((k) => payBadge(k)).join("") : `<span class="pay pay--none">?</span>`}</div><div class="grow" style="min-width:0"><div class="ellip strong" style="font-weight:500;font-size:15px">${esc(s.name)}</div><div class="meta ellip">${s.where ? (s.where === "Manual" ? "Paid by hand" : "Cancel: " + s.where) : "Not set"}${s.cycle === "Yearly" ? " · yearly" : ""}</div></div>${dueChip(s)}<span class="strong" style="min-width:52px;text-align:right">${amt(s.amount || 0)}</span></button>`;

// ---------- overview ----------
function overview() {
  const D = S.D, m = D.months[S.month], prevM = D.months[addMonths(S.month, -1)];
  const budgetTotal = Object.values(D.budgets).reduce((s, b) => s + b.amount, 0);
  // Only spending in categories that have a budget counts against the budget.
  const budgeted = Object.keys(D.budgets).reduce((s, c) => s + (m.cats[c] || 0), 0);
  const left = budgetTotal - budgeted;
  const voice = budgetTotal ? (left >= 0 ? `${amt(left)} left in this month’s budget` : `${amt(-left)} over this month’s budget`) : m.tx.length ? `${m.tx.length} transactions so far` : "Nothing logged this month yet";
  const review = m.tx.filter((t) => t.review).length;
  const actions = `${synced()}${stepper()}${review ? `<a class="btn" href="#/transactions" data-a="reviewOnly">${chip(review, "yellow")} to review</a>` : ""}${privacyBtn()}${refreshBtn()}`;
  const monthEnd = S.month + "-31";
  const last6 = Array.from({ length: 6 }, (_, i) => addMonths(S.month, i - 5));
  // Cash flow starts at the first month that has any money in or out, so empty months don't eat the width.
  const firstData = last6.findIndex((k) => D.months[k] && (D.months[k].income || D.months[k].spent));
  const cfMonths = last6.slice(Math.max(0, Math.min(firstData < 0 ? 0 : firstData, last6.length - 3)));
  const val = (k, f) => (D.months[k] ? D.months[k][f] : 0);

  // Bank balance: counted from the last balance you checked, at the end of the month shown (or now). The last 12 days
  // ending there make the sparkline. Without a checked balance there's nothing true to show.
  const B = D.bal, endMs = Math.min(Date.now(), atMs(addMonths(S.month, 1) + "-01") - 1);
  const bDays = Array.from({ length: 12 }, (_, i) => dayKey(new Date(endMs - (11 - i) * 864e5)));
  const bNow = B && B.at(endMs), bWeek = B && B.at(endMs - 7 * 864e5);
  // The current month is compared with the same days of last month: on 1 Oct, against 1 Sep, not all of September.
  const prevK = addMonths(S.month, -1), live = S.month === monthKey(today()), dom = +today().slice(8);
  const before = tally((D.months[prevK]?.tx || []).filter((t) => !live || +t.day.slice(8) <= dom));
  const vs = live ? `vs ${Math.min(dom, new Date(+prevK.slice(0, 4), +prevK.slice(5), 0).getDate())} ${MON[+prevK.slice(5) - 1]}` : "vs " + MONTHS[+prevK.slice(5) - 1];
  // Spending going up is the bad direction; for income and the bank balance it's the good one.
  const diff = (now, was, upIsBad) => { const d = now - was; if (Math.abs(d) < 0.5) return chip("Same");
    return chip(`${d > 0 ? "↑" : "↓"} ${inr(Math.abs(d))}`, (d > 0) === !upIsBad ? "green" : upIsBad ? "late" : ""); };
  const sparkLabels = last6.map((k) => monthLabel(k) + (k === monthKey(today()) ? " so far" : ""));
  const kpi = (o) => `<button class="card kpi rise" style="--c:${o.color}" data-a="${o.a}" data-x="${o.x || ""}" aria-label="${o.label}: ${o.go}"><div class="between"><div class="row" style="gap:8px"><span class="tile" style="width:26px;height:26px;border-radius:8px;background:${tint(o.color)};color:${o.color}">${icon(o.icn, 14)}</span><span class="label">${o.label}</span></div><span class="kpi-go meta">${o.go}${icon("right", 14)}</span></div>
    <div class="money-l">${o.value}</div><div class="row" style="gap:8px;min-height:24px">${o.change}<span class="meta ellip">${o.meta}</span></div>${chartBox((W) => spark(o.vals, o.color, o.labels, o.label, W, 52), 52)}</button>`;
  const stats = `<div class="grid kpis">
    ${kpi({ label: "Income", color: "#12B76A", icn: "down", a: "show", x: "income", go: "See income", value: amt(m.income, 0, "", "income"), change: diff(m.income, before.income), meta: vs, vals: last6.map((k) => val(k, "income")), labels: sparkLabels })}
    ${kpi({ label: "Spent", color: "#FF6B2C", icn: "up", a: "show", x: "spent", go: "See spending", value: amt(m.spent, 0, "", "spent"), change: diff(m.spent, before.spent, true), meta: vs, vals: last6.map((k) => val(k, "spent")), labels: sparkLabels })}
    ${kpi({ label: "Bank balance", color: "#2F7BFF", icn: "wallet", a: "snapshot", go: B ? "Correct it" : "Enter it", value: B ? amt(bNow, 2, "", "bank") : `<span style="color:var(--faint)">Enter your balance</span>`,
      change: B ? diff(bNow, bWeek) : "", meta: B ? `in 7 days · from ${inr(B.anchor.bank)} on ${shortDay(B.anchor.date.slice(0, 10))}` : "Type what your bank app shows, once",
      vals: B ? bDays.map((d) => B.at(atMs(d))) : [], labels: bDays.map(dayLabel) })}
  </div>`;

  // Net worth + cash flow
  const nw = D.snaps.filter((s) => s.full && s.bankC != null).slice(-60); // same definition of "investments" on every point
  const nwNow = nw.length ? (nw[nw.length - 1].bankC || 0) + (nw[nw.length - 1].invC || 0) : 0;
  // One day of complete data can't make a line: show what today's net worth is made of instead.
  const nwSplit = (s) => { if (!s) return `<p class="meta">Log a snapshot to start tracking net worth.</p>`;
    const parts = [["Bank", s.bankC, "#2F7BFF"], ["Binance", s.binance, PLATFORM.Binance], ["INDmoney", s.investments, PLATFORM.INDmoney]].filter((x) => x[1]);
    const t = parts.reduce((a, x) => a + x[1], 0);
    return `<div class="stackbar" style="height:12px;border-radius:6px;margin:6px 0 14px">${parts.map(([n, v, c]) => segment((v / t) * 100, c, n, v, t)).join("")}</div>
      <div class="stack" style="gap:8px">${parts.map(([n, v, c]) => `<div class="row"><i style="width:8px;height:8px;border-radius:50%;background:${c}"></i><span class="grow">${n}</span><span class="strong">${amt(v)}</span><span class="meta" style="width:40px;text-align:right">${share(v, t)}</span></div>`).join("")}</div>
      <p class="meta" style="margin:auto 0 0;padding-top:14px">The history line starts once there are two days of complete snapshots (from ${shortDay(s.date)}).</p>`; };
  const nwFirst = nw.length ? (nw[0].bankC || 0) + (nw[0].invC || 0) : 0;
  const netWorth = `<div class="card rise"><div class="card-h"><div><h2 class="card-title">Net worth</h2><div class="sub">Bank balance plus investments, from your snapshots</div></div>${nw.length > 1 ? `<div class="legend"><span><b style="background:#2F7BFF"></b>Bank</span><span><b style="background:#12B76A"></b>Investments</span></div>` : ""}</div>
    <div class="row" style="gap:10px;margin-bottom:12px"><span class="money-l">${amt(nwNow, 0, "", "nw")}</span>${nw.length > 1 ? chip(`${nwNow >= nwFirst ? "↑" : "↓"} <span class="amt">${inr(Math.abs(nwNow - nwFirst))}</span>`, nwNow >= nwFirst ? "green" : "") + `<span class="meta">since ${shortDay(nw[0].date)}</span>` : ""}</div>
    ${nw.length > 1 ? lineChart({ labels: nw.map((s) => shortDay(s.date)), series: [{ vals: nw.map((s) => s.bankC + s.invC), color: "#12B76A", fill: true }, { vals: nw.map((s) => s.bankC), color: "#2F7BFF", fill: true, opacity: 0.22 }],
      tip: (i) => tipBox(dayLabel(nw[i].date.slice(0, 10)), [tipRow("#12B76A", "Investments", inr(nw[i].invC)), tipRow("#2F7BFF", "Bank", inr(nw[i].bankC)), tipRow("#191919", "Net worth", inr(nw[i].bankC + nw[i].invC))]) }) : nwSplit(nw[nw.length - 1])}</div>`;
  const saved = m.income - m.spent;
  const cashFlow = `<div class="card rise"><div class="card-h"><div><h2 class="card-title">Cash flow</h2><div class="sub">Money in against money out, ${cfMonths.length === 6 ? "last 6 months" : "since " + MONTHS[+cfMonths[0].slice(5) - 1]}</div></div><div class="legend"><span><b style="background:#12B76A"></b>Income</span><span><b style="background:#FF6B2C"></b>Spent</span><span><b style="background:#8B5CF6;height:2px;vertical-align:3px"></b>Savings rate</span></div></div>
    <div class="row" style="gap:10px;margin-bottom:12px"><span class="money-l">${amt(saved, 0, "", "saved")}</span><span class="meta">saved in ${MONTHS[+S.month.slice(5) - 1]}</span>${m.income ? chip(pct(saved, m.income) + "% savings rate", "purple") : ""}</div>
    ${cashChart(cfMonths.map((k) => ({ label: MON[+k.slice(5) - 1], full: monthLabel(k), income: val(k, "income"), spent: val(k, "spent") })))}</div>`;

  // Spending by category
  const cats = Object.entries(m.cats).sort((a, b) => b[1] - a[1]);
  const spending = `<div class="card rise"><div class="card-h"><h2 class="card-title">Spending by category</h2>${chip(MON[+S.month.slice(5) - 1], "line")}</div>
    ${cats.length ? `<div class="row" style="gap:24px;align-items:center;flex-wrap:wrap">${donut(cats.map(([c, v]) => ({ c: CAT[c] || "#C3C2BF", v, n: c })), 168, `<span class="money-m">${amt(m.spent, 0, "", "donut")}</span><span class="meta">Spent</span>`)}
      <div class="stack grow" style="gap:2px;min-width:220px">${cats.map(([c, v]) => `<button class="tx" style="min-height:34px;padding:4px 8px" data-a="filterCat" data-x="${esc(c)}"><i style="width:8px;height:8px;border-radius:50%;background:${CAT[c] || "#C3C2BF"}"></i><span class="grow ellip">${esc(catName(c))}</span><span class="strong">${amt(v)}</span><span class="meta" style="width:34px;text-align:right">${pct(v, m.spent)}%</span></button>`).join("")}</div></div>`
      : `<div class="empty">No spending logged for ${MONTHS[+S.month.slice(5) - 1]}.</div>`}</div>`;

  // Budgets
  const bcats = SPEND_CATS.filter((c) => D.budgets[c] || m.cats[c]).map((c) => ({ c, s: m.cats[c] || 0, b: D.budgets[c]?.amount || 0 })).sort((a, b) => (b.b ? b.s / b.b : 2) - (a.b ? a.s / a.b : 2));
  const budgets = `<div class="card rise"><div class="card-h"><h2 class="card-title">Budgets</h2><div class="row" style="gap:8px">${budgetTotal ? chip(pct(budgeted, budgetTotal) + "% used", budgeted > budgetTotal ? "yellow" : "green") : ""}<button class="btn btn--icon" data-a="budgets" aria-label="Edit budgets">${icon("pencil")}</button></div></div>
    ${budgetTotal ? `<div class="row" style="gap:8px;align-items:baseline"><span class="money-l">${amt(budgeted, 0, "", "budgeted")}</span><span>of ${amt(budgetTotal)}</span></div>
      <div class="stackbar" style="margin:10px 0 8px">${bcats.filter((x) => x.b && x.s).map((x) => segment(Math.min(100, (x.s / budgetTotal) * 100), CAT[x.c], x.c, x.s, budgetTotal)).join("")}</div>
      <div class="meta">${left >= 0 ? `${amt(left)} left` : `${amt(-left)} over`}</div><div class="divider"></div>` : `<p class="meta">No budgets yet. Tap the pencil to set one per category.</p>`}
    <div class="stack" style="gap:14px">${bcats.map((x) => `<div class="stack" style="gap:8px"><div class="between"><span class="ellip">${esc(x.c)}</span><span class="row" style="gap:8px">${x.b && x.s > x.b ? chip("Over", "yellow") : ""}<span class="meta">${amt(x.s)}${x.b ? " of " + amt(x.b) : ", no budget"}</span></span></div>${bar(x.b ? x.s / x.b : 0, CAT[x.c], false, tipBox(x.c, [tipRow(CAT[x.c], "Spent", inr(x.s)), ...(x.b ? [tipRow("#C3C2BF", "Budget", inr(x.b)), tipRow("#191919", x.s > x.b ? "Over by" : "Left", inr(Math.abs(x.b - x.s)))] : [])]))}</div>`).join("")}</div></div>`;

  // Insights, worked out here from the same numbers as the rest of the page (the nightly routine's text went stale and
  // disagreed with it). The first four that apply: budget pace, the category most over budget, what's still unsorted,
  // this month against the same days of last month, and a category well above its usual month.
  const points = [];
  const daysLeft = live ? daysIn(+S.month.slice(0, 4), +S.month.slice(5)) - dom + 1 : 0;
  if (budgetTotal) points.push(left < 0 ? `${inr(-left)} over the month's budget${daysLeft ? ` with ${daysLeft} day${daysLeft > 1 ? "s" : ""} left` : ""}.`
    : daysLeft ? `${inr(left)} left in the budget: about ${inr(left / daysLeft)} a day for the ${daysLeft} day${daysLeft > 1 ? "s" : ""} left.` : `Finished ${inr(left)} under budget.`);
  const worst = bcats.filter((x) => x.b && x.s > x.b).sort((a, b) => b.s - b.b - (a.s - a.b))[0];
  if (worst) points.push(`${worst.c} is ${inr(worst.s - worst.b)} over its ${inr(worst.b)} budget.`);
  if (m.cats.Unsorted) points.push(`${inr(m.cats.Unsorted)} is still Unsorted. File the ${review} to review to see where it went.`);
  const was = live ? before.spent : prevM?.spent;
  if (was) points.push(`Spending is ${pct(Math.abs(m.spent - was), was)}% ${m.spent >= was ? "higher" : "lower"} than ${live ? "by this day last month" : "last month"} (${inr(m.spent)} against ${inr(was)}).`);
  const usual = (c) => [1, 2, 3].reduce((t, n) => t + (D.months[addMonths(S.month, -n)]?.cats[c] || 0), 0) / 3;
  const jump = SPEND_CATS.map((c) => [c, (m.cats[c] || 0) - usual(c), usual(c)]).filter(([, d, u]) => u && d > 1000 && d > u * 0.3).sort((a, b) => b[1] - a[1])[0];
  if (jump) points.push(`${jump[0]} is ${inr(jump[1])} above its usual ${inr(jump[2])} a month.`);
  const dots = ["#FF6B2C", "#2F7BFF", "#8B5CF6", "#12B76A", "#EC4899"];
  const insights = `<div class="card rise"><div class="card-h"><div class="row" style="gap:8px"><span style="color:var(--muted)">${icon("chart")}</span><h2 class="card-title">Insights</h2></div></div><div class="stack" style="gap:10px">${points.length ? points.slice(0, 4).map((p, i) => `<div class="row" style="align-items:flex-start"><i style="width:6px;height:6px;border-radius:50%;background:${dots[i % 5]};margin-top:7px;flex:none"></i><span>${esc(mask(p))}</span></div>`).join("") : `<p class="meta">Insights appear once there is some activity.</p>`}</div></div>`;

  // Investments summary
  const P = portfolio();
  const investments = `<div class="card rise"><div class="card-h"><div class="row" style="gap:8px"><span style="color:#12B76A">${icon("trend", 16)}</span><h2 class="card-title">Investments</h2></div>${P.live ? chip("Live prices", "green") : P.snap ? chip(shortDay(P.snap.date), "line") : ""}</div>
    <div class="money-l">${amt(P.total, 0, "", "invsum")}</div>
    <div class="stack" style="gap:10px;margin-top:14px">${Object.entries(P.byPlatform).sort((a, b) => b[1] - a[1]).map(([p, v]) => `<div class="stack" style="gap:6px"><div class="between"><span>${esc(p)}</span><span class="meta">${amt(v)} · ${share(v, P.total)}</span></div>${bar(v / P.total, PLATFORM[p] || "#9B9A97", false, tipBox(p, [tipRow(PLATFORM[p] || "#9B9A97", share(v, P.total), inr(v))]))}</div>`).join("")}</div>
    <a class="btn btn--block" style="margin-top:16px" href="#/investments">See full analysis</a></div>`;

  // Subscriptions
  const subTotal = D.subs.reduce((s, x) => s + x.monthly, 0);
  const subs = `<div class="card rise" style="padding-bottom:12px"><div class="card-h"><div><h2 class="card-title">Subscriptions</h2><div class="sub">${D.subs.length} active · icons show where to cancel</div></div><button class="btn" data-a="subs">See all</button></div>
    ${D.subs.length ? D.subs.slice(0, 7).map(subRow).join("") : `<p class="meta">No active subscriptions.</p>`}
    <div class="between" style="padding-top:12px;border-top:1px solid var(--line)"><span style="color:var(--sub)">Every month${D.subs.some((x) => x.cycle === "Yearly") ? ", yearly ones spread out" : ""}</span><span class="money-m">${amt(subTotal)}</span></div></div>`;

  // Goals
  const goals = `<div class="card rise"><div class="card-h"><h2 class="card-title">Savings goals</h2>${unshared("Savings Goals") ? "" : `<button class="btn" data-a="goalForm">${icon("plus")}Add goal</button>`}</div>
    <div class="stack" style="gap:16px">${D.goals.length ? D.goals.map((g, i) => `<div class="stack" style="gap:8px"><div class="between"><span class="ellip">${esc(g.name)}</span><span class="meta">${g.deadline ? "by " + MON[+g.deadline.slice(5, 7) - 1] + " " + g.deadline.slice(0, 4) : ""}</span></div>${bar(g.target ? g.saved / g.target : 0, dots[(i + 1) % 5], false, tipBox(g.name, [tipRow(dots[(i + 1) % 5], "Saved", inr(g.saved)), tipRow("#C3C2BF", "Target", inr(g.target)), tipRow("#191919", "Left", inr(Math.max(0, g.target - g.saved)))]))}<div class="between meta"><span>${amt(g.saved)} of ${amt(g.target)}</span><span>${pct(g.saved, g.target)}%</span></div></div>`).join("") : unshared("Savings Goals") ? shareNote("Savings Goals") : `<p class="meta">No goals yet.</p>`}</div>
    ${D.goals.length ? `<a class="btn btn--block" style="margin-top:16px" href="#/goals">Open goals</a>` : ""}</div>`;

  // Recent
  const recent = `<div class="card rise" style="padding:20px 8px 8px"><div class="card-h" style="padding:0 12px"><h2 class="card-title">Recent transactions</h2><a class="meta" href="#/transactions">${m.tx.length} this month</a></div>
    ${m.tx.length ? m.tx.slice(0, 7).map(txRow).join("") : `<div class="empty">Nothing logged for ${MONTHS[+S.month.slice(5) - 1]} yet.<br><br><button class="btn btn--primary" data-a="addTx">${icon("plus")}Add transaction</button></div>`}
    ${m.tx.length > 7 ? `<div style="padding:8px 12px 12px"><a class="btn btn--block" href="#/transactions">View all</a></div>` : ""}</div>`;

  return header(monthLabel(S.month), voice, actions, primaryBtn("addTx", "Add")) + errorBanner() + stats + `<div class="grid g2">${netWorth}${cashFlow}</div>` +
    `<div class="grid g-main"><div class="stack">${spending}${budgets}</div><div class="stack">${insights}${investments}${subs}</div><div class="stack">${goals}${recent}</div></div>`;
}

// ---------- transactions ----------
function transactions() {
  const D = S.D, m = D.months[S.month];
  const review = m.tx.filter((t) => t.review);
  const q = S.q.trim().toLowerCase();
  const list = m.tx.filter((t) =>
    (!q || `${t.title} ${t.note} ${t.payee} ${t.category} ${t.amount}`.toLowerCase().includes(q)) &&
    (S.type === "all" || (S.type === "spent" && t.type === "Debit") || (S.type === "income" && t.type === "Credit") || (S.type === "review" && t.review) || (S.type === "auto" && t.auto)) &&
    (!S.cats.size || S.cats.has(t.category || "Unsorted")));
  const days = []; for (const t of list) { const last = days[days.length - 1]; if (last && last.day === t.day) last.tx.push(t); else days.push({ day: t.day, tx: [t] }); }
  const allSel = list.length && list.every((t) => S.sel.has(t.id));
  const nAuto = m.tx.filter((t) => t.auto).length;
  const seg = [["all", "All"], ["spent", "Spent"], ["income", "Income"], ["review", "To review", review.length], ...(nAuto ? [["auto", "Auto-filed", nAuto, "auto"]] : [])]
    .map(([k, l, n, c]) => `<button class="${S.type === k ? "on" : ""}" data-a="type" data-x="${k}">${l}${n ? `<span class="n ${c || ""}">${n}</span>` : ""}</button>`).join("");
  const catsInMonth = [...new Set(m.tx.map((t) => t.category || "Unsorted"))];
  const filters = `<div class="card filters rise"><div class="top"><label class="search">${icon("search")}<input id="q" type="search" placeholder="Search by name, note, amount or UPI ID" value="${esc(S.q)}" aria-label="Search transactions"></label><div class="scroller"><div class="seg">${seg}</div></div></div>
    <div class="cats scroller"><span class="label">Category</span>${catsInMonth.map((c) => `<button class="tag ${S.cats.has(c) ? "on" : ""}" style="${S.cats.has(c) ? `background:${tint(CAT[c])};border-color:${CAT[c]}` : ""}" data-a="toggleCat" data-x="${esc(c)}" aria-pressed="${S.cats.has(c)}"><i style="background:${CAT[c] || "#C3C2BF"}"></i>${esc(catName(c))}</button>`).join("")}${S.cats.size ? `<button class="btn btn--quiet" data-a="clearCats">Clear</button>` : ""}</div></div>`;

  // Wide screens: one table. Phones: a card per day, and each row says its category (the table's columns don't fit).
  const money = (t) => t.type === "Credit" ? `<span class="amt pos">+${inr(t.amount)}</span>` : amt(t.amount);
  const row = (t) => `<div class="t-row ${S.sel.has(t.id) ? "sel" : ""}" data-a="edit" data-x="${t.id}" data-flip="t${t.id}"><input type="checkbox" class="check" data-a="sel" data-x="${t.id}" ${S.sel.has(t.id) ? "checked" : ""} aria-label="Select ${esc(t.title)}">${txTile(t)}
    <div style="min-width:0"><div class="row" style="gap:8px"><span class="t-name ellip">${esc(t.title)}</span>${t.review && t.category ? chip("Review", "yellow") : t.auto ? chip("Auto", "purple") : ""}</div>
      <div class="meta ellip"><span class="dk">${esc([t.note, t.payee].filter(Boolean).join(" · "))}</span><span class="ph"><i class="dot" style="background:${CAT[t.category] || "#C3C2BF"};margin-right:6px"></i>${esc([t.category || "Choose a category", t.source].filter(Boolean).join(" · "))}</span></div></div>
    <span>${tag(t.category)}</span><span style="color:var(--sub)">${esc(t.source || "")}</span><span class="meta">${t.time || shortDay(t.day)}</span>
    <span class="t-amt"><span class="strong">${money(t)}</span><span class="meta ph">${t.time || shortDay(t.day)}</span></span></div>`;
  const table = `<div class="card flush tlist rise"><div class="t-head label"><input type="checkbox" class="check" data-a="selAll" ${allSel ? "checked" : ""} aria-label="Select all"><span></span><span>Name</span><span>Category</span><span>Account</span><span>Time</span><span class="right">Amount</span></div>
    ${days.length ? days.map((d) => `<section class="day"><div class="t-day"><span class="label">${d.day === today() ? "Today · " : ""}${dayLabel(d.day)}</span><span class="meta">${d.tx.length} · ${amt(d.tx.filter(D.isSpend).reduce((s, t) => s + t.amount, 0))}</span></div>${d.tx.map(row).join("")}</section>`).join("")
      : `<div class="empty">${m.tx.length ? "No transactions match." : "Nothing logged this month."}</div>`}</div>`;

  // Needs a category: suggest what the model ranks highest first.
  const usual = (t) => (D.rank(t) || []).filter((r) => r.p >= 0.05).map((r) => r.cat);
  const top = Object.entries(m.cats).sort((a, b) => b[1] - a[1]).map(([c]) => c).filter((c) => c !== "Unsorted");
  // Learned: ones the model is sure of. Those go first, and can be filed in one go.
  const learnt = review.filter((t) => D.learnedFor(t));
  // Accuracy on your past reviews: worked out once per load, after the page is drawn (it retrains per row).
  const E = D.evalR; if (!E && !D.evalPending) { D.evalPending = true; setTimeout(() => { D.evalR = evalModel(D.confirmed); renderQuiet(); }, 400); }
  const needs = `<div class="card rise first"><div class="card-h" style="margin-bottom:8px"><div><h2 class="card-title">To review</h2><div class="sub">${E ? `Right ${pct(E.top, E.n)}% of the time on your last ${E.n} reviews${E.auto ? ` · ${pct(E.autoOk, E.auto)}% when it files by itself` : ""}` : "Tap the right category to confirm it"}</div></div>${review.length ? chip(review.length + " left", "yellow") : chip("All sorted", "green")}</div>
    ${learnt.length ? `<div class="learn"><span style="color:var(--v-purple)">${icon("sparkle")}</span><div class="grow"><div class="strong">${learnt.length} learned from your choices</div><div class="meta">Ones that look like what you filed before</div></div><button class="btn btn--primary" data-a="learnAll">File them</button></div>` : ""}
    ${review.length ? [...learnt, ...review.filter((t) => !D.learnedFor(t))].slice(0, phone() ? 3 : 6).map((t) => { const credit = t.type === "Credit", L = D.learnedFor(t), P = !L && D.last(t);
      const sug = credit ? [...new Set([L?.cat, P, "Income", "Transfers", ...usual(t).filter((c) => SPEND_CATS.includes(c) && !CASH.includes(c))].filter(Boolean))].slice(0, 3)
        : [...new Set([L?.cat, P, /AI guess/.test(t.note || "") && t.category, ...usual(t), t.category, ...top, "Personal Expense", "Foods & Drinks"].filter(Boolean))].filter((c) => c !== "Income").slice(0, 3);
      const nameOf = (c) => (credit && SPEND_CATS.includes(c) && !CASH.includes(c) ? "Paid back: " + c : catName(c));
      return `<div class="fix-item" data-flip="r${t.id}"><div class="fix-top">${txTile(t)}<div class="grow"><div class="t-name ellip">${esc(t.title)}</div><div class="meta ellip">${esc(t.payee || t.note || "")} · ${shortDay(t.day)}${t.time ? " " + t.time : ""}</div></div><span class="strong" style="font-size:15px">${credit ? `<span class="amt pos num">+${inr(t.amount)}</span>` : amt(t.amount)}</span></div>
        ${L ? `<div class="learnt">${icon("sparkle", 12)}${Math.round(L.p * 100)}% sure · you filed ${L.n} like this as ${esc(nameOf(L.cat))}</div>` : P ? `<div class="learnt">${icon("sparkle", 12)}Last time you chose ${esc(nameOf(P))} for this payee</div>` : ""}
        <div class="fix-opts">${sug.map((c) => `<button class="tag ${(L ? c === L.cat : c === P) ? "learned" : ""}" data-a="fix" data-x="${t.id}" data-y="${esc(c)}"><i style="background:${CAT[c]}"></i>${esc(nameOf(c))}</button>`).join("")}<button class="tag" data-a="edit" data-x="${t.id}">More…</button></div>
        ${t.payee ? `<label class="row meta" style="gap:10px;min-height:28px;color:var(--sub)"><input type="checkbox" class="check" id="always-${t.id}">Use this for every ${esc(t.payee)} ${credit ? "credit" : "payment"} to review</label>` : ""}</div>`; }).join("") : `<p class="meta">Every transaction this month has a category.</p>`}</div>`;
  const bySource = {}; for (const t of m.tx.filter(D.isSpend)) bySource[t.source || "Other"] = (bySource[t.source || "Other"] || 0) + t.amount;
  const srcColors = { UPI: "#2F7BFF", "Debit Card": "#8B5CF6", NEFT: "#14B8A6", Other: "#7CC118" };
  const month = `<div class="card rise late"><div class="card-h"><div><h2 class="card-title">This month</h2><div class="sub">${m.tx.length} transactions</div></div></div>
    <div class="row" style="gap:12px">${[["Spent", amt(m.spent)], ["Income", `<span class="amt pos">+${inr(m.income)}</span>`]].map(([l, v]) => `<div class="box grow"><span class="label">${l}</span><span class="money-m">${v}</span></div>`).join("")}</div>
    <div class="label" style="margin:16px 0 10px">By account</div><div class="stackbar">${Object.entries(bySource).map(([s, v]) => segment((v / (m.spent || 1)) * 100, srcColors[s] || "#9B9A97", s, v, m.spent)).join("")}</div>
    <div class="stack" style="gap:8px;margin-top:12px">${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([s, v]) => `<div class="row"><i style="width:8px;height:8px;border-radius:50%;background:${srcColors[s] || "#9B9A97"}"></i><span class="grow">${esc(s)}</span><span class="strong">${amt(v)}</span><span class="meta" style="width:34px;text-align:right">${pct(v, m.spent)}%</span></div>`).join("")}</div></div>`;

  const voice = review.length ? `${review.length === 1 ? "One transaction" : review.length + " transactions"} to review, the rest are sorted` : "Everything is sorted";
  return header("Transactions", voice, `${stepper()}${privacyBtn()}<button class="btn" data-a="statement" aria-label="Upload statement">${icon("up")}<span class="txt">Upload statement</span></button>`, primaryBtn("addTx", "Add")) + errorBanner() + filters +
    `<div class="grid g-side"><div>${table}</div><div class="stack">${needs}${month}</div></div>`;
}

// ---------- investments ----------
function investments() {
  const P = portfolio(), D = S.D;
  // Only snapshots that measured every platform; older rows counted different things (savings account, no crypto).
  const hist = D.snaps.filter((s) => s.full).slice(-90);
  const platforms = Object.entries(P.byPlatform).sort((a, b) => b[1] - a[1]);
  const voice = P.holdings.length ? `${amt(P.total)} across ${platforms.map(([p]) => esc(p)).join(", ").replace(/, ([^,]*)$/, " and $1")}` : "Log a snapshot to start tracking";
  const actions = `${P.snap ? `<span class="meta hide-sm">Holdings from ${shortDay(P.snap.date)}${P.live ? ", live crypto prices" : ""}${usd() ? ` · $1 = ₹${S.fx.toFixed(2)}` : ""}</span>` : ""}${S.fx ? `<div class="seg" role="group" aria-label="Currency">${[["usd", "$"], ["inr", "₹"]].map(([k, l]) => `<button class="${S.cur === k ? "on" : ""}" data-a="cur" data-x="${k}" aria-pressed="${S.cur === k}">${l}</button>`).join("")}</div>` : ""}${privacyBtn()}<button class="btn" data-a="prices" aria-label="Refresh prices">${icon("refresh")}<span class="txt">Refresh prices</span></button>`;
  const up = (v) => (v >= 0 ? "↑ " : "↓ ") + inr(Math.abs(v));
  const pnlChip = (x) => x && x.pnl != null ? chip(`${up(x.pnl)} · ${Math.abs((x.pnl / x.invested) * 100).toFixed(1)}%`, x.pnl >= 0 ? "green" : "late") : `<div class="meta">${share(x ? x.value : 0, P.total)}</div>`;
  const pl = P.pnl, plParts = P.known.map((x) => `${esc(x.p)} ${up(x.pnl)} on ${inr(x.invested)} paid`);
  // The cost is known for only some holdings, so both cards say which ones they cover: "Invested $155" beside a $7,517
  // portfolio read as if most of it had been lost (25 Oct 2026). USDT is cash and has no gain by design.
  const costed = P.holdings.filter((h) => h.invested != null), cash = P.holdings.filter((h) => h.invested == null && h.type === "Stablecoin");
  const noCost = P.holdings.length - costed.length - cash.length;
  const coverage = `${costed.length} of ${P.holdings.length} holdings, worth ${inr(costed.reduce((s, h) => s + h.value, 0))} now. ` +
    [cash.length && `${cash.map((h) => esc(h.asset)).join(", ")} ${cash.length > 1 ? "are" : "is"} cash`, noCost && `${noCost} ${noCost > 1 ? "have" : "has"} no recorded cost`].filter(Boolean).join("; ") + ".";
  const stat = (label, color, icn, value, sub) => `<div class="card stack rise kpi-s" style="gap:8px;--c:${color}"><div class="row" style="gap:8px"><span class="tile" style="width:26px;height:26px;border-radius:8px;background:${tint(color)};color:${color}">${icon(icn, 14)}</span><span class="label">${label}</span></div><div class="money-l">${value}</div><div class="meta">${sub}</div></div>`;
  const stats = `<div class="grid kpis">
    ${stat("Current value", "#2F7BFF", "wallet", amt(P.total, 0, "", "ptotal"), P.live ? "Coins at live Binance prices" : "From your last snapshot")}
    ${stat("Cost known", "#12B76A", "up", P.known.length ? amt(P.known.reduce((s, x) => s + x.invested, 0)) : "—", P.known.length ? coverage : "Shows once a holding has a recorded cost")}
    ${stat("Profit / loss", "#8B5CF6", "trend", plParts.length ? `<span class="amt ${pl >= 0 ? "pos" : "neg"}">${pl >= 0 ? "+" : "−"}${inr(Math.abs(pl))}</span>` : "—", plParts.length ? `Only on the ${costed.length} with a known cost: ${plParts.join(" · ")}` : "Shows once a holding has a recorded cost")}
    ${stat("Platforms", "#F2A900", "chart", String(platforms.length), platforms.map(([p]) => p).join(", ") || "None yet")}</div>`;

  // Binance coins with a live price: their total ticks on a Liveline chart (live.js), mounted after render by mountLive().
  const coins = Object.fromEntries(P.holdings.filter((h) => h.platform === "Binance" && h.type === "Crypto" && h.qty && h.live).map((h) => [h.asset, h.qty]));
  const liveCard = Object.keys(coins).length && S.prices.USDT ? `<div class="card rise"><div class="card-h"><div><h2 class="card-title">Live crypto</h2><div class="sub">${esc(Object.keys(coins).join(", "))} at Binance prices, updating every second</div></div></div><div class="live-chart" data-live="${esc(JSON.stringify(coins))}"></div></div>` : "";
  const valueCard = `<div class="card rise"><div class="card-h"><div><h2 class="card-title">Value over time</h2><div class="sub">Total investments at each snapshot</div></div></div>
    ${hist.length > 1 ? lineChart({ labels: hist.map((s) => shortDay(s.date)), tipLabels: hist.map((s) => dayLabel(s.date.slice(0, 10))), series: [{ name: "Investments", vals: hist.map((s) => s.invC), color: "#12B76A", fill: true }] }) : `<div class="empty">History starts ${hist[0] ? shortDay(hist[0].date) : "with your next snapshot"}, the first day every platform was measured. The line grows with each nightly snapshot.</div>`}</div>`;
  const platformCard = `<div class="card rise"><div class="card-h"><h2 class="card-title">By platform</h2>${chip(platforms.length + " platforms", "line")}</div>
    <div class="stackbar" style="height:12px;border-radius:6px">${platforms.map(([p, v]) => segment((v / P.total) * 100, PLATFORM[p] || "#9B9A97", p, v, P.total)).join("")}</div>
    <div class="stack" style="gap:4px;margin-top:12px">${platforms.map(([p, v]) => `<div class="list-row"><span class="tile" style="background:${tint(PLATFORM[p] || "#9B9A97")};color:${PLATFORM[p] || "#9B9A97"};font-weight:600;font-size:12px">${esc(p.slice(0, 2).toUpperCase())}</span><div class="grow"><div class="strong">${esc(p)}</div><div class="meta">${P.holdings.filter((h) => h.platform === p).map((h) => esc(h.asset)).join(", ")}</div></div><div style="text-align:right"><div class="strong">${amt(v)}</div>${pnlChip(P.platforms.find((x) => x.p === p))}</div></div>`).join("")}</div>
    <p class="meta" style="margin:10px 0 0">Gain is only against what you paid: INDmoney reports its cost, and Binance coins carry the cost of their trades. USDT is cash, so it has no gain.${P.platforms.some((x) => x.untracked.length) ? ` No cost recorded yet for ${P.platforms.flatMap((x) => x.untracked).map(esc).join(", ")}.` : ""}</p></div>`;
  const types = Object.entries(P.byType).sort((a, b) => b[1] - a[1]);
  const alloc = `<div class="card rise"><div class="card-h"><div><h2 class="card-title">Allocation</h2><div class="sub">By asset type</div></div></div>
    <div style="display:flex;justify-content:center;margin-bottom:12px">${donut(types.map(([t, v]) => ({ c: ASSET_TYPE[t] || "#9B9A97", v, n: t })), 180, `<span class="money-m">${amt(P.total)}</span><span class="meta">Current value</span>`)}</div>
    ${types.map(([t, v]) => `<div class="row" style="min-height:32px"><i style="width:8px;height:8px;border-radius:50%;background:${ASSET_TYPE[t] || "#9B9A97"}"></i><span class="grow">${esc(t)}</span><span class="strong">${amt(v)}</span><span class="meta" style="width:34px;text-align:right">${share(v, P.total)}</span></div>`).join("")}
    ${(P.byType.Stablecoin || 0) / P.total > 0.5 ? `<p class="meta" style="margin-top:12px;color:var(--ink)">Most of it sits in stablecoins, which track the dollar rather than grow.</p>` : ""}</div>`;
  const holdings = `<div class="card flush rise"><div class="between" style="padding:20px 20px 16px"><div><h2 class="card-title">Holdings</h2><div class="sub" style="font-size:12.5px;color:var(--muted)">${P.holdings.length} holdings · tap one for details${unshared("Holdings Snapshots") ? ". INDmoney shows one total until “Holdings Snapshots” is shared with this site in Notion" : ""}</div></div></div>
    ${P.holdings.map((h, i) => { const c = ASSET_TYPE[h.type] || "#9B9A97", r = h.invested != null ? h.value - h.invested : null;
      return `<button class="tx" style="border-top:1px solid var(--line);border-radius:0;padding:12px 20px" data-a="holding" data-x="${i}"><span class="tile" style="background:${tint(c)};color:${c};font-weight:600;font-size:12px">${esc(h.asset.slice(0, 3).toUpperCase())}</span><div class="grow"><div class="name ellip">${esc(h.asset)}</div><div class="meta">${esc(h.platform)} · ${esc(h.type)}${h.qty ? " · " + qty(h.qty) : ""}${h.dayPct != null ? ` · <span class="${h.dayPct >= 0 ? "pos" : "neg"}">${h.dayPct >= 0 ? "+" : "−"}${Math.abs(h.dayPct).toFixed(2)}% today</span>` : ""}</div></div><div style="text-align:right"><div class="strong">${amt(h.value)}</div>${r != null ? chip(`${r >= 0 ? "↑" : "↓"} ${Math.abs((r / h.invested) * 100).toFixed(1)}%`, r >= 0 ? "green" : "late") : `<span class="meta">${share(h.value, P.total)}</span>`}</div></button>`; }).join("") || `<div class="empty">No holdings in your snapshots yet.</div>`}</div>`;
  const news = (S.live.news || []).length ? `<div class="card rise"><div class="card-h"><h2 class="card-title">Market news</h2></div>${S.live.news.map((n) => `<a class="list-row" href="${/^https?:\/\//.test(n.url) ? esc(n.url) : "#"}" target="_blank" rel="noopener noreferrer"><div class="grow"><div class="strong" style="font-weight:500">${esc(n.headline)}</div><div class="meta">${esc([n.source, n.ticker, n.published && shortDay(n.published.slice(0, 10))].filter(Boolean).join(" · "))}</div></div></a>`).join("")}</div>` : "";
  return header("Investments", voice, actions, primaryBtn("snapshot", "Log snapshot")) + errorBanner() + stats +
    `<div class="grid g-side"><div class="stack">${liveCard}${valueCard}${holdings}</div><div class="stack">${platformCard}${alloc}${news}</div></div>`;
}

// ---------- goals ----------
function goals() {
  const D = S.D, G = D.goals;
  const saved = G.reduce((s, g) => s + g.saved, 0), target = G.reduce((s, g) => s + g.target, 0), need = G.reduce((s, g) => s + (g.need || 0), 0);
  const thisMonth = D.contributions.filter((c) => c.month === monthKey(today())).reduce((s, c) => s + c.amount, 0);
  const behind = G.filter((g) => g.status === "Behind");
  const voice = !G.length ? "Set a goal and see what it takes each month" : behind.length ? `${esc(behind[0].name)} needs ${amt(Math.max(0, behind[0].need - behind[0].recent))} more a month` : need ? `Put aside ${amt(need)} a month to hit every deadline` : "Every goal is on track";
  const colors = ["#2F7BFF", "#F2A900", "#8B5CF6", "#12B76A", "#EC4899", "#14B8A6"];
  const summary = `<div class="grid kpis">${[["Saved so far", amt(saved), target ? `of ${inr(target)} across ${G.length} goals` : "No goals yet"], ["Needed each month", amt(need), "to hit every deadline"], ["Added this month", `<span class="amt ${thisMonth ? "pos" : ""}">${inr(thisMonth)}</span>`, "through Add money"]].map(([l, v, s], i) => `<div class="card stack rise kpi-s" style="gap:6px;--c:${["#2F7BFF", "#F2A900", "#12B76A"][i]}"><span class="label">${l}</span><span class="money-l">${v}</span><span class="meta">${s}</span></div>`).join("")}</div>`;
  const kind = { "On track": "green", Reached: "green", Behind: "yellow", Paused: "", "No deadline": "line", Active: "blue" };
  const cards = `<div class="grid g3">${G.map((g, i) => { const c = colors[i % colors.length];
    const advice = g.status === "Reached" ? "Done. Nice." : g.status === "Paused" ? "Paused." : !g.need ? "Add a deadline to see a monthly amount." : g.status === "Behind" ? `Put in ${inr(g.need)} a month, or move the deadline.` : g.status === "Active" ? `Put in ${inr(g.need)} a month to finish on time.` : `Keep going at about ${inr(g.need)} a month.`;
    return `<div class="card stack rise" style="gap:18px"><div class="row" style="gap:16px">${ring(g.target ? g.saved / g.target : 0, c, 104, tipBox(g.name, [tipRow(c, "Saved", inr(g.saved)), tipRow("#C3C2BF", "Target", inr(g.target)), tipRow("#191919", "Left", inr(g.left))]))}<div class="stack grow" style="gap:4px"><div class="row" style="gap:8px;flex-wrap:wrap"><h2 class="card-title">${esc(g.name)}</h2>${chip(g.status, kind[g.status])}</div><span class="meta">${g.deadline ? `by ${MON[+g.deadline.slice(5, 7) - 1]} ${g.deadline.slice(0, 4)} · ${g.monthsLeft} months left` : "No deadline"}</span><div class="row" style="gap:6px;align-items:baseline"><span class="money-m">${amt(g.saved)}</span><span style="color:var(--sub)">of ${amt(g.target)}</span></div></div></div>
      <div class="row" style="gap:12px">${[["Needed a month", g.need ? amt(g.need) : "—"], ["You put in", g.hasHistory ? `<span class="amt">${inr(Math.round(g.recent))}</span> <span class="meta">a month</span>` : "No history yet"]].map(([l, v]) => `<div class="box grow"><span class="label">${l}</span><span class="strong">${v}</span></div>`).join("")}</div>
      <p class="meta" style="margin:0;color:var(--ink)">${advice}</p>
      <div class="row" style="gap:8px"><button class="btn grow" data-a="addMoney" data-x="${g.id}">${icon("plus")}Add money</button><button class="btn" data-a="goalForm" data-x="${g.id}">Edit</button></div></div>`; }).join("")}
    ${!G.length ? (unshared("Savings Goals") ? `<div class="card" style="grid-column:1/-1">${shareNote("Savings Goals")}</div>` : `<div class="card empty">No goals yet.<br><br><button class="btn btn--primary" data-a="goalForm">${icon("plus")}Add goal</button></div>`) : ""}</div>`;
  const contrib = `<div class="card rise" style="margin-top:16px"><div class="card-h"><div><h2 class="card-title">Contributions</h2><div class="sub">Money moved into goals</div></div></div>
    ${D.contributions.length ? D.contributions.slice(0, 12).map((c) => { const i = G.findIndex((g) => "Goal: " + g.name === c.note); const col = colors[(i < 0 ? 0 : i) % colors.length];
      return `<div class="list-row"><span class="tile" style="background:${tint(col)};color:${col}">${icon("wallet", 18)}</span><div class="grow"><div class="strong">${esc(c.note.slice(6))}</div><div class="meta">${dayLabel(c.day)}</div></div><span class="amt pos strong">+${inr(c.amount)}</span></div>`; }).join("")
      : `<p class="meta">Use Add money on a goal. Each one is also logged as a Savings transaction.</p>`}</div>`;
  return header("Goals", unshared("Savings Goals") ? "Waiting for Notion to share your goals" : voice, privacyBtn(), G.length ? primaryBtn("goalForm", "Add goal") : "") + errorBanner() + summary + cards + contrib + wishlist();
}

// Things to buy later. A plan, not spending: ticking Bought only marks it, no transaction is made.
function wishlist() {
  const W = S.live.wishlist || [], year = today().slice(0, 4);
  const open = W.filter((w) => !w.bought).sort((a, b) => (a.priority === "Need" ? 0 : 1) - (b.priority === "Need" ? 0 : 1) || (a.by || "9").localeCompare(b.by || "9") || b.price - a.price);
  const bought = W.filter((w) => w.bought && (w.boughtOn || year).startsWith(year)).sort((a, b) => String(b.boughtOn).localeCompare(String(a.boughtOn)));
  const sum = (xs) => xs.reduce((s, w) => s + w.price, 0), needs = open.filter((w) => w.priority === "Need");
  // Photo cards: the photo fades into its own colour (picked when it was cropped); no photo gets a deep palette colour.
  const deep = ["#2D5BA8", "#2E7A55", "#B4532E", "#6D4BC2", "#B23A7A", "#A27310"];
  const when = (d) => { const n = daysBetween(today(), d.slice(0, 10)); return n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : n === 0 ? "today" : n < 45 ? `in ${n} day${n === 1 ? "" : "s"}` : `in ${Math.round(n / 30.4)} months`; };
  fillColors();
  const card = (w, i) => { const c = w.color || (w.photo ? "#5B5A57" : deep[i % deep.length]);
    const d = w.by && new Date(w.by.slice(0, 10) + "T00:00");
    return `<article class="wish-card${w.bought ? " wish-card--bought" : ""}" style="--c:${c}">
      ${w.photo ? `<img src="${esc(w.photo)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="wish-card__icon">${icon("cart", 64)}</span>`}<i class="wish-card__fade"></i>
      <button class="wish-card__open" data-a="wishForm" data-x="${w.id}" aria-label="Edit ${esc(w.name)}"></button>
      <span class="wish-card__tag ${w.bought ? "" : w.priority === "Need" ? "need" : "want"}">${w.bought ? "Bought" : esc(w.priority)}</span>
      <button class="wish-card__check" data-a="wishBought" data-x="${w.id}" aria-pressed="${w.bought}" aria-label="${esc(w.name)} ${w.bought ? "bought, tap to undo" : "mark bought"}">${w.bought ? icon("check", 16) : ""}</button>
      <div class="wish-card__info"><h3>${esc(w.name)}</h3><div class="row" style="gap:12px;align-items:center">
        ${d ? `<span class="wish-card__date"><b>${MON[d.getMonth()].toUpperCase()}</b><strong>${pad(d.getDate())}</strong><small>${WD[d.getDay()].slice(0, 3).toUpperCase()}</small></span>` : ""}
        <span class="wish-card__note">${esc(mask(w.note || ""))}</span>
        <span class="wish-card__price"><strong class="amt">${inr(w.price)}</strong><small>${w.bought ? (w.boughtOn ? "bought " + shortDay(w.boughtOn) : "bought") : w.by ? when(w.by) : "no date"}</small></span></div></div></article>`; };
  const stats = [["Planned", sum(open), `${open.length} item${open.length === 1 ? "" : "s"}`], ["Needs", sum(needs), `${needs.length} you must buy`], ["Bought this year", sum(bought), `${bought.length} item${bought.length === 1 ? "" : "s"}`]];
  return `<div class="card rise" style="margin-top:16px"><div class="card-h"><div><h2 class="card-title">Wishlist</h2><div class="sub">Big things to buy later. Nothing here is spent until you mark it bought.</div></div>${unshared("Wishlist") ? "" : `<div class="row" style="gap:8px">${W.length ? chip(open.length + " planned", "line") : ""}<button class="btn btn--primary" data-a="wishForm">${icon("plus")}Add item</button></div>`}</div>
    ${unshared("Wishlist") ? shareNote("Wishlist") : !W.length ? `<p class="meta">Add the big things you’ll need, like a new phone or a chair, so they don’t surprise you later.</p>` : `
    <div class="wish-stats">${stats.map(([l, v, s]) => `<div class="box"><span class="label">${l}</span><span class="strong">${amt(v)}</span><span class="meta">${s}</span></div>`).join("")}</div>
    <div class="wish-grid">${[...open, ...bought].map(card).join("")}</div>`}</div>`;
}

// ---------- modals ----------
// Where a dialog comes from and goes back to: a sheet from below on phones, the right edge for drawers, a slight zoom for popups.
const away = (d) => calm() ? { opacity: 0 } : phone() ? { opacity: 0, translate: "0 64px" } : d.id === "drawer" ? { opacity: 0, translate: "48px 0" } : { opacity: 0, translate: "0 8px", scale: "0.96" };
function openDialog(html, drawer) {
  const d = $(drawer ? "#drawer" : "#modal"), fresh = !d.open || d.dataset.closing;
  d.innerHTML = html; delete d.dataset.closing;
  if (!d.open) d.showModal();
  if (fresh) {
    d.getAnimations().forEach((a) => a.cancel());
    d.animate([away(d), { opacity: 1, translate: "0 0", scale: "1" }], { duration: phone() ? 380 : 300, easing: EASE });
    if (drawer) rise(d.querySelectorAll(".pop > *"), { delay: 90, stagger: 25, y: 8, ms: 360 });
  }
  // The entrance starts from invisible. If the browser stalls it (hidden tab, power saving), finish it so the popup is never left see-through.
  if (fresh) setTimeout(() => { for (const el of [d, ...d.querySelectorAll(".pop > *")]) for (const x of el.getAnimations()) if (x.playState !== "finished") x.finish(); }, 900);
  const f = d.querySelector("input:not([type=checkbox],[type=file]),select"); if (f) f.focus();
}
// Dialogs leave before they close; a reopen mid-exit rises from wherever the exit got to.
async function closeDialog(d) {
  if (!d || !d.open || d.dataset.closing) return;
  d.dataset.closing = "1";
  const exit = [d.animate([away(d)], { duration: 200, easing: EASE_IN, fill: "forwards" })];
  await done(exit);
  if (d.dataset.closing) { d.close(); delete d.dataset.closing; }
  // The exit holds opacity 0 until cancelled. Left in place, it can win over the next open and the dialog
  // vanishes mid-air with only the dim backdrop showing.
  exit.forEach((a) => a.cancel());
}
function closeAll() { return Promise.all([...document.querySelectorAll("dialog[open]")].map(closeDialog)); }
const opt = (c, sel, label = catName(c)) => `<option value="${esc(c)}" ${c === sel ? "selected" : ""}>${esc(label)}</option>`;
// Credits get their own choices: earned, paid back for a spending category, or your own money moving.
const catOptions = (sel, credit) => credit
  ? `<optgroup label="Money you earned">${opt("Income", sel)}</optgroup><optgroup label="Paid back for">${SPEND_CATS.filter((c) => !CASH.includes(c)).map((c) => opt(c, sel, "Paid back: " + c)).join("")}</optgroup><optgroup label="Not counted">${["Transfers", "Savings", "Investing & Trading"].map((c) => opt(c, sel)).join("")}</optgroup>`
  : CATEGORIES.filter((c) => c !== "Income").map((c) => opt(c, sel)).join("") + opt("Income", sel);
const field = (label, input) => `<label class="field"><span>${label}</span>${input}</label>`;
const pop = (title, body, actions) => `<form class="pop" method="dialog"><div class="between"><h2>${title}</h2><button type="button" class="btn btn--icon btn--quiet" data-a="close" aria-label="Close">${icon("close")}</button></div>${body}<div class="actions">${actions}</div></form>`;

function addTxModal() {
  openDialog(pop("Add transaction", `
    ${field("Amount (₹)", `<input class="input" name="amount" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="0">`)}
    <div class="field"><span>Type</span><div class="seg fill"><button type="button" class="on" data-a="txType" data-x="Debit">Expense</button><button type="button" data-a="txType" data-x="Credit">Income</button></div><input type="hidden" name="type" value="Debit"></div>
    ${field("What was it", `<input class="input" name="entry" placeholder="e.g. Blinkit groceries" maxlength="200">`)}
    ${field("Category", `<select class="input" name="category">${catOptions("Foods & Drinks")}</select>`)}
    <div class="row" style="gap:12px">${field("Date", `<input class="input" name="date" type="date" value="${today()}" required>`)}${field("Paid by", `<select class="input" name="source"><option>UPI</option><option>Debit Card</option><option>NEFT</option><option>Other</option></select>`)}</div>
    ${field("Note", `<input class="input" name="note" placeholder="Optional" maxlength="500">`)}`,
    `<button type="button" class="btn" data-a="close">Cancel</button><button class="btn btn--primary" data-a="saveTx">Save</button>`));
}
function editModal(id) {
  const t = S.D.tx.find((x) => x.id === id); if (!t) return;
  S.edit = { id, amount: t.amount, splits: null };
  renderEdit(t);
}
function renderEdit(t, keep) {
  const e = S.edit, v = keep || { category: t.category || (t.type === "Credit" ? "Income" : "Personal Expense"), note: t.note || "", amount: t.amount, exclude: t.exclude };
  const splitSum = e.splits ? e.splits.reduce((s, r) => s + (Number(r.amt) || 0), 0) : 0;
  openDialog(pop(esc(t.title), `
    <div class="row meta" style="margin-top:-8px">${dayLabel(t.day)}${t.time ? " · " + t.time : ""}${t.source ? " · " + esc(t.source) : ""}${t.review ? " " + chip("Needs review", "yellow") : ""}</div>
    ${e.splits ? "" : field("Category", `<select class="input" name="category">${catOptions(v.category, t.type === "Credit")}</select>`)}
    ${t.type === "Credit" && !e.splits ? `<p class="meta" style="margin:-6px 0 0">This is money coming in. Pick <b>Income</b> if you earned it, <b>Paid back</b> if someone returned money you spent on them (it lowers that category), or <b>Transfers</b> for lending, being repaid or swapping cash with a friend (never counted as spending or income).</p>` : ""}
    ${field("Note", `<div class="clearable"><input class="input" name="note" value="${esc(v.note)}" maxlength="500"><button type="button" class="clear-x" data-a="clearNote" aria-label="Clear the note" title="Clear">${icon("close", 14)}</button></div>`)}
    ${t.refId && !/^manual-/.test(t.refId) ? field("Amount", `<div class="row meta" style="gap:8px;min-height:44px">${icon("lock", 14)}<span><b class="amt" style="color:var(--black)">${inr(t.amount, 2)}</b> from your bank, so it can't be changed. Use Split to divide it.</span></div>`)
      : field("Amount (₹)", `<input class="input" name="amount" type="number" min="0" step="0.01" value="${v.amount}">`)}
    <label class="row" style="gap:12px;min-height:44px"><input type="checkbox" class="check" name="exclude" ${v.exclude ? "checked" : ""}><span><span>Exclude from spend</span><br><span class="meta">Transfers between your own accounts, refunds</span></span></label>
    ${e.splits ? `<div class="stack" style="gap:10px;border-top:1px solid var(--line);padding-top:14px"><div class="between"><span class="label">Split across categories</span>${chip(`${inr(splitSum)} of ${inr(e.amount)}`, Math.abs(splitSum - e.amount) < 0.01 ? "green" : "yellow")}</div>
      ${e.splits.map((r, i) => `<div class="row" style="gap:8px" data-split-row="${i}"><select class="input grow" data-split="${i}" data-k="cat">${catOptions(r.cat, t.type === "Credit")}</select><input class="input" style="width:110px" type="number" min="0" step="0.01" data-split="${i}" data-k="amt" value="${r.amt}"><button type="button" class="btn btn--icon" data-a="splitDel" data-x="${i}" aria-label="Remove row" ${e.splits.length <= 2 ? "disabled" : ""}>${icon("close")}</button></div>`).join("")}
      <button type="button" class="btn btn--quiet" style="align-self:flex-start" data-a="splitAdd">${icon("plus")}Add split row</button><span class="meta">Split amounts must add up to the transaction total.</span></div>` : ""}`,
    `${e.splits ? `<button type="button" class="btn" data-a="splitOff">Undo split</button>` : `<button type="button" class="btn" data-a="splitOn">Split</button>`}<span class="grow"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn btn--primary" data-a="saveEdit">Save</button>`));
}
function readEdit() {
  const f = $("#modal form"), fd = new FormData(f);
  for (const el of f.querySelectorAll("[data-split]")) S.edit.splits[+el.dataset.split][el.dataset.k] = el.value;
  return { category: fd.get("category"), note: fd.get("note"), amount: fd.has("amount") ? Number(fd.get("amount")) : undefined, exclude: fd.get("exclude") === "on" };
}
function budgetsDrawer() {
  const D = S.D, m = D.months[S.month];
  const avg = (c) => { const ks = [1, 2, 3].map((n) => addMonths(S.month, -n)); return Math.round(ks.reduce((s, k) => s + (D.months[k]?.cats[c] || 0), 0) / 3); };
  const total = Object.values(D.budgets).reduce((s, b) => s + b.amount, 0);
  const income = m.income || D.months[addMonths(S.month, -1)]?.income || 0;
  openDialog(`<form class="pop" method="dialog" style="gap:0;padding:0"><div class="stack" style="gap:10px;padding:20px 20px 16px"><div class="between"><h2>Budgets for ${MONTHS[+S.month.slice(5) - 1]}</h2><button type="button" class="btn btn--icon btn--quiet" data-a="close" aria-label="Close">${icon("close")}</button></div>
    <div class="row" style="gap:8px"><span class="strong">${amt(total)} a month</span>${income ? chip(pct(total, income) + "% of income", "purple") : ""}</div></div>
    ${SPEND_CATS.map((c) => `<div class="row" style="gap:12px;padding:10px 20px;border-top:1px solid var(--line)"><i style="width:10px;height:10px;border-radius:50%;background:${CAT[c]}"></i><div class="grow"><div style="font-size:15px;font-weight:500;color:var(--black)">${esc(c)}</div><div class="meta">${inr(m.cats[c] || 0)} spent · avg ${inr(avg(c))}</div></div><input class="input" style="width:120px" type="number" min="0" step="100" name="${esc(c)}" value="${D.budgets[c]?.amount ?? ""}" placeholder="No budget" aria-label="${esc(c)} budget"></div>`).join("")}
    <div class="actions" style="padding:16px 20px 20px;border-top:1px solid var(--line)"><button type="button" class="btn" data-a="close">Cancel</button><button class="btn btn--primary" data-a="saveBudgets">Save budgets</button></div></form>`, true);
}
// The popup's photo and typed values live in S.wp, so a trip to the crop screen and back loses nothing.
function wishModal(id, back) {
  const w0 = (S.live.wishlist || []).find((x) => x.id === id);
  if (!back) S.wp = { id, photo: w0?.photo || null, color: w0?.color || null, changed: false, draft: null };
  const w = S.wp.draft || w0, ph = S.wp.photo;
  const pick = (label, cls) => `<label class="${cls}">${label}<input type="file" accept="image/*" data-a="wishFile" hidden></label>`;
  openDialog(pop(w0 ? "Edit item" : "Add to wishlist", `
    <div class="field"><span>Photo (optional)</span><div class="row" style="gap:14px">${ph
      ? `<img class="wish-ph" src="${esc(ph)}" alt="" onerror="this.style.visibility='hidden'"><div class="stack" style="gap:8px"><span class="meta">Square, cropped by you</span><div class="row" style="gap:8px">${pick("Change", "btn")}<button type="button" class="btn btn--quiet" data-a="wishPhotoOff">Remove</button></div></div>`
      : pick(`${icon("plus")}<span>Add or drop photo</span>`, "wish-drop")}</div></div>
    ${field("Item", `<input class="input" name="name" required maxlength="200" value="${esc(w?.name || "")}" placeholder="e.g. New phone">`)}
    <div class="row" style="gap:12px">${field("Price (₹)", `<input class="input" name="price" type="number" min="1" required value="${w?.price || ""}">`)}${field("Need or want", `<select class="input" name="priority">${["Need", "Want"].map((p) => `<option ${(w?.priority || "Need") === p ? "selected" : ""}>${p}</option>`).join("")}</select>`)}</div>
    ${field("By when (optional)", `<input class="input" name="by" type="date" value="${w?.by?.slice(0, 10) || ""}">`)}
    ${field("Note or link (optional)", `<input class="input" name="note" maxlength="500" value="${esc(w?.note || "")}" placeholder="e.g. current one is 4 years old">`)}`,
    `${w0 ? `<button type="button" class="btn" data-a="wishRemove" data-x="${w0.id}">Remove</button>${w0.bought ? "" : `<button type="button" class="btn" data-a="wishGoal" data-x="${w0.id}">Save for it</button>`}<span class="grow"></span>` : ""}<button type="button" class="btn" data-a="close">Cancel</button><button class="btn btn--primary" data-a="saveWish" data-x="${w0?.id || ""}">Save</button>`));
}
// The card's colour: the average of the photo's bottom third, kept deep enough for white text to read on it.
function photoColor(cv) {
  const px = cv.getContext("2d").getImageData(0, 400, 600, 200).data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 16) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  [r, g, b] = [r / n / 255, g / n / 255, b / n / 255];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l0 = (mx + mn) / 2, dl = mx - mn;
  const h = !dl ? 0 : mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
  const s0 = dl ? dl / (1 - Math.abs(2 * l0 - 1)) : 0;
  const l = Math.min(0.36, Math.max(0.22, l0 * 0.55)), s = dl ? Math.max(0.35, Math.min(0.7, s0)) : 0;
  const f = (k) => { const a = s * Math.min(l, 1 - l), t = (k + h * 2) % 12; return Math.round((l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1))) * 255).toString(16).padStart(2, "0"); };
  return "#" + f(0) + f(8) + f(4);
}
// Photos saved before colours existed: work the colour out once and save it, if the file host lets the browser read the pixels.
function fillColors() {
  for (const w of S.live?.wishlist || []) if (w.photo && !w.color && !w.colorTried) {
    w.colorTried = true; const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => { try { const cv = document.createElement("canvas"); cv.width = cv.height = 600; cv.getContext("2d").drawImage(im, 0, 0, 600, 600);
      w.color = photoColor(cv); renderQuiet(); api({ action: "wish", pageId: w.id, color: w.color }).catch(() => {}); } catch {} };
    im.src = w.photo;
  }
}
// Crop to square: the stage is the square; drag pans, the slider zooms around the centre. Saves a 600px JPEG.
function cropModal(file) {
  const f = $("#modal form"); if (f) S.wp.draft = Object.fromEntries(new FormData(f));
  const url = URL.createObjectURL(file);
  openDialog(pop("Crop to square", `<div class="crop" id="crop"><img id="crop-img" src="${url}" alt="" draggable="false"><i class="crop-grid"></i></div>
    <label class="row" style="gap:12px"><span class="meta">Zoom</span><input id="crop-zoom" type="range" min="1" max="4" step="0.01" value="1" style="flex:1"></label>
    <p class="meta" style="margin:0">Drag the photo to move it. Only what’s inside the square is kept.</p>`,
    `<button type="button" class="btn" data-a="cropBack">Cancel</button><button class="btn btn--primary" data-a="cropUse">Use photo</button>`));
  const stage = $("#crop"), img = $("#crop-img"), zoom = $("#crop-zoom");
  const c = (S.crop = { img, x: 0, y: 0, k: 1, url });
  const W = () => stage.clientWidth, base = () => W() / Math.min(img.naturalWidth, img.naturalHeight);
  const draw = () => { const k = base() * c.k, w = W();
    c.x = Math.min(0, Math.max(w - img.naturalWidth * k, c.x)); c.y = Math.min(0, Math.max(w - img.naturalHeight * k, c.y));
    img.style.transform = `translate(${c.x}px,${c.y}px) scale(${k})`; };
  img.onload = () => { const k = base(); c.x = (W() - img.naturalWidth * k) / 2; c.y = (W() - img.naturalHeight * k) / 2; draw(); };
  img.onerror = () => { toast("That file isn’t a photo this browser can open"); wishModal(S.wp.id, true); };
  zoom.oninput = () => { const k0 = base() * c.k, mid = W() / 2, px = (mid - c.x) / k0, py = (mid - c.y) / k0;
    c.k = +zoom.value; const k = base() * c.k; c.x = mid - px * k; c.y = mid - py * k; draw(); };
  stage.onpointerdown = (e) => { stage.setPointerCapture(e.pointerId); let lx = e.clientX, ly = e.clientY;
    stage.onpointermove = (m) => { c.x += m.clientX - lx; c.y += m.clientY - ly; lx = m.clientX; ly = m.clientY; draw(); };
    stage.onpointerup = stage.onpointercancel = () => { stage.onpointermove = null; }; };
  c.draw = draw; c.base = base; c.W = W;
}
function goalModal(id, pre) {
  const g = S.D.goals.find((x) => x.id === id) || pre;
  openDialog(pop(g?.id ? "Edit goal" : "Add goal", `
    ${field("Goal name", `<input class="input" name="name" required maxlength="200" value="${esc(g?.name || "")}" placeholder="e.g. New laptop">`)}
    <div class="row" style="gap:12px">${field("Target (₹)", `<input class="input" name="target" type="number" min="1" required value="${g?.target || ""}">`)}${field("Saved so far (₹)", `<input class="input" name="saved" type="number" min="0" value="${g?.saved ?? ""}" placeholder="0">`)}</div>
    ${field("Deadline", `<input class="input" name="deadline" type="date" value="${g?.deadline?.slice(0, 10) || ""}">`)}
    ${g?.id ? field("Status", `<select class="input" name="status">${["Active", "Paused", "Reached"].map((s) => `<option ${g.status === s || (s === "Active" && !["Paused", "Reached"].includes(g.status)) ? "selected" : ""}>${s}</option>`).join("")}</select>`) : ""}`,
    `<button type="button" class="btn" data-a="close">Cancel</button><button class="btn btn--primary" data-a="saveGoal" data-x="${g?.id || ""}">Save</button>`));
}
function addMoneyModal(id) {
  const g = S.D.goals.find((x) => x.id === id); if (!g) return;
  openDialog(pop(`Add money to ${esc(g.name)}`, `
    <p class="meta" style="margin:-6px 0 0">${inr(g.saved)} of ${inr(g.target)} saved. It is also logged as a Savings transaction.</p>
    ${field("Amount (₹)", `<input class="input" name="amount" type="number" min="1" required value="${g.need || ""}">`)}
    ${field("Date", `<input class="input" name="date" type="date" value="${today()}" required>`)}`,
    `<button type="button" class="btn" data-a="close">Cancel</button><button class="btn btn--primary" data-a="saveMoney" data-x="${g.id}">Add money</button>`));
}
function snapshotModal() {
  openDialog(pop("Log snapshot", `
    <p class="meta" style="margin:-6px 0 0">Type the balance your bank app shows right now. Every transaction after this moment is counted on from it, so a missed one never sticks. Also saves today’s Binance value${portfolio().live ? " at live prices" : ""}.</p>
    ${field("Bank balance (₹)", `<input class="input" name="bank" type="number" min="0" step="0.01" required value="${S.D.bal ? S.D.bal.at(Date.now()).toFixed(2) : ""}">`)}
    ${field("Date", `<input class="input" name="date" type="date" value="${today()}" required>`)}`,
    `<button type="button" class="btn" data-a="close">Cancel</button><button class="btn btn--primary" data-a="saveSnapshot">Save</button>`));
}
function holdingDrawer(i) {
  const P = portfolio(), h = P.holdings[i]; if (!h) return;
  const c = ASSET_TYPE[h.type] || "#9B9A97", price = h.qty ? h.value / h.qty : 0, r = h.invested != null ? h.value - h.invested : null;
  const box = (l, v) => `<div class="box"><span class="label">${l}</span><span class="strong">${v}</span></div>`;
  openDialog(`<div class="pop"><div class="row" style="gap:12px"><span class="tile" style="width:44px;height:44px;border-radius:12px;background:${tint(c)};color:${c};font-weight:600">${esc(h.asset.slice(0, 3).toUpperCase())}</span><div class="grow"><h2>${esc(h.asset)}</h2><div class="meta">${esc(h.platform)} · ${esc(h.type)}</div></div><button class="btn btn--icon btn--quiet" data-a="close" aria-label="Close">${icon("close")}</button></div>
    <div class="row" style="gap:10px"><span class="money-l">${amt(h.value)}</span>${r != null ? chip(`${r >= 0 ? "↑" : "↓"} <span class="amt">${inr(Math.abs(r))}</span> · ${Math.abs((r / h.invested) * 100).toFixed(1)}%`, r >= 0 ? "green" : "late") : ""}</div>
    <div class="meta">${h.live ? (h.type === "Stablecoin" ? "Live Coinbase USDT rate" : "Live Binance price") : h.date ? "From the nightly INDmoney sync, " + shortDay(h.date) : P.snap ? "Value from snapshot " + shortDay(P.snap.date) : ""}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${h.qty ? box("Quantity", qty(h.qty)) + box("Price", `<span class="amt">${inr(price, price < 100 ? 2 : 0)}</span>`) : box("Today", h.dayPct != null ? `${h.dayPct >= 0 ? "+" : "−"}${Math.abs(h.dayPct).toFixed(2)}%` : "No change yet") + box("Since buy", h.returnPct != null ? `${h.returnPct >= 0 ? "+" : "−"}${Math.abs(h.returnPct).toFixed(1)}%` : "—")}${box("Share of portfolio", ((h.value / P.total) * 100).toFixed(h.value / P.total < 0.01 ? 2 : 0) + "%")}${box("Invested", h.invested != null ? `<span class="amt">${inr(h.invested)}</span>` : "Not tracked")}</div>
    ${h.invested == null ? `<p class="meta" style="color:var(--ink)">${h.type === "Stablecoin" ? "Held as dollars, so there’s no gain or loss to show." : "No cost recorded for this one yet, so no gain or loss is shown."}</p>` : ""}</div>`, true);
}

function subsDrawer() {
  const D = S.D, total = D.subs.reduce((s, x) => s + x.monthly, 0);
  const groups = [...Object.keys(PAY), null].map((k) => [k, D.subs.filter((s) => s.where === k)]).filter(([, l]) => l.length);
  openDialog(`<div class="pop"><div class="between"><div><h2>Subscriptions</h2><div class="meta">${D.subs.length} active · ${inr(total)} a month</div></div><button class="btn btn--icon btn--quiet" data-a="close" aria-label="Close">${icon("close")}</button></div>
    ${groups.map(([k, l]) => `<section class="stack" style="gap:2px"><div class="row" style="gap:10px;padding:6px 0 4px">${k ? payBadge(k, 30) : `<span class="pay pay--none" style="width:30px;height:30px">?</span>`}<div class="grow"><div class="strong">${k ? (k === "Manual" ? "Paid by hand" : "Cancel in " + k) : "Not set yet"}</div><div class="meta">${k ? esc(PAY[k].how) : "Add “Paid via” to these in Notion’s Subscriptions table."}</div></div><span class="meta">${inr(l.reduce((s, x) => s + x.monthly, 0))}/mo</span></div>
      ${l.map((s) => `<div class="list-row" style="padding-left:40px"><div class="grow" style="min-width:0"><div class="ellip" style="font-weight:500;color:var(--black)">${esc(s.name)}</div><div class="meta ellip">${[s.paidVia.filter((x) => x !== k).map((x) => "paid with " + x).join(", "), s.cycle === "Yearly" ? "yearly" : "", s.status === "Ending" ? "won’t renew" : ""].filter(Boolean).join(" · ") || (s.cycle === "Yearly" ? "Yearly" : "Monthly")}</div></div>${dueChip(s)}<span class="strong">${amt(s.amount || 0)}</span></div>`).join("")}</section>`).join("")}</div>`, true);
}

// ---------- statement upload: add whatever the alerts missed, and set the balance from the bank's own figure ----------
// Bank exports differ, so columns are found by their names. HDFC's XLS and "Delimited" downloads both work.
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim()));
}
function stmtDate(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (!m) return null;
  const y = m[3].length === 2 ? "20" + m[3] : m[3], mo = +m[2], d = +m[1];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : null;
}
const stmtNum = (v) => { const n = parseFloat(String(v || "").replace(/[^\d.-]/g, "")); return isFinite(n) ? Math.abs(n) : 0; };
function readStatement(rows) {
  const h = rows.findIndex((r) => r.some((c) => /narration|description|particulars|remarks/i.test(c)) && r.some((c) => /withdraw|debit|deposit|credit|amount/i.test(c)));
  if (h < 0) throw new Error("couldn’t find the column headings (Date, Narration, Withdrawal, Deposit)");
  const H = rows[h], col = (re, not) => H.findIndex((c) => re.test(c) && !(not && not.test(c)));
  const C = { date: col(/date/i, /value/i), desc: col(/narration|description|particulars|remarks/i), ref: col(/ref|chq|cheque/i),
    dr: col(/withdraw|debit|\bdr\b/i, /cr$|\/cr/i), cr: col(/deposit|credit|\bcr\b/i, /^dr|dr\//i), amt: col(/amount/i, /withdraw|deposit|debit|credit/i),
    side: col(/dr\s*\/\s*cr|type/i), bal: col(/balance/i) };
  if (C.date < 0 || (C.dr < 0 && C.cr < 0 && C.amt < 0)) throw new Error("couldn’t find the date and amount columns");
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const day = stmtDate(r[C.date]); if (!day) continue;
    let dr = C.dr >= 0 ? stmtNum(r[C.dr]) : 0, cr = C.cr >= 0 ? stmtNum(r[C.cr]) : 0;
    if (!dr && !cr && C.amt >= 0) { const a = stmtNum(r[C.amt]); if (/cr/i.test(r[C.side] || "")) cr = a; else dr = a; }
    if (!dr && !cr) continue;
    const desc = (r[C.desc] || "").replace(/\s+/g, " ").trim();
    // UPI rows carry their 12-digit reference, the same one the nightly sync files as Ref ID.
    const ref = ((r[C.ref] || "").replace(/^0+/, "") || (desc.match(/\b(\d{12})\b/) || [])[1] || "").replace(/[^\w.-]/g, "").slice(0, 60);
    const chk = H.findIndex((c) => c === "Check");
    out.push({ day, desc, ref, type: cr ? "Credit" : "Debit", amount: cr || dr, balance: C.bal >= 0 && r[C.bal] ? stmtNum(r[C.bal]) : null, check: chk >= 0 ? r[chk] || "" : "" });
  }
  return out;
}
// Already in Notion: same bank reference, or failing that the same direction and amount within a day.
function missingFrom(rows, have) {
  const pool = have.map((t) => ({ ...t, day: t.date.slice(0, 10), used: false }));
  const norm = (x) => String(x || "").replace(/^0+/, "");
  return rows.map((r) => {
    const hit = (r.ref && pool.find((t) => !t.used && norm(t.refId) === r.ref)) ||
      pool.find((t) => !t.used && t.type === r.type && Math.abs(Math.abs(t.amount) - r.amount) < 0.01 && Math.abs(daysBetween(t.day, r.day)) <= 1);
    if (hit) hit.used = true;
    return { ...r, found: !!hit };
  });
}
// What a new row is called. UPI rows name the person, so they're filed by handle only, like the nightly sync does.
function stmtRow(r) {
  // HDFC joins parts with "-", and handles can hold one too (name-1@okaxis), so known payees win over the pattern.
  const low = r.desc.toLowerCase(), known = S.D.tx.map((t) => t.payee).filter((p) => p && p.includes("@") && low.includes(p.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  const vpa = known || ((r.desc.match(/[\w.]+@[a-z]+/i) || [])[0] || "").toLowerCase();
  const kind = (r.desc.match(/^(UPI|NEFT|IMPS|RTGS|POS|ATW|ATM|NWD|EAW|ACH|ECS|EMI|INT|BIL|ME)/i) || [])[1]?.toUpperCase() || "";
  // A payee you've seen before keeps the name it had (Swiggy, not "UPI payment"), so statement rows read like the rest.
  const seen = vpa && S.D.tx.find((t) => t.payee === vpa && t.entry && !/^(UPI|NEFT|IMPS|RTGS) /.test(t.entry));
  const entry = seen ? seen.entry : kind === "UPI" ? (r.type === "Credit" ? "UPI credit" : "UPI payment")
    : ["NEFT", "IMPS", "RTGS"].includes(kind) ? `${kind} ${r.type === "Credit" ? "credit" : "transfer"}`
    : ["ATW", "ATM", "NWD", "EAW"].includes(kind) ? "Cash withdrawal" : r.desc.replace(/X{3,}\d*|\d{6,}/g, "").replace(/[-_/*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Bank transaction";
  const L = S.D.learnedFor({ type: r.type, payee: vpa, entry: r.desc, amount: r.amount, source: kind === "UPI" ? "UPI" : ["NEFT", "IMPS", "RTGS"].includes(kind) ? "NEFT" : kind === "POS" ? "Debit Card" : "Other" });
  const ownMoney = /indmoney|indstocks|binance|^rev[- ]/i.test(r.desc); // money back from your investments, or a bounced transfer
  const category = ownMoney ? "Investing & Trading" : L ? L.cat : ["ATW", "ATM", "NWD", "EAW"].includes(kind) ? "In Cash" : r.type === "Credit" ? (r.amount >= 15000 ? "Income" : "Transfers") : "Personal Expense";
  // A big credit is never filed as Income without you: it may be your own money coming back.
  const learned = !!L && !(category === "Income" && r.amount >= 15000);
  return { entry, payee: vpa, category, learned, source: kind === "UPI" ? "UPI" : ["NEFT", "IMPS", "RTGS"].includes(kind) ? "NEFT" : kind === "POS" ? "Debit Card" : "Other" };
}
// PDF statements are read in this browser with pdf.js; the file and its password never leave the device.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const PW_KEY = "stmt-pw";
const loadScript = (src) => new Promise((ok, fail) => document.head.append(Object.assign(document.createElement("script"), { src, onload: ok, onerror: () => fail(new Error("couldn’t load the reader, check your connection")) })));
async function openPdf(file, password) {
  if (!window.pdfjsLib) { await loadScript(PDFJS + "pdf.min.js"); pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; }
  return pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise;
}
// Rebuilds the statement table from where each piece of text sits on the page. Headings can sit left, centred or
// right of their text, so each column runs from halfway after the previous heading to halfway before the next one.
// A line starting with a date opens a row, wrapped lines below add to its narration, the last amount on a row is the
// closing balance, and the balance moving up or down decides money in or out.
const AMOUNT = /^[\d,]+\.\d{2}$/;
const COLS = [["date", /^date$/i], ["narr", /narration|description|particulars/i], ["ref", /ref|chq|cheque/i], ["vdt", /value/i],
  ["wd", /withdraw|debit/i], ["dep", /deposit|credit/i], ["bal", /closing|balance/i]];
async function pdfTable(pdf) {
  const out = [["Date", "Narration", "Ref", "Withdrawal", "Deposit", "Closing Balance", "Check"]];
  let B = null, row = null, prevBal = null;
  const colOf = (it) => { const c = it.x + it.w / 2; return B.find((b) => c >= b.from && c < b.to)?.k; };
  for (let p = 1; p <= pdf.numPages; p++) {
    const items = (await (await pdf.getPage(p)).getTextContent()).items.filter((i) => i.str.trim())
      .map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width })).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) { const l = lines.find((l) => Math.abs(l.y - it.y) <= 2); if (l) l.items.push(it); else lines.push({ y: it.y, items: [it] }); }
    let lastY = null;
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      const text = l.items.map((i) => i.s).join(" ");
      if (/narration|description|particulars/i.test(text) && /withdraw|debit|deposit|credit/i.test(text)) {
        const found = COLS.map(([k, re]) => { const it = l.items.find((i) => re.test(i.s) && !(k === "date" && /value/i.test(i.s))); return it && { k, c: it.x + it.w / 2 }; })
          .filter(Boolean).sort((a, b) => a.c - b.c);
        B = found.map((h, n) => ({ k: h.k, from: n ? (found[n - 1].c + h.c) / 2 : -Infinity, to: n < found.length - 1 ? (h.c + found[n + 1].c) / 2 : Infinity }));
        row = null; continue;
      }
      if (!B) continue;
      if (/statement summary/i.test(text)) return out;
      const first = l.items[0];
      if (stmtDate(first.s) && colOf(first) === "date") {
        const cell = (k) => l.items.filter((i) => colOf(i) === k).map((i) => i.s).join(" ");
        const amts = l.items.filter((i) => AMOUNT.test(i.s)), bal = amts.length > 1 ? stmtNum(amts[amts.length - 1].s) : null, a = amts.length > 1 ? amts[0] : null;
        let dr = "", cr = "", check = "";
        if (a) {
          const v = stmtNum(a.s), up = prevBal != null && bal != null && Math.abs(prevBal + v - bal) < 0.02, down = prevBal != null && bal != null && Math.abs(prevBal - v - bal) < 0.02;
          const credit = up ? true : down ? false : colOf(a) === "dep";
          if (prevBal != null && !up && !down) check = "doesn’t add up with the balance";
          credit ? (cr = String(v)) : (dr = String(v));
        }
        if (bal != null) prevBal = bal;
        row = [first.s, cell("narr"), (cell("ref").match(/\d{6,}/) || [""])[0], dr, cr, bal == null ? "" : String(bal), check];
        out.push(row); lastY = l.y;
      } else if (row && lastY != null && lastY - l.y < 14) {
        // A wrapped narration line sits just below its row; page headers and footers sit far away.
        const more = l.items.filter((i) => colOf(i) === "narr").map((i) => i.s).join(" ");
        if (more) { row[1] += (/-$/.test(row[1]) ? "" : " ") + more; lastY = l.y; }
      }
    }
  }
  return out;
}
async function loadSheet(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return parseCsv(await file.text());
  if (!/\.xlsx?$/i.test(file.name)) throw new Error("this file type can’t be read; use the PDF, XLS or CSV download");
  if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }).map((r) => r.map((x) => String(x).trim()));
}
function statementDrawer() {
  const st = S.stmt;
  const saved = !!ls.get(PW_KEY);
  const body = !st ? `<p class="meta" style="margin:-6px 0 0;color:var(--ink)">For anything the email alerts missed. Use HDFC’s statement as it comes: the locked PDF works, and so do XLS and CSV downloads.</p>
      <label class="drop"><input type="file" accept=".pdf,.xls,.xlsx,.csv,.txt" data-a="stmtFile" hidden><span class="strong">Drop your statement here</span><span class="meta">or tap to choose · PDF (locked is fine), XLS or CSV</span></label>
      <p class="meta">The file is read on this device and never uploaded. ${saved ? `Your PDF password is saved in this browser. <button type="button" class="link" data-a="stmtForget">Forget it</button>` : ""}</p>
      <p class="meta">Only rows Notion doesn’t have yet are added, matched on the bank’s reference number. They go to To review so you can check the category.</p>`
    : st.reading ? `<div class="empty" style="padding:28px 0">Reading ${esc(st.name)}…</div>`
    : st.locked ? (saved && !st.typing && !st.wrong
      ? `<p style="margin:0">${esc(st.name)} is locked. Unlock it with your saved password?</p><div class="actions"><button type="button" class="btn" data-a="stmtTypePw">Use a different one</button><button class="btn btn--primary" data-a="stmtUseSaved">Use saved password</button></div>`
      : `<p style="margin:0">${esc(st.name)} is locked. Enter the statement password (for HDFC it’s usually your Customer ID).</p>
        ${st.wrong ? `<div class="meta" style="color:var(--red)">That password didn’t open it. Try again.</div>` : ""}
        ${field("Password", `<input class="input" id="stmt-pw" type="password" autocomplete="off" required>`)}
        <label class="row" style="gap:10px"><input type="checkbox" class="check" id="stmt-remember" checked><span>Remember on this device</span></label>
        <div class="actions"><button class="btn btn--primary" data-a="stmtUnlock">Unlock</button></div>`)
    : st.error ? `<div class="banner" style="margin:0"><span style="color:var(--yellow)">${icon("warn", 18)}</span><div class="grow"><div class="strong">Couldn’t read ${esc(st.name)}</div><div class="meta" style="color:var(--ink)">${esc(st.error)}</div></div></div><button class="btn" data-a="stmtReset">Try another file</button>`
    : `<div class="row" style="gap:8px;flex-wrap:wrap">${chip(`${st.rows.length} rows`, "line")}${chip(`${st.rows.length - st.missing.length} already in Notion`, "green")}${chip(`${st.missing.length} missing`, st.missing.length ? "yellow" : "line")}</div>
      ${st.old ? `<p class="meta">${st.old} rows from before ${shortDay(S.live.since)} were skipped; the site only reads the last 13 months.</p>` : ""}
      ${st.close ? `<label class="row" style="gap:12px;padding:12px;background:var(--surface);border-radius:12px"><input type="checkbox" class="check" id="stmt-bal" ${st.closeNewer ? "checked" : ""}><span class="grow"><span class="strong">Set bank balance to <span class="amt">${inr(st.close.balance, 2)}</span></span><br><span class="meta">Closing balance on ${shortDay(st.close.day)}${st.closeNewer ? "" : ", older than your latest snapshot"}</span></span></label>` : ""}
      ${st.missing.length ? `<div class="stack" style="gap:0">${st.missing.map((r, i) => `<label class="list-row" style="gap:12px"><input type="checkbox" class="check" data-stmt="${i}" checked><div class="grow" style="min-width:0"><div class="ellip" style="font-weight:500;color:var(--black)">${esc(r.entry)}</div><div class="meta ellip">${shortDay(r.day)}${r.payee ? " · " + esc(r.payee) : ""} · ${r.learned ? "learned: " : ""}${esc(r.category)}</div>${r.desc ? `<div class="meta ellip" title="${esc(r.desc)}">${esc(r.desc)}</div>` : ""}${r.check ? `<div class="meta" style="color:var(--yellow)">Check this one: ${esc(r.check)}</div>` : ""}</div><span class="strong">${r.type === "Credit" ? `<span class="amt pos">+${inr(r.amount)}</span>` : amt(r.amount)}</span></label>`).join("")}</div>` : `<p class="meta">Nothing missing. Every row in this statement is already in Notion.</p>`}`;
  const actions = st?.rows ? `<div class="actions"><button class="btn" data-a="stmtReset">Another file</button><button class="btn btn--primary" data-a="stmtSave">${st.missing.length ? `Add ${st.missing.length}${st.close ? " and update balance" : ""}` : st.close ? "Update balance" : "Done"}</button></div>` : "";
  openDialog(`<form class="pop" method="dialog"><div class="between"><h2>Upload statement</h2><button type="button" class="btn btn--icon btn--quiet" data-a="close" aria-label="Close">${icon("close")}</button></div>${body}${actions}</form>`, true);
}
async function readStatementFile(file, password, remember) {
  S.stmt = { name: file.name, reading: true }; statementDrawer();
  try {
    const table = /\.pdf$/i.test(file.name) ? await pdfTable(await openPdf(file, password)) : await loadSheet(file);
    if (password && remember) ls.set(PW_KEY, password);
    const all = readStatement(table), since = S.live.since || "0000";
    const rows = all.filter((r) => r.day >= since);
    const checked = missingFrom(rows, S.live.transactions || []);
    const missing = checked.filter((r) => !r.found).map((r) => ({ ...r, ...stmtRow(r) }));
    const withBal = all.filter((r) => r.balance != null), close = withBal[withBal.length - 1] || null;
    const latest = [...S.D.snaps].reverse().find((s) => s.bank != null);
    S.stmt = { name: file.name, rows, missing, old: all.length - rows.length, close, closeNewer: !!close && (!latest || close.day >= latest.date.slice(0, 10)) };
  } catch (e) {
    // pdf.js says "PasswordException": code 1 when a password is needed, 2 when the one given was wrong.
    if (e?.name === "PasswordException") S.stmt = { name: file.name, file, locked: true, wrong: !!password && e.code === 2 };
    else S.stmt = { name: file.name, error: e.message || String(e) };
  }
  statementDrawer();
}

// ---------- bulk bar / toast ----------
function renderBulk() {
  const box = $("#bulk"), bar = box.firstElementChild, live = bar && !bar.dataset.leaving;
  if (S.route !== "transactions" || !S.sel.size) {
    if (live) { bar.dataset.leaving = "1"; done(leave(bar)).then(() => { if (bar.dataset.leaving && bar.isConnected) bar.remove(); }); }
    return;
  }
  if (live) { const c = bar.querySelector("[data-m]"), from = c.innerHTML; c.innerHTML = `${S.sel.size} selected`; if (from !== c.innerHTML) morphFace(c); return; }
  box.innerHTML = `<div class="bulk" role="toolbar" aria-label="Bulk actions"><span class="strong" style="color:#fff" data-m="count">${S.sel.size} selected</span><select data-a="bulkCat" aria-label="Set category"><option value="">Set category</option>${catOptions()}</select><button data-a="bulk" data-x="confirm">Mark reviewed</button><button data-a="bulk" data-x="exclude">Exclude from spend</button><button data-a="selClear" aria-label="Clear selection">${icon("close")}</button></div>`;
  rise(box.firstElementChild, { y: 16, ms: 360 });
}
let toastTimer;
function toast(msg) {
  const box = $("#toast"); box.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; rise(box.firstElementChild, { y: 16, ms: 360 });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { const t = box.firstElementChild; if (t) done(leave(t)).then(() => t.isConnected && t.remove()); }, 4000);
}

// ---------- chart tooltip: follows the pointer, and a tap shows it on touch ----------
const tip = Object.assign(document.createElement("div"), { className: "tip", hidden: true });
tip.setAttribute("role", "tooltip"); document.body.append(tip);
let tipOn = false, tipOff;
function showTip(html, x, y) {
  clearTimeout(tipOff);
  if (tip.innerHTML !== html) tip.innerHTML = html;
  if (!tipOn) { tipOn = true; tip.hidden = false; rise(tip, { y: 4, ms: 160 }); }
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 14; if (left + w > innerWidth - 8) left = x - w - 14;
  let top = y - h - 12; if (top < 8) top = y + 18;
  tip.style.transform = `translate(${Math.max(8, left)}px,${top}px)`;
}
function hideTip() {
  for (const g of document.querySelectorAll(".hv")) g.style.display = "none";
  if (!tipOn) return;
  tipOn = false; const exit = leave(tip, { to: "0 4px", ms: 120 }); done(exit).then(() => { if (!tipOn) { tip.hidden = true; exit.forEach((a) => a.cancel()); } });
}
function onPoint(e) {
  const el = e.target.closest?.("[data-tip],[data-chart]");
  if (!el) { clearTimeout(tipOff); tipOff = setTimeout(hideTip, 80); return; }
  for (const g of document.querySelectorAll(".hv")) if (!el.contains(g)) g.style.display = "none";
  if (el.dataset.tip) return showTip(el.dataset.tip, e.clientX, e.clientY);
  const c = CH[+el.dataset.chart]; if (!c) return;
  const r = el.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * c.W;
  const i = Math.max(0, Math.min(c.n - 1, Math.round(((vx - c.x0) / c.pw) * (c.n - 1))));
  const g = el.querySelector(".hv"), [ln, ...dots] = g.children, x = c.pts[0][i][0];
  g.style.display = ""; ln.setAttribute("x1", x); ln.setAttribute("x2", x);
  dots.forEach((d, k) => { d.setAttribute("cx", c.pts[k][i][0]); d.setAttribute("cy", c.pts[k][i][1]); });
  showTip(c.tip(i), e.clientX, e.clientY);
}
document.addEventListener("pointermove", onPoint);
document.addEventListener("pointerdown", onPoint);
document.documentElement.addEventListener("pointerleave", hideTip);
addEventListener("scroll", hideTip, { passive: true });

// ---------- render ----------
const VIEWS = { overview, transactions, investments, goals };
const TABS = { overview: ["home", "Home"], transactions: ["lines", "Spends"], investments: ["trend", "Invest"], goals: ["goals", "Goals"] };
let enteredAt = 0, later;
// Data arriving in the background (fresh Notion data, prices, auto-filing) waits for the entrance to finish, so cards
// aren't swapped mid-rise. What you tap renders at once.
function renderQuiet() {
  const wait = 760 - (performance.now() - enteredAt);
  clearTimeout(later);
  if (wait > 0 && S.live) later = setTimeout(render, wait); else render();
}
function render() {
  clearTimeout(later);
  S.route = (location.hash.replace(/^#\/?/, "") || "overview").split("?")[0];
  if (!VIEWS[S.route]) S.route = "overview";
  document.body.classList.toggle("private", S.private);
  for (const a of document.querySelectorAll(".tab")) { const [ic, l] = TABS[a.dataset.route]; if (!a.firstChild) a.innerHTML = icon(ic) + `<span>${l}</span>`; a.classList.toggle("on", a.dataset.route === S.route); a.toggleAttribute("aria-current", a.dataset.route === S.route); }
  placePill();
  const main = $("#main");
  const view = S.live ? S.route : S.loading ? "loading" : "error", enter = view !== lastView;
  // Remember what each keyed value said, so changed ones can morph instead of snapping,
  // and where each row sat, so rows that move (one filed, one filtered out) glide to their new place.
  const before = {}, at = new Map();
  if (!enter) {
    for (const el of main.querySelectorAll("[data-m]")) before[el.dataset.m] = el.innerHTML;
    for (const el of main.querySelectorAll("[data-flip]")) { const r = el.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) at.set(el.dataset.flip, r.top); }
  }
  const hadBanner = !!main.querySelector(".banner");
  hideTip(); CH = []; SPECS = [];
  if (!S.live) main.innerHTML = S.loading ? skeleton() : header("Couldn’t load", "Nothing to show until Notion answers.", "") + errorBanner();
  else {
    const focus = document.activeElement?.id === "q";
    main.innerHTML = VIEWS[S.route]();
    if (focus) { const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
  drawCharts(main);
  mountLive(main);
  // Rows rise again when the month or a filter changes what the lists hold.
  const listKey = S.live ? [S.route, S.month, S.type, [...S.cats].sort().join()].join("|") : "";
  if (enter) { entrance(main); if (S.live) enteredAt = performance.now(); }
  else {
    for (const el of main.querySelectorAll("[data-m]")) { const from = before[el.dataset.m]; if (from !== undefined && from !== el.innerHTML) morphFace(el); }
    const banner = main.querySelector(".banner"); if (banner && !hadBanner) rise(banner);
    if (listKey !== lastList) rise([...main.querySelectorAll(".tx, .t-row, .t-day, .list-row, .fix-item, .empty")].slice(0, 24), { stagger: 18, y: 6, ms: 320 });
    else if (at.size && !calm()) for (const el of main.querySelectorAll("[data-flip]")) {
      const was = at.get(el.dataset.flip); if (was == null) continue;
      const dy = was - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1 && Math.abs(dy) < innerHeight) el.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], { duration: 340, easing: EASE });
    }
  }
  lastView = view; lastList = listKey;
  renderBulk();
}
let lastView = "", lastList = "", unreveal = null;
// The live crypto chart is React (live.js): it loads the first time the Invest page shows it, and every render moves
// its one element into the fresh card, so the line keeps running instead of starting over. Leaving the page stops it.
let liveMod;
function mountLive(main) {
  const slot = main.querySelector("[data-live]");
  if (!slot) return liveMod?.then((m) => m.stop(), () => {});
  const coins = JSON.parse(slot.dataset.live);
  (liveMod ||= import("./live.js?v=56")).then((m) => { if (slot.isConnected) slot.replaceWith(m.show(coins, { rate: S.prices.USDT, fmt: (v) => inr(v, 2), color: PLATFORM.Binance })); },
    () => { liveMod = null; if (slot.isConnected) slot.outerHTML = `<div class="empty">The live chart couldn’t load. Check your connection and refresh</div>`; });
}
// Above the fold rises in sequence; everything below waits and rises as it scrolls into view.
function entrance(main) {
  unreveal?.(); unreveal = null;
  const items = [...main.querySelectorAll(":scope > :not(.grid), :scope > .grid > :not(.stack), :scope > .grid > .stack > *")];
  const fold = innerHeight, above = [], below = [];
  for (const el of items) (el.getBoundingClientRect().top < fold ? above : below).push(el);
  rise(above, { stagger: 45 });
  for (const el of above) grow(el);
  if (below.length) unreveal = reveal(below);
}
// The active tab's pill slides to it (transform only; its size is set once per layout).
let pillAt = "";
function placePill() {
  const on = $(".tab.on"), pill = $(".rail__pill"); if (!on || !pill) return;
  const where = `${on.offsetLeft},${on.offsetTop},${on.offsetWidth},${on.offsetHeight}`; if (where === pillAt) return;
  pillAt = where;
  Object.assign(pill.style, { width: on.offsetWidth + "px", height: on.offsetHeight + "px", transform: `translate(${on.offsetLeft}px,${on.offsetTop}px)` });
  if (!pill.classList.contains("ready")) requestAnimationFrame(() => pill.classList.add("ready"));
}
addEventListener("resize", () => { requestAnimationFrame(placePill); });

// ---------- events ----------
const A = {
  month: (x) => { const i = S.D.monthKeys.indexOf(S.month) + Number(x); if (S.D.monthKeys[i]) { S.month = S.D.monthKeys[i]; S.sel.clear(); render(); } },
  cur: (x) => { S.cur = x; ls.set("cur", x); render(); },
  privacy: () => { S.private = !S.private; ls.set("private", S.private ? "1" : "0"); render(); },
  refresh: () => { loadData(); loadHealth(); },
  prices: () => loadPrices(true),
  addTx: () => addTxModal(),
  txType: (x, el) => {
    el.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el)); el.closest(".field").querySelector("[name=type]").value = x;
    const sel = el.closest("form").querySelector("[name=category]"); sel.innerHTML = catOptions(x === "Credit" ? "Income" : "Foods & Drinks", x === "Credit"); morphFace(el);
  },
  saveTx: (x, el) => { const f = el.closest("form"); if (!f.reportValidity()) return; const d = Object.fromEntries(new FormData(f)); d.amount = Number(d.amount); save({ action: "create", ...d, entry: d.entry || d.note || d.category }, "Transaction added"); },
  edit: (id) => editModal(id),
  splitOn: () => { const v = readEdit(); const half = Math.round(S.edit.amount / 2); S.edit.splits = [{ cat: v.category, amt: half }, { cat: "Home", amt: +(S.edit.amount - half).toFixed(2) }]; renderEdit(S.D.tx.find((t) => t.id === S.edit.id), v); },
  splitOff: () => { const v = readEdit(); S.edit.splits = null; renderEdit(S.D.tx.find((t) => t.id === S.edit.id), v); },
  splitAdd: () => { const v = readEdit(); S.edit.splits.push({ cat: "Personal Expense", amt: 0 }); renderEdit(S.D.tx.find((t) => t.id === S.edit.id), v); rise([...document.querySelectorAll("#modal [data-split-row]")].at(-1)); },
  splitDel: async (i) => { const v = readEdit(); await done(leave($(`#modal [data-split-row="${i}"]`))); S.edit.splits.splice(+i, 1); renderEdit(S.D.tx.find((t) => t.id === S.edit.id), v); },
  clearNote: () => { const n = $("#modal [name=note]"); n.value = ""; n.focus(); },
  saveEdit: () => {
    const v = readEdit(), e = S.edit;
    if (e.splits) {
      const sum = e.splits.reduce((s, r) => s + (Number(r.amt) || 0), 0);
      if (Math.abs(sum - e.amount) > 0.01) return toast(`Split adds up to ${inr(sum)}, needs ${inr(e.amount)}`);
      return save({ pageId: e.id, split: e.splits.map((r) => ({ category: r.cat, amount: Number(r.amt), note: v.note })), confirm: true }, "Split saved");
    }
    const ch = { category: v.category, note: v.note, exclude: v.exclude, confirm: true, ...(v.amount !== undefined && { amount: v.amount }) }; // bank payments send no amount
    quick({ pageId: e.id, ...ch }, [e.id], ch, "Saved");
  },
  filterCat: (c) => { if (c === "Unsorted") return A.show("review"); S.cats = new Set([c]); S.type = "all"; location.hash = "#/transactions"; },
  reviewOnly: () => { S.type = "review"; S.cats.clear(); },
  type: (x) => { S.type = x; render(); },
  toggleCat: (c) => { S.cats.has(c) ? S.cats.delete(c) : S.cats.add(c); render(); },
  clearCats: () => { S.cats.clear(); render(); },
  sel: (id) => { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); render(); },
  selAll: (x, el) => { const rows = [...document.querySelectorAll(".t-row")].map((r) => r.dataset.x); if (el.checked) rows.forEach((id) => S.sel.add(id)); else rows.forEach((id) => S.sel.delete(id)); render(); },
  selClear: () => { S.sel.clear(); render(); },
  bulk: (kind) => { const ids = [...S.sel], patch = { ...(kind === "exclude" ? { exclude: true } : {}), confirm: true }; S.sel.clear(); quick({ action: "bulk", pageIds: ids, ...patch }, ids, patch, `${ids.length} updated`); },
  fix: (id, el) => {
    const cat = el.dataset.y, t = S.D.tx.find((x) => x.id === id);
    const all = $("#always-" + id)?.checked;
    const ids = all && t.payee ? S.D.tx.filter((x) => x.review && x.payee === t.payee).map((x) => x.id) : [id];
    const item = el.closest(".fix-item"), go = () => quick(ids.length > 1 ? { action: "bulk", pageIds: ids.slice(0, 50), category: cat, confirm: true } : { pageId: id, category: cat, confirm: true }, ids.slice(0, 50), { category: cat, confirm: true }, ids.length > 1 ? `${ids.length} filed under ${cat}` : `Filed under ${cat}`);
    item ? done(leave(item, { to: "40px 0", ms: 200 })).then(go) : go();
  },
  budgets: () => budgetsDrawer(),
  saveBudgets: (x, el) => {
    const fd = new FormData(el.closest("form")), bodies = [];
    for (const c of SPEND_CATS) {
      const raw = fd.get(c); if (raw === null || raw === "") continue;
      const v = Number(raw), cur = S.D.budgets[c];
      if (cur && cur.amount === v) continue;
      bodies.push(cur ? { action: "budget", pageId: cur.id, amount: v } : { action: "budget", category: c, amount: v });
    }
    if (!bodies.length) return closeAll();
    for (const b of bodies) { const row = (S.live.budgets || []).find((x) => x.id === b.pageId); if (row) row.amount = b.amount; else S.live.budgets.push({ id: "new", category: b.category, amount: b.amount }); }
    S.D = derive(S.live); render();
    saveMany(bodies, "Budgets saved");
  },
  goalForm: (id) => goalModal(id),
  saveGoal: (id, el) => { const f = el.closest("form"); if (!f.reportValidity()) return; const d = Object.fromEntries(new FormData(f)); const body = { action: "goal", name: d.name, target: Number(d.target), saved: Number(d.saved || 0) }; if (d.deadline) body.deadline = d.deadline; if (d.status) body.status = d.status; if (id) body.pageId = id; save(body, id ? "Goal updated" : "Goal added"); },
  addMoney: (id) => addMoneyModal(id),
  wishForm: (id) => wishModal(id),
  wishPhotoOff: () => { const f = $("#modal form"); S.wp.draft = Object.fromEntries(new FormData(f)); S.wp.photo = S.wp.color = null; S.wp.changed = true; wishModal(S.wp.id, true); },
  cropBack: () => { URL.revokeObjectURL(S.crop.url); wishModal(S.wp.id, true); },
  cropUse: () => {
    const c = S.crop, k = c.base() * c.k, side = c.W() / k, out = document.createElement("canvas"); out.width = out.height = 600;
    out.getContext("2d").drawImage(c.img, -c.x / k, -c.y / k, side, side, 0, 0, 600, 600);
    S.wp.photo = out.toDataURL("image/jpeg", 0.85); S.wp.color = photoColor(out); S.wp.changed = true; URL.revokeObjectURL(c.url); wishModal(S.wp.id, true);
  },
  saveWish: (id, el) => { const f = el.closest("form"); if (!f.reportValidity()) return; const d = Object.fromEntries(new FormData(f)); save({ action: "wish", name: d.name, price: Number(d.price), priority: d.priority, by: d.by, note: d.note, ...(id ? { pageId: id } : {}), ...(S.wp?.changed ? { photo: S.wp.photo, color: S.wp.color || "" } : {}) }, id ? "Item updated" : "Added to wishlist"); },
  wishRemove: (id) => save({ action: "wish", pageId: id, remove: true }, "Removed from wishlist"),
  wishGoal: (id) => { const w = S.live.wishlist.find((x) => x.id === id); goalModal(null, { name: w.name, target: w.price, deadline: w.by }); },
  // Shows at once; Notion is updated in the background and the tick is undone if that fails.
  wishBought: (id) => {
    const w = S.live.wishlist.find((x) => x.id === id), before = { ...w };
    Object.assign(w, { bought: !w.bought, boughtOn: w.bought ? null : today() }); render();
    api({ action: "wish", pageId: id, bought: w.bought, boughtOn: w.boughtOn }).then(syncSoon, (e) => { Object.assign(w, before); render(); toast("Could not save: " + e.message); });
  },
  saveMoney: (id, el) => { const f = el.closest("form"); if (!f.reportValidity()) return; const d = Object.fromEntries(new FormData(f)), g = S.D.goals.find((x) => x.id === id), a = Number(d.amount); save({ action: "contribute", goalId: id, goalName: g.name, amount: a, saved: g.saved + a, date: d.date }, `Added ${inr(a)} to ${g.name}`); },
  snapshot: () => snapshotModal(),
  saveSnapshot: (x, el) => {
    const f = el.closest("form"); if (!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f)), P = portfolio();
    // Update the row for that date if the nightly sync already made one; it never wants two per day.
    const existing = [...S.D.snaps].reverse().find((s) => s.date.slice(0, 10) === d.date);
    // Today's balance is "as of now", so transactions later today still count; a past date means that day's close.
    const now = new Date(), off = -now.getTimezoneOffset(), tz = `${off < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
    const when = d.date === today() ? `${d.date}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${tz}` : d.date;
    const body = { action: "snapshot", date: when, label: `${+d.date.slice(8)} ${MON[+d.date.slice(5, 7) - 1]} ${d.date.slice(0, 4)}`, bank: Number(d.bank), checked: true, pageId: existing?.id };
    // Crypto platforms only: INDmoney's own figures are written by the nightly sync ("Investments" + Holdings Snapshots).
    const crypto = P.holdings.filter((h) => h.platform !== "INDmoney");
    if (crypto.length) {
      body.holdings = crypto.map((h) => [h.platform, h.asset, h.type, h.qty, h.value.toFixed(2), h.investedUsdt != null ? h.investedUsdt + " USDT" : h.invested ?? ""].join(" | ")).join("\n");
      if (P.byPlatform.Binance != null) body.binance = +P.byPlatform.Binance.toFixed(2);
    }
    if (!existing && P.byPlatform.INDmoney != null) body.investments = +P.byPlatform.INDmoney.toFixed(2);
    save(body, existing ? "Snapshot updated" : "Snapshot saved");
  },
  holding: (i) => holdingDrawer(+i),
  subs: () => subsDrawer(),
  statement: () => { S.stmt = null; statementDrawer(); },
  stmtReset: () => { S.stmt = null; statementDrawer(); },
  stmtUseSaved: () => readStatementFile(S.stmt.file, ls.get(PW_KEY)),
  stmtTypePw: () => { S.stmt.typing = true; statementDrawer(); },
  stmtUnlock: (x, el) => { const pw = $("#stmt-pw")?.value; if (!pw) return $("#stmt-pw")?.focus(); readStatementFile(S.stmt.file, pw, $("#stmt-remember")?.checked); },
  stmtForget: () => { try { localStorage.removeItem(PW_KEY); } catch {} toast("Saved password removed"); statementDrawer(); },
  stmtSave: async (x, el) => {
    const st = S.stmt, d = $("#drawer");
    const pick = st.missing.filter((r, i) => d.querySelector(`[data-stmt="${i}"]`)?.checked);
    const bal = st.close && d.querySelector("#stmt-bal")?.checked;
    if (!pick.length && !bal) return closeAll();
    el.disabled = true; let n = 0;
    try {
      for (const r of pick) {
        el.textContent = `Adding ${++n} of ${pick.length}`;
        await api({ action: "create", entry: r.entry, amount: r.amount, type: r.type, category: r.category, date: r.day, source: r.source, payee: r.payee || undefined, refId: r.ref || undefined, note: "from bank statement", review: !r.learned, auto: r.learned });
      }
      if (bal) { const row = [...S.D.snaps].reverse().find((s) => s.date.slice(0, 10) === st.close.day);
        await api({ action: "snapshot", date: st.close.day, bank: st.close.balance, checked: true, pageId: row?.id, label: `${+st.close.day.slice(8)} ${MON[+st.close.day.slice(5, 7) - 1]} ${st.close.day.slice(0, 4)}` }); }
      S.stmt = null; closeAll(); toast([pick.length && `${pick.length} added from your statement`, bal && "balance updated"].filter(Boolean).join(", ")); loadData(true);
    } catch (e) { el.disabled = false; el.textContent = "Try again"; toast(`Stopped after ${n - 1} of ${pick.length}: ${e.message}`); loadData(true); }
  },
  show: (x) => { S.type = x; S.cats.clear(); location.hash = "#/transactions"; },
  learnAll: () => {
    const groups = {};
    for (const t of S.D.months[S.month].tx) { const l = t.review && S.D.learnedFor(t); if (l) (groups[l.cat] ||= []).push(t.id); }
    const ids = Object.values(groups).flat(); if (!ids.length) return;
    for (const t of S.live.transactions) for (const [c, g] of Object.entries(groups)) if (g.includes(t.id)) Object.assign(t, { category: c, status: "Confirmed" });
    S.D = derive(S.live); render(); toast(`${ids.length} filed from what you taught it`);
    const bodies = Object.entries(groups).flatMap(([c, g]) => Array.from({ length: Math.ceil(g.length / 50) }, (_, i) => ({ action: "bulk", pageIds: g.slice(i * 50, i * 50 + 50), category: c, confirm: true })));
    (async () => { try { for (const b of bodies) await api(b); syncSoon(); } catch (e) { toast("Could not save: " + e.message); loadData(true); } })();
  },
  close: (x, el) => closeDialog(el.closest("dialog")),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]"); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  if (el.tagName === "SELECT") return;
  // Clicking a checkbox inside a clickable row shouldn't also open the row.
  if (el.classList.contains("t-row") && e.target.closest("input")) return;
  if (el.tagName === "BUTTON" && el.closest("form") && !["close"].includes(el.dataset.a)) e.preventDefault();
  if (el.tagName === "A" && el.dataset.a === "reviewOnly") { fn(el.dataset.x, el); return; }
  S.pressed = el;
  fn(el.dataset.x, el);
});
// Drag a statement onto the upload box, or anywhere on the Transactions page, to read it.
const dragsFile = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
const dropOk = () => S.live && (S.route === "transactions" || $("#drawer").open);
// An open wishlist popup takes a dropped photo straight to the crop screen.
const photoDrop = () => $("#modal").open && $("#modal [data-a=wishFile]");
document.addEventListener("dragover", (e) => {
  if (dragsFile(e) && photoDrop()) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; document.querySelector("#modal .wish-drop")?.classList.add("over"); return; }
  if (!dragsFile(e) || !dropOk()) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  document.querySelector(".drop")?.classList.toggle("over", !!e.target.closest?.(".drop"));
  document.body.classList.toggle("dragging", !$("#drawer").open); // the page-wide hint only when the upload box isn't showing
});
const dragEnd = () => { document.body.classList.remove("dragging"); document.querySelectorAll(".drop.over,.wish-drop.over").forEach((x) => x.classList.remove("over")); };
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) dragEnd(); });
document.addEventListener("drop", (e) => {
  if (dragsFile(e) && photoDrop()) { e.preventDefault(); dragEnd(); const f = e.dataTransfer.files[0]; if (f) cropModal(f); return; }
  if (!dragsFile(e) || !dropOk()) return;
  e.preventDefault(); dragEnd();
  const file = e.dataTransfer.files[0]; if (file) readStatementFile(file);
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.a === "stmtFile" && el.files[0]) return readStatementFile(el.files[0]);
  if (el.dataset.a === "wishFile" && el.files[0]) return cropModal(el.files[0]);
  if (el.dataset.a === "bulkCat" && el.value) { const ids = [...S.sel], cat = el.value; S.sel.clear(); quick({ action: "bulk", pageIds: ids, category: cat, confirm: true }, ids, { category: cat, confirm: true }, `Filed under ${cat}`); }
});
// Enter inside a form runs its primary action instead of closing the dialog.
document.addEventListener("submit", (e) => { e.preventDefault(); e.target.querySelector(".btn--primary[data-a]")?.click(); });
document.addEventListener("input", (e) => { if (e.target.id === "q") { S.q = e.target.value; render(); } });
for (const d of document.querySelectorAll("dialog")) {
  // Only a click that starts and ends outside closes it: selecting the note and letting go past the edge used to close it.
  let downOn = null;
  d.addEventListener("pointerdown", (e) => { downOn = e.target; });
  d.addEventListener("click", (e) => { if (e.target === d && downOn === d) closeDialog(d); });
  d.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(d); }); // Escape leaves instead of vanishing
}
window.addEventListener("hashchange", () => { S.sel.clear(); window.scrollTo(0, 0); render(); if (S.route === "investments") loadPrices(); });

// Instant paint from the last visit, then refresh in the background (numbers that changed morph in).
if (fromCache()) { render(); loadPrices(); loadData(true); } else { render(); loadData(); }
loadHealth();
