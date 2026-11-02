// HDFC alert sync without an LLM. Every 15 minutes: read new HDFC alert emails from Gmail (read-only),
// parse them with the regexes below, skip Ref IDs Notion already has, and add the rest to the Expense Tracker.
// Same conventions as hourly-sync-instructions.txt, so the Claude routines and this Worker dedupe against each other.
// Never writes Bank balance (the site counts it) and never stores a person's name.
import Anthropic from '@anthropic-ai/sdk';

const EXPENSES_DS = '00000000-0000-0000-0000-000000000001';
const SNAPSHOTS_DS = '00000000-0000-0000-0000-000000000003';
const GMAIL_QUERY = '{from:alerts@hdfcbank.bank.in from:alerts@hdfcbank.net} newer_than:3d';
const KEEP_MS = 4 * 864e5; // remember handled message ids a day longer than the Gmail window
const MAX_NEW = 10; // the free plan allows 50 outbound requests per run; the rest wait for the next run

/* ---------- parsing --------------------------------------------------------- */

const num = (s) => Number(String(s).replace(/,/g, ''));
const pad = (n) => String(n).padStart(2, '0');
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// An IST wall-clock time written with its offset, e.g. 2026-10-22T08:50:54+05:30.
const ist = (y, m, d, hh = 12, mm = 0, ss = 0) => `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}+05:30`;
const istFromEpoch = (ms) => {
  const t = new Date(Number(ms) + 5.5 * 36e5);
  return ist(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds());
};

export function htmlToText(html) {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/\s+/g, ' ').trim();
}

// Notices that are not money moving, or that repeat a charge another alert already reports
// (e-mandate "paid" and "added to ME DC SI" both follow a "debited via Debit Card" alert).
const SKIP = /e-?mandate|autopay|forex conversion markup|transaction decline|declined|failed|added to me dc si|addition of the payee|account statement|service request|secure usage tips/i;

// Returns null for anything that is not a transaction, else
// { type, amount, ref, date, source, payee, name, person, note? }. `name` is a merchant name or ''.
export function parseAlert(text, { id, internalDate }) {
  const t = text.replace(/\s+/g, ' ');
  const when = istFromEpoch(internalDate);
  let m;

  // UPI debit: "Rs.433.00 is debited from your account ending 1234 towards VPA x@y (NAME) on 22-10-26. UPI transaction reference no.: 1316..."
  if ((m = /Rs\.?\s*([\d,]+(?:\.\d+)?) is debited from your account ending \w+ towards VPA (\S+) \(([^)]*)\) on [\d-]+\.? UPI transaction reference no\.?:?\s*(\d+)/i.exec(t)))
    return upi('Debit', m[1], m[2], m[3], m[4], when);

  // UPI credit: "Rs.350.00 has been successfully credited ... Sender: NAME (VPA: x@y) c. UPI Reference No.: 6660..."
  if ((m = /Rs\.?\s*([\d,]+(?:\.\d+)?) has been successfully credited to your [\w ]*account ending in \w+\..*?Sender: (.*?) \(VPA: (\S+?)\) c\. UPI Reference No\.?:?\s*(\d+)/i.exec(t)))
    return upi('Credit', m[1], m[3], m[2], m[4], when);

  // Debit card: "Rs.9111.64 is debited from your HDFC Bank Debit Card ending 4321 at ANTHROPIC* CLAUDE SUB on 21 Oct, 2026 at 15:40:31."
  if ((m = /Rs\.?\s*([\d,]+(?:\.\d+)?) is debited from your [\w ]*Debit Card ending \w+ at (.+?) on (\d{1,2}) (\w{3}),? (\d{4}) at (\d\d):(\d\d):(\d\d)/i.exec(t))) {
    const merchant = cleanMerchant(m[2]);
    return { type: 'Debit', amount: num(m[1]), ref: id, source: 'Debit Card', payee: merchant, name: merchant, person: false,
      date: ist(m[5], MON[m[4].toLowerCase()], m[3], m[6], m[7], m[8]) };
  }

  // Card refund: "a transaction for Rs 103.76, on your HDFC Bank Debit Card ending 4321 at ORACLE SINGAPORE on 29-09-2026 22:40:59 is reversed"
  if ((m = /transaction for Rs\.?\s*([\d,]+(?:\.\d+)?),? on your [\w ]*Debit Card ending \w+ at (.+?) on (\d\d)-(\d\d)-(\d{4}) (\d\d):(\d\d):(\d\d) is reversed/i.exec(t))) {
    const merchant = cleanMerchant(m[2]);
    return { type: 'Credit', amount: num(m[1]), ref: id, source: 'Debit Card', payee: merchant, name: merchant, person: false,
      date: ist(m[5], m[4], m[3], m[6], m[7], m[8]), note: 'card refund' };
  }

  // IMPS / NEFT out: "INR 1,00,000.00 has been debited from your account ending xx1234 on 12-10-26 and credited to the account ending xx0099 via IMPS. IMPS Reference No: 6285..."
  if ((m = /INR\s*([\d,]+(?:\.\d+)?) has been debited from your account ending \w+ on [\d-]+ and credited to the account ending x*(\d+) via (IMPS|NEFT|RTGS)\.? \w+ Reference No\.?:?\s*(\w+)/i.exec(t)))
    return { type: 'Debit', amount: num(m[1]), ref: m[4], source: m[3].toUpperCase() === 'NEFT' ? 'NEFT' : 'Other',
      payee: `A/c ${m[2].slice(-4)}`, name: '', person: false, date: when, entry: `${m[3].toUpperCase()} transfer to A/c ${m[2].slice(-4)}` };

  // Deposit: "Amount received: INR 40,111.89 Account: XX1234 Date: 21-OCT-2026 Reference Details: NEFT Cr-CITI0100000-... Available Balance"
  if ((m = /Amount received: INR\s*([\d,]+(?:\.\d+)?) Account: \w+ Date: [\w-]+ Reference Details: (.*?) Available Balance/i.exec(t))) {
    const r = m[2];
    // The reference carries the sender's name, so keep only a known source or the sender bank's IFSC.
    const known = /indmoney|indstocks/i.test(r) ? 'INDmoney' : /skydo/i.test(r) ? 'Skydo' : /wise/i.test(r) ? 'Wise' : /\bciti/i.test(r) ? 'Citi' : ''; // INDmoney Global pays from Citi too
    const ifsc = (/\b([A-Z]{4}0[A-Z0-9]{6})\b/.exec(r) || [])[1];
    const reversal = /^rev[- ]/i.test(r);
    return { type: 'Credit', amount: num(m[1]), ref: id, source: /\bNEFT\b/i.test(r) ? 'NEFT' : 'Other', date: when, person: !known,
      payee: known || (reversal ? 'IMPS reversal' : ifsc ? `NEFT ${ifsc}` : 'Bank credit'), name: known,
      entry: known ? `${known} credit` : reversal ? 'IMPS reversal' : 'Bank credit', reversal };
  }

  // Anything else that still says money moved: keep it for review rather than lose it.
  if (!SKIP.test(t) && (m = /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)[^.]{0,80}?\b(debited|credited|deducted|withdrawn|spent)\b/i.exec(t)))
    return { type: /credited/i.test(m[2]) ? 'Credit' : 'Debit', amount: num(m[1]), ref: id, source: 'Other', date: when,
      payee: '', name: '', person: false, entry: 'HDFC alert', unknown: true };
  return null;
}

function upi(type, amount, vpa, display, ref, date) {
  const biz = isBusiness(display, vpa);
  const name = biz ? merchantName(display, vpa) : '';
  // `display` is only stored once it is known to be a business (here, or by aiGuess in save): it may be a person's name.
  return { type, amount: num(amount), ref, source: 'UPI', date, name, person: !biz, payee: name || vpa, display };
}
const cleanMerchant = (s) => s.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- categories (hourly-sync-instructions.txt, in code) -------------- */

// Shops whose payment is a mixed basket: the daily Claude run splits these from the order email.
// Blinkit and Zepto send no item email, so theirs are filed straight away (see NO_EMAIL in categorize).
const SHOPS = [['instamart', 'Swiggy Instamart'], ['amazon', 'Amazon'], ['zepto|kiranakart', 'Zepto'], ['blinkit|blink commerce', 'Blinkit'], ['bigbasket', 'BigBasket'],
  ['flipkart', 'Flipkart'], ['myntra', 'Myntra'], ['nykaa', 'Nykaa']];
const RULES = [
  [/\bapple\b|adobe|canva|netflix|trading ?view|google|twitter|\bx corp/i, 'Subscription'],
  [/indstocks|the ?5ers|five ?percent/i, 'Investing & Trading'],
  // Binance INR deposits go by IMPS to the payees "BINANCE NAHEED" (A/c ..6000) and "VIRTUAL VAULT BINANCE" (A/c ..0099).
  [/\bA\/c (6000|0099)\b/, 'Investing & Trading', 'Binance deposit'],
  [/irctc|iruts|rail ?one|indian railway|\buts\b/i, 'Transport', 'train ticket'],
  [/mumbai metro|mmrda|mmopl/i, 'Transport', 'metro'],
  [/swiggy|bundl|pizza ?hut|zomato|restaurant|\bcafe|café|sweet|bakery|dhaba|\bhotel|kitchen|snacks/i, 'Foods & Drinks'],
  [/pharma|chemist|medical|medplus|netmeds|apollo/i, 'Personal Expense', 'pharmacy'],
];
// A display name only counts as a merchant when it says so; anything else may be a person and is never stored.
const BUSINESS = /\b(llp|pvt|private|ltd|limited|inc|store|stores|mart|enterprises?|traders|trading|hotel|inn|cafe|restaurant|foods?|snacks|sweets|medical|pharma|chemist|bakery|dairy|services|solutions|technologies|retail|kitchen|dhaba|agency|agencies|company|co)\b/i;
const KNOWN = new RegExp([...SHOPS.map((s) => s[0]), 'swiggy', 'zomato', 'bundl', 'pizzahut', 'pizza hut', 'irctc', 'netflix', 'google', 'apple', 'adobe', 'canva', 'tradingview', 'indstocks', 'godaddy'].join('|'), 'i');

// Handles only merchants get, which HDFC leaves readable after masking (`****203n@ptys`): Paytm for Business, Google
// Pay for Business, Airtel merchants, PayU, Razorpay, BillDesk (bdpg, bdsi), Paytm's gateway, BharatPe, PhonePe QR.
const MERCHANT_VPA = /@(ptys|pty|okbiz\w*|mairtel|yespay)$|payu@|razorpay|\brzp\b|\bbd(pg|si)\b|paytmqr|ytm@hdfcbank|bharatpe|cashfree|^q\d+@ybl|^gpay-/i;

function isBusiness(display, vpa) {
  return KNOWN.test(display) || KNOWN.test(vpa) || MERCHANT_VPA.test(vpa) || BUSINESS.test(display.replace(/_/g, ' '));
}
function merchantName(display, vpa) {
  const shop = SHOPS.find(([k]) => new RegExp(k, 'i').test(display + ' ' + vpa));
  if (shop) return shop[1];
  const d = display.replace(/_/g, ' ').trim();
  if (d) return d.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return (KNOWN.exec(vpa) || [''])[0].replace(/^\w/, (c) => c.toUpperCase());
}

const NO_EMAIL = ['Blinkit', 'Zepto'];
const hourOf = (iso) => Number(iso.slice(11, 13));

// Rule category for a parsed alert. { category, status, note, exclude, shop }
export function categorize(tx) {
  const text = `${tx.name} ${tx.payee}`;
  const out = (category, status = 'Confirmed', note = '') =>
    ({ category, status, note, exclude: ['Investing & Trading', 'Savings'].includes(category) });

  if (tx.unknown) return out('Personal Expense', 'Needs review', 'alert format not recognised, check the email');
  if (tx.type === 'Credit') {
    if (tx.reversal) return out('Personal Expense', 'Needs review', 'IMPS reversal, check against the transfer');
    if (tx.note === 'card refund') return out('Personal Expense', 'Needs review', `card refund from ${tx.name}`);
    // Your own money coming back is not income: INDmoney or INDstocks paying out, Binance selling out.
    if (/indmoney|indstocks|binance/i.test(text)) return out('Investing & Trading', 'Confirmed', 'money back from investments');
    if (/citi|wise|skydo/i.test(text)) return out('Income');
    // A big credit from anyone else may be pay or may be your own money back (₹4.4 lakh from INDmoney was "Income" in Sep 2026).
    if (tx.amount >= 15000) return out('Income', 'Needs review', 'big credit: income, or your own money coming back?');
    // Transfers: money moving with friends or family (lending, paid back, UPI for cash). Never spending, never income.
    return tx.person ? out('Transfers', 'Needs review', 'money received from a person') : out('Personal Expense', 'Needs review', 'money received, check what for');
  }
  if (tx.atm) return out('In Cash', 'Confirmed', 'ATM');
  const shop = SHOPS.find(([k]) => new RegExp(k, 'i').test(text));
  if (shop && NO_EMAIL.includes(shop[1])) return { ...out('Fitness & Diet', 'Auto-filed', 'mixed order, no item email'), shop: true, noEmail: true };
  if (shop) return { ...out('Personal Expense', 'Needs review', 'mixed order, split pending'), shop: true };
  for (const [re, category, note] of RULES) if (re.test(text)) return out(category, 'Confirmed', note);
  const h = hourOf(tx.date);
  if (tx.person && tx.amount >= 15 && tx.amount <= 60 && ((h >= 7 && h < 11) || (h >= 17 && h < 22)))
    return out('Transport', 'Confirmed', 'auto');
  return tx.person ? out('Transfers', 'Needs review', 'paid to a person') : out('Personal Expense', 'Needs review', '');
}

const NON_SPEND = ['Investing & Trading', 'Income', 'Savings', 'Transfers'];

// Lending pair: a credit from the handle of an earlier debit, same amount within ₹1, up to 45 days later, is that
// person paying back. Earliest unpaid debit first, as lending() in app.js pairs them. Returns the category for the
// credit and, when the debit was still waiting for review, the fix for that debit row (`lent`).
export function lendingPair(tx, cat, rows) {
  if (tx.type !== 'Credit' || !tx.payee) return null;
  const t = Date.parse(tx.date);
  const d = rows.filter((r) => r.type === 'Debit' && !/paid back/.test(r.note || '') && Math.abs(r.amount - tx.amount) <= 1
    && Date.parse(r.date) < t && t - Date.parse(r.date) <= 45 * 864e5).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  if (!d) return null;
  const spent = d.status === 'Confirmed' && d.category && !NON_SPEND.includes(d.category); // e.g. a friend's share of a dinner
  return { ...cat, category: spent ? d.category : 'Transfers', status: 'Confirmed', note: 'paid back', exclude: false,
    lent: d.status === 'Needs review' && d.id ? d.id : null };
}

// "Learned from the owner's reviews": 2+ confirmed rows with this payee and type, all one category, win.
export function applyHistory(tx, cat, rows) {
  const pair = lendingPair(tx, cat, rows);
  if (pair) return pair;
  const same = rows.filter((r) => r.status === 'Confirmed' && r.type === tx.type);
  // Blinkit / Zepto: whatever you file their orders under most (split parts included), else Fitness & Diet. Auto-filed, so
  // it sits under its own tab on the site and never trains the model.
  if (cat.noEmail) {
    const n = {};
    for (const r of same) if (r.category) n[r.category] = (n[r.category] || 0) + 1;
    const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    return top ? { ...cat, category: top[0], exclude: false } : cat;
  }
  if (cat.shop || tx.unknown) return cat;
  const cats = new Set(same.map((r) => r.category));
  if (same.length >= 2 && cats.size === 1) {
    const category = [...cats][0];
    return { category, status: 'Confirmed', note: [cat.note, 'learned'].filter(Boolean).join(', '), exclude: ['Investing & Trading', 'Savings'].includes(category) };
  }
  return cat;
}

export function entryFor(tx, cat) {
  if (tx.entry) return tx.entry;
  if (tx.name) return tx.name.split(' ').length > 3 ? tx.name.split(' ').slice(0, 3).join(' ') : tx.name;
  if (cat.note === 'auto') return 'Auto';
  return tx.type === 'Credit' ? 'UPI received' : 'UPI payment';
}

/* ---------- Gmail ----------------------------------------------------------- */

async function googleToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}
async function gmail(token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
const b64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
function bodyText(payload) {
  const parts = [];
  (function walk(p) { if (p.body?.data) parts.push([p.mimeType, b64(p.body.data)]); (p.parts || []).forEach(walk); })(payload);
  const plain = parts.find(([t]) => t === 'text/plain'), html = parts.find(([t]) => t === 'text/html');
  return html ? htmlToText(html[1]) : plain ? plain[1] : '';
}

/* ---------- Notion ---------------------------------------------------------- */

async function notion(env, path, body, method = 'POST') {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function query(env, filter, ds = EXPENSES_DS) {
  const rows = [];
  let cursor;
  do {
    const j = await notion(env, `data_sources/${ds}/query`, { filter, page_size: 100, start_cursor: cursor });
    rows.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return rows;
}
const plain = (p) => (p?.rich_text || p?.title || []).map((x) => x.plain_text).join('');
const rowOf = (pg) => ({ id: pg.id, note: plain(pg.properties.Note), ref: plain(pg.properties['Ref ID']), type: pg.properties.Type?.select?.name, category: pg.properties.Category?.select?.name,
  status: pg.properties.Status?.select?.name, amount: pg.properties.Amount?.number, date: pg.properties.Date?.date?.start || '', payee: plain(pg.properties.Payee), entry: plain(pg.properties.Entry), source: pg.properties.Source?.select?.name });
// Split parts carry "-s1", "-s2" (order splits) or "-split" (the site's split): they all mean the base ref is taken.
export const baseRef = (r) => r.replace(/-(s\d+|split)$/, '');

const txt = (s, max = 500) => ({ rich_text: [{ text: { content: String(s).slice(0, max) } }] });
function props(tx, cat) {
  return {
    Entry: { title: [{ text: { content: entryFor(tx, cat).slice(0, 200) } }] },
    Amount: { number: Math.round(tx.amount * 100) / 100 },
    Type: { select: { name: tx.type } },
    Category: { select: { name: cat.category } },
    Note: txt(cat.note || ''),
    Payee: txt(tx.payee, 200),
    Source: { select: { name: tx.source } },
    'Ref ID': txt(tx.ref, 60),
    Date: { date: { start: tx.date } },
    Status: { select: { name: cat.status } },
    'Exclude from spend': { checkbox: !!cat.exclude },
  };
}

/* ---------- saving -------------------------------------------------------- */

// The bank's "Available Balance: INR 21,111.53" / "Avl bal Rs.1234.50", or null.
export function availBalance(t) {
  const m = /(?:Avl\.?\s*Bal(?:ance)?|Available Balance|\bBal)\s*(?:is)?[:\s]*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d+)?)/i.exec(t);
  return m ? num(m[1]) : null;
}

// Card spends and deposits carry no reference the SMS and the email share (their Ref ID is the Gmail id or "sms-"),
// so for those a row with the same type and amount within 30 minutes counts as the same transaction.
// ponytail: two identical card charges inside 30 minutes would merge; match on the card's time too if that happens.
const bankRef = (r) => !/^(sms-|[0-9a-f]{16}$)/.test(r);
export function findSame(tx, rows) {
  const exact = rows.find((r) => baseRef(r.ref) === tx.ref);
  if (exact || bankRef(tx.ref)) return exact;
  const t = Date.parse(tx.date);
  return rows.find((r) => !bankRef(r.ref) && r.type === tx.type && Math.abs(r.amount - tx.amount) < 0.01 && Math.abs(Date.parse(r.date) - t) <= 18e5);
}

// Rows already in Notion from two days before `fromMs` (rows are dated by the alert, so that margin is plenty).
async function recentRows(env, fromMs) {
  const since = new Date(fromMs - 2 * 864e5).toISOString().slice(0, 10);
  return (await query(env, { property: 'Date', date: { on_or_after: since } })).map(rowOf);
}

// Workers AI (Cloudflare's free tier, not Claude) reads the name on a payment no rule or past review placed, and
// guesses its category: "SAMPLE CHAAT CORNER" is a pani puri stall, not a person. It only suggests: the row stays
// "Needs review", and the name is sent to the model but never stored. Any failure means no guess.
// Llama 3.1 8B was retired on 30 May 2026 and every call failed silently until 24 Oct. 3.3 70B sorted every test
// item right (8B fp8 called paneer Personal Expense). A few calls a day stay inside the free daily allowance.
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const AI_CATS = ['Foods & Drinks', 'Fitness & Diet', 'Home', 'Personal Expense', 'Transport', 'Subscription', 'Business', 'Transfers'];
export async function aiGuess(env, tx) {
  const name = String(tx.display || tx.name || '').trim();
  if (!env.AI || !name) return null;
  try {
    const r = await env.AI.run(AI_MODEL, { max_tokens: 12, messages: [
      { role: 'system', content: `You sort payments from an Indian bank account into budget categories. Answer with exactly one of: ${AI_CATS.join(', ')}.
Foods & Drinks: food eaten out or ready to eat: restaurants, cafes, street food, chaat, pani puri, chana or bhel stalls ("chana bhandar"), vada pav, sweet shops, tea stalls, bakeries. Fitness & Diet: raw groceries to cook or eat at home (vegetables, fruit, dairy, kirana, supermarkets, dry fruit), gyms, sports, protein and supplements. Home: hardware, cleaning, furniture, rent, electricity, gas. Personal Expense: clothes, salons, pharmacy, electronics, stationery, anything else. Transport: fuel, cabs, parking, tolls. Transfers: the payee is a private person's name, not a business.` },
      { role: 'user', content: `Payee name: "${name.slice(0, 80)}". UPI handle or card merchant: "${String(tx.payee || '').slice(0, 60)}". Amount: Rs ${tx.amount}.` },
    ] });
    const out = String(r?.response || '').toLowerCase();
    return AI_CATS.map((c) => [c, out.indexOf(c.toLowerCase())]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0]?.[0] || null;
  } catch {
    return null;
  }
}

// Adds tx unless Notion has it. Returns { added, review, at }: `at` is the time the row carries in Notion, which a
// balance from the same alert must not be earlier than (the site adds every row dated after the checked balance).
async function save(env, tx, rows) {
  const same = findSame(tx, rows);
  if (same) {
    // An SMS to a person names them, not their UPI handle, so its row has no Payee; the email that follows fills it in.
    if (tx.payee && !same.payee && same.id) { await notion(env, `pages/${same.id}`, { properties: { Payee: txt(tx.payee, 200) } }, 'PATCH'); same.payee = tx.payee; }
    // ...and a shop name the other one knew replaces "UPI payment".
    if (tx.name && /^UPI (payment|received)$/.test(same.entry || '') && same.id) {
      await notion(env, `pages/${same.id}`, { properties: { Entry: { title: [{ text: { content: entryFor(tx, {}).slice(0, 200) } }] }, Payee: txt(tx.payee, 200) } }, 'PATCH');
      same.entry = tx.name;
    }
    return { added: false, at: Math.max(Date.parse(tx.date), Date.parse(same.date) || 0) };
  }
  // A name nothing above recognised: if the model says it's a business ("SAMPLE GRILL"), keep the name, so the row
  // reads as the shop and learns by it. A person's name ("Transfers") is still never stored.
  let guess = null;
  if (tx.person && tx.display && tx.type === 'Debit') {
    guess = await aiGuess(env, tx);
    if (guess && guess !== 'Transfers') { const name = merchantName(tx.display, ''); tx = { ...tx, name, payee: name, person: false }; }
  }
  let cat = categorize(tx);
  if (tx.payee) cat = applyHistory(tx, cat, (await query(env, { property: 'Payee', rich_text: { equals: tx.payee } })).map(rowOf));
  if (cat.status === 'Needs review' && tx.type === 'Debit' && !cat.shop) {
    if (!guess && !tx.person) guess = await aiGuess(env, tx);
    if (guess && guess !== 'Transfers') cat = { ...cat, category: guess, note: 'AI guess', exclude: false };
  }
  await notion(env, 'pages', { parent: { type: 'data_source_id', data_source_id: EXPENSES_DS }, properties: props(tx, cat) });
  if (cat.lent) await notion(env, `pages/${cat.lent}`, { properties: { Category: { select: { name: 'Transfers' } },
    Status: { select: { name: 'Confirmed' } }, Note: txt('lent, paid back') } }, 'PATCH');
  rows.push({ ref: tx.ref, type: tx.type, amount: tx.amount, date: tx.date });
  return { added: true, review: cat.status === 'Needs review', at: Date.parse(tx.date) };
}

// The bank's available balance becomes the checked balance on Daily Snapshots: one row per IST day, updated in
// place, never moved back to an older figure. The site counts the balance on from there (bankBalance in app.js).
async function setBalance(env, balance, atMs) {
  const date = istFromEpoch(atMs), day = date.slice(0, 10);
  const next = istFromEpoch(Date.parse(`${day}T12:00:00+05:30`) + 864e5).slice(0, 10);
  const rows = await query(env, { and: [{ property: 'Date', date: { on_or_after: `${day}T00:00:00+05:30` } },
    { property: 'Date', date: { before: `${next}T00:00:00+05:30` } }] }, SNAPSHOTS_DS);
  const props = { 'Bank balance': { number: balance }, 'Balance checked': { checkbox: true }, Date: { date: { start: date } } };
  const row = rows[0];
  if (!row) {
    const [y, m, d] = day.split('-');
    props.Snapshot = { title: [{ text: { content: `${+d} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[m - 1]} ${y}` } }] };
    return notion(env, 'pages', { parent: { type: 'data_source_id', data_source_id: SNAPSHOTS_DS }, properties: props });
  }
  const was = row.properties.Date?.date?.start || '';
  if (row.properties['Balance checked']?.checkbox && was.length > 10 && Date.parse(was) > atMs) return null; // newer balance already there
  return notion(env, `pages/${row.id}`, { properties: props }, 'PATCH');
}

/* ---------- Gmail run (cron) ------------------------------------------------ */

// `seen` maps Gmail message ids already handled to when; the caller saves it even if this throws halfway.
export async function sync(env, seen) {
  const now = Date.now();
  for (const k of Object.keys(seen)) if (now - seen[k] > KEEP_MS) delete seen[k];

  const g = await googleToken(env);
  const list = await gmail(g, `messages?maxResults=100&q=${encodeURIComponent(GMAIL_QUERY)}`);
  const fresh = (list.messages || []).filter((m) => !seen[m.id]).reverse().slice(0, MAX_NEW); // oldest first

  const stats = { emails: fresh.length, added: 0, review: 0, duplicate: 0, ignored: 0 };
  if (!fresh.length) return stats;

  const parsed = [];
  for (const { id } of fresh) {
    const msg = await gmail(g, `messages/${id}?format=full`);
    const subject = (msg.payload.headers || []).find((h) => /^subject$/i.test(h.name))?.value || '';
    const text = `${subject}. ${bodyText(msg.payload)}`;
    const tx = parseAlert(text, { id, internalDate: msg.internalDate });
    if (tx) tx.balance = availBalance(text);
    parsed.push({ id, tx, at: Number(msg.internalDate) });
  }

  const rows = await recentRows(env, Math.min(...parsed.map((p) => p.at)));
  let latest = null; // only the newest balance of the run is written
  for (const { id, tx } of parsed) {
    if (!tx) { stats.ignored++; seen[id] = now; continue; }
    const r = await save(env, tx, rows);
    seen[id] = now; // only after Notion has the row, so a failed write is retried next run
    if (!r.added) stats.duplicate++;
    else { stats.added++; if (r.review) stats.review++; }
    if (tx.balance != null && (!latest || r.at >= latest.at)) latest = { balance: tx.balance, at: r.at };
  }
  if (latest) await setBalance(env, latest.balance, latest.at);
  return stats;
}

/* ---------- SMS (iPhone Shortcuts automation) ------------------------------- */

// HDFC SMS wording differs by product and changes often, so fields are read by keyword rather than from one
// fixed template: amount, direction, reference, VPA, merchant, card time, available balance.
export function parseSms(text, receivedAt, sender = '') {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!/hdfc/i.test(`${sender} ${t}`) || /\bOTP\b|one time password|e-?mandate|autopay|will be (debited|charged)|upcoming|declined|failed|is due|request|statement/i.test(t)) return null;
  const amt = /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)/i.exec(t);
  const dir = /\b(sent|debited|spent|withdrawn|paid|deducted|transfer(?:red)?|credited|deposited|received|refunded|reversed)\b/i.exec(t);
  if (!amt || !dir) return null;
  const type = /credited|deposited|received|refunded|reversed/i.test(dir[1]) ? 'Credit' : 'Debit';
  const at = Date.parse(receivedAt);
  let date = istFromEpoch(isNaN(at) ? Date.now() : at);
  const card = /On (\d{4})-(\d\d)-(\d\d):(\d\d):(\d\d):(\d\d)/i.exec(t); // card SMS: "On 2026-10-21:15:40:31"
  if (card) date = ist(card[1], card[2], card[3], card[4], card[5], card[6]);

  const ref = (/(?:UPI|Ref(?:erence)?|RRN)(?:\s*(?:Ref|No))*\.?[\s:.#-]*(\d{9,})/i.exec(t) || [])[1];
  const vpa = (/\b([\w.-]+@[a-z][a-z0-9]+)\b/i.exec(t) || [])[1] || '';
  const toAcct = (/to A\/?c\.?\s*[x*]*(\d{4})\b/i.exec(t) || [])[1];
  const base = { type, amount: num(amt[1]), date, balance: availBalance(t) };

  if (type === 'Debit' && /withdrawn|\bATM\b/i.test(t))
    return { ...base, ref: ref || `sms-${date}`, source: 'Debit Card', payee: 'ATM', name: 'ATM', person: false, atm: true, entry: 'ATM withdrawal' };
  if (type === 'Debit' && toAcct && /\b(IMPS|NEFT|RTGS)\b/i.test(t)) {
    const via = /\b(IMPS|NEFT|RTGS)\b/i.exec(t)[1].toUpperCase();
    return { ...base, ref: ref || `sms-${date}`, source: via === 'NEFT' ? 'NEFT' : 'Other', payee: `A/c ${toAcct}`, name: '', person: false, entry: `${via} transfer to A/c ${toAcct}` };
  }
  if (type === 'Credit' && !vpa && /deposited|NEFT Cr|Foreign INR|\bINW\b/i.test(t)) {
    const known = /indmoney|indstocks/i.test(t) ? 'INDmoney' : /skydo/i.test(t) ? 'Skydo' : /wise/i.test(t) ? 'Wise' : /\bciti/i.test(t) ? 'Citi' : ''; // INDmoney Global pays from Citi too
    const ifsc = (/\b([A-Z]{4}0[A-Z0-9]{6})\b/.exec(t) || [])[1];
    const reversal = /\brev[- ]/i.test(t);
    return { ...base, ref: `sms-${date}`, source: /\bNEFT\b/i.test(t) ? 'NEFT' : 'Other', person: !known, name: known, reversal,
      payee: known || (reversal ? 'IMPS reversal' : ifsc ? `NEFT ${ifsc}` : 'Bank credit'), entry: known ? `${known} credit` : reversal ? 'IMPS reversal' : 'Bank credit' };
  }
  if (!vpa && /\bcard\b/i.test(t)) {
    const merchant = cleanMerchant((/\bAt (.+?) On /i.exec(t) || [, ''])[1]);
    return { ...base, ref: `sms-${date}`, source: 'Debit Card', payee: merchant, name: merchant, person: false,
      note: type === 'Credit' ? 'card refund' : undefined };
  }
  // UPI. The "To"/"from" name may be a person, so it only counts when it is clearly a merchant.
  const display = ((/\b(?:To|from) (?!VPA\b|A\/c\b|HDFC\b)(.+?)(?= On | on |\(| Ref| UPI|$)/i.exec(t) || [])[1] || '').replace(/\S+@\S+/, '').trim();
  const biz = isBusiness(display, vpa);
  const name = biz ? merchantName(display, vpa) : '';
  return { ...base, ref: ref || `sms-${date}`, source: 'UPI', name, person: !biz, payee: name || vpa, display };
}

// Constant-time compare, so the token can't be guessed a character at a time from response timing.
function sameToken(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

// POST /sms  header X-Sync-Token, body { text, sender, receivedAt } from the iPhone Shortcuts automation.
export async function handleSms(request, env) {
  const path = new URL(request.url).pathname;
  const route = `${request.method} ${path}`;
  if (!['POST /sms', 'GET /health', 'POST /report', 'POST /order'].includes(route)) return new Response('Not found', { status: 404 });
  // Each key opens only its own paths: HEALTH_TOKEN is built into the iPhone's "Finance Health Check" shortcut,
  // SITE_HEALTH_TOKEN is the site's (functions/api/health.js and report.js).
  const given = request.headers.get('X-Sync-Token') || '', ok = (t) => t && t.length >= 32 && sameToken(given, t);
  const keys = { 'POST /sms': [env.SMS_TOKEN], 'GET /health': [env.SMS_TOKEN, env.HEALTH_TOKEN, env.SITE_HEALTH_TOKEN], 'POST /report': [env.SITE_HEALTH_TOKEN],
    'POST /order': [env.ORDER_TOKEN] }[route]; // ORDER_TOKEN is built into the iPhone's "Split order" shortcut
  if (!keys.some(ok)) return new Response('Unauthorized', { status: 401 });
  // An error the site hit on your phone or laptop (index.html reports it): the last 20 are kept, and the cached health
  // answer is dropped so the banner shows it on the next load.
  if (path === '/order') {
    const b = await request.json().catch(() => ({}));
    const answer = await splitOrder(env, b.text || '');
    console.log('order', answer);
    return new Response(answer);
  }
  if (path === '/report') {
    const e = await request.json().catch(() => ({}));
    if (!e.msg) return Response.json({ ok: false, error: 'msg missing' }, { status: 400 });
    const item = { at: Date.now(), msg: String(e.msg).slice(0, 200), where: String(e.where || '').slice(0, 120), page: String(e.page || '').slice(0, 40), v: String(e.v || '').slice(0, 10) };
    const list = (await env.SEEN.get('site:errors', 'json')) || [];
    await env.SEEN.put('site:errors', JSON.stringify([item, ...list].slice(0, 20)));
    await env.SEEN.delete('health:last');
    console.log('site-error', JSON.stringify(item));
    return Response.json({ ok: true });
  }
  // The iPhone asks every morning (README, "Phone alerts"): nothing when all is well, else one paragraph per problem,
  // which the Shortcut shows as a notification ("If Contents of URL has any value").
  // The answer is kept for an hour, so opening the site doesn't refresh the Zepto login or call the AI every time.
  if (path === '/health') {
    let c = await env.SEEN.get('health:last', 'json');
    if (!c || Date.now() - c.at > 36e5) { c = { at: Date.now(), problems: await health(env) }; await env.SEEN.put('health:last', JSON.stringify(c)); }
    return c.problems.length ? new Response(c.problems.join('\n\n')) : new Response(null, { status: 204 });
  }
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'body must be JSON' }, { status: 400 }); }
  const tx = parseSms(String(body.text || '').slice(0, 2000), body.receivedAt, String(body.sender || '').slice(0, 100));
  // OTPs, offers and notices are accepted and ignored, so the Shortcut never shows an error for them.
  if (!tx) return Response.json({ ok: true, result: 'ignored' });
  const r = await save(env, tx, await recentRows(env, Date.parse(tx.date)));
  if (tx.balance != null) await setBalance(env, tx.balance, r.at);
  const result = r.added ? (r.review ? 'added, needs review' : 'added') : 'already in Notion';
  console.log('hdfc-sms', result);
  await env.SEEN.put('health:sms', String(Date.now())); // the iPhone automation is alive (see health)
  return Response.json({ ok: true, result });
}

/* ---------- Zepto orders ------------------------------------------------------ */

// Zepto sends no item email, but its own MCP (mcp.zepto.co.in) lists past orders with each item's price. Its own cron
// (ZEPTO_CRON, a separate 50-request budget) finds Zepto payments not yet split, matches each to an order by total
// (within ₹1) and time (within 6 hours), sorts the items with Workers AI and splits the row the way the daily Claude
// run does: one row per category, Ref ID -s1, -s2, fees and discounts spread by price. Read-only on Zepto: only
// list_order_history and get_order_detail are ever called. Login once with zepto-login.mjs (README, "Zepto orders").
const ZEPTO_CRON = '5,35 * * * *';
const ZEPTO_DAYS = 15; // older unsplit payments are left as they are

async function zeptoToken(env) {
  const res = await fetch('https://auth.zepto.co.in/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.ZEPTO_CLIENT_ID, resource: 'https://mcp.zepto.co.in',
      refresh_token: (await env.SEEN.get('zepto:refresh')) || env.ZEPTO_REFRESH_TOKEN }) });
  const j = await res.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`zepto login: ${j.error || res.status}, run zepto-login.mjs again`);
  if (j.refresh_token) await env.SEEN.put('zepto:refresh', j.refresh_token); // a used refresh token may be replaced
  return j.access_token;
}

// MCP over HTTP is JSON-RPC, answered as JSON or as one server-sent event. Returns call(tool, args) -> structuredContent.
async function zeptoTools(token) {
  let session;
  const rpc = async (method, params, id = 1) => {
    const res = await fetch('https://mcp.zepto.co.in/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id && { id }) }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(session && { 'Mcp-Session-Id': session }) } });
    session = res.headers.get('mcp-session-id') || session;
    const text = await res.text();
    if (!res.ok) throw new Error(`zepto ${params?.name || method}: ${res.status}`);
    if (!id) return null;
    const j = JSON.parse(/event-stream/.test(res.headers.get('content-type') || '') ? text.split('\n').filter((l) => l.startsWith('data:')).pop().slice(5) : text);
    if (j.error || j.result?.isError) throw new Error(`zepto ${params?.name || method}: ${JSON.stringify(j.error || j.result.content).slice(0, 150)}`);
    return j.result;
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hdfc-sync', version: '1' } });
  await rpc('notifications/initialized', {}, null);
  return async (name, args) => (await rpc('tools/call', { name, arguments: args })).structuredContent;
}

// Items of an order detail, in rupees: "Theobroma Zero Maida Multigrain Bread | No Palm Oil" -> "Theobroma Zero Maida Multigrain Bread".
export const zeptoItems = (d) => (d.shipments || []).flatMap((s) => s.products || []).filter((p) => p.quantityFulfilled !== 0)
  .map((p) => ({ name: p.productName.split(/\s[|(]/)[0].trim(), price: (p.totalFinalSellingPrice ?? p.unitSellingPrice * p.quantityOrdered) / 100 }));

// One part per category, adding up exactly to the payment: fees and discounts are spread by price, the rounding
// remainder goes to the biggest part. [{ category, amount, note }], biggest first.
export function splitParts(items, cats, total) {
  const sum = items.reduce((a, i) => a + i.price, 0) || 1, by = {};
  items.forEach((it, i) => { const c = (by[cats[i]] ||= { category: cats[i], price: 0, names: [] }); c.price += it.price; c.names.push(it.name); });
  const parts = Object.values(by).sort((a, b) => b.price - a.price)
    .map((c) => ({ category: c.category, amount: Math.round((c.price / sum) * total * 100) / 100, note: c.names.join(', ').slice(0, 80) }));
  parts[0].amount = Math.round((total - parts.slice(1).reduce((a, p) => a + p.amount, 0)) * 100) / 100;
  return parts;
}

// Category per item from Workers AI (same groups as "Shopping orders" in hourly-sync-instructions.txt), or null if
// the model can't be reached, so the order waits for the next run. An item it skips is Fitness & Diet.
const ITEM_CATS = ['Foods & Drinks', 'Fitness & Diet', 'Home', 'Personal Expense'];
export async function itemCats(env, names) {
  try {
    const r = await env.AI.run(AI_MODEL, { max_tokens: 20 + 10 * names.length, messages: [
      { role: 'system', content: `Sort each item bought on a grocery app into one category. Fitness & Diet: groceries and food to eat at home: fruit, vegetables, milk, curd, paneer, eggs, bread, protein, staples, sauces, spices, snacks and drinks. Foods & Drinks: ready cooked food or restaurant food. Home: cleaning, kitchen, household and home items. Personal Expense: personal care, medicine, clothes, electronics and anything else. Answer one line per item: its number, a colon, the category.` },
      { role: 'user', content: names.map((n, i) => `${i + 1}. ${n.slice(0, 80)}`).join('\n') },
    ] });
    const got = {};
    for (const m of String(r?.response || '').matchAll(/^\s*(\d+)\s*[:.)-]\s*(.+)$/gm)) {
      const c = ITEM_CATS.find((c) => m[2].toLowerCase().includes(c.toLowerCase()));
      if (c) got[Number(m[1]) - 1] = c;
    }
    return names.map((_, i) => got[i] || 'Fitness & Diet');
  } catch {
    return null;
  }
}

// Turns the payment row into the parts: the other parts first (skipping any a failed run already made), then the row
// itself becomes part 1, so a retry never adds a part twice and the total is never short.
async function writeSplit(env, row, parts, shop = 'Zepto') {
  const n = parts.length, base = baseRef(row.ref);
  const prop = (p, i) => props({ type: 'Debit', source: row.source || 'UPI', payee: shop, date: row.date, amount: p.amount,
    ref: n > 1 ? `${base}-s${i + 1}` : row.ref, entry: n > 1 ? `${shop} (${i + 1}/${n})` : shop }, { category: p.category, status: 'Confirmed', note: p.note });
  const have = n > 1 ? new Set((await query(env, { property: 'Ref ID', rich_text: { starts_with: base } })).map((pg) => plain(pg.properties['Ref ID']))) : new Set();
  for (let i = 1; i < n; i++) if (!have.has(`${base}-s${i + 1}`)) await notion(env, 'pages', { parent: { type: 'data_source_id', data_source_id: EXPENSES_DS }, properties: prop(parts[i], i) });
  await notion(env, `pages/${row.id}`, { properties: prop(parts[0], 0) }, 'PATCH');
}

export async function splitZepto(env) {
  if (!env.ZEPTO_CLIENT_ID || !env.ZEPTO_REFRESH_TOKEN) return { zepto: 'not connected' };
  const since = new Date(Date.now() - ZEPTO_DAYS * 864e5).toISOString().slice(0, 10);
  const rows = (await query(env, { and: [{ property: 'Entry', title: { equals: 'Zepto' } }, { property: 'Status', select: { does_not_equal: 'Confirmed' } },
    { property: 'Type', select: { equals: 'Debit' } }, { property: 'Date', date: { on_or_after: since } }] })).map(rowOf);
  if (!rows.length) return { split: 0, waiting: 0 };
  const call = await zeptoTools(await zeptoToken(env));
  const orders = [];
  for (let page = 1; page <= 3; page++) { // 8 orders a page, newest first
    const got = (await call('list_order_history', { limit: 25, pageNumber: page }))?.orders || [];
    orders.push(...got);
    if (!got.length) break;
  }
  const used = new Set();
  let split = 0;
  for (const row of rows.slice(0, 4)) { // ponytail: 4 a run keeps under the 50-request limit; the rest wait 30 minutes
    for (const o of orders) {
      if (used.has(o.id) || /cancel|fail/i.test(o.formattedStatus || '') || Math.abs(o.grandTotalAmount / 100 - row.amount) > 1) continue;
      const d = await call('get_order_detail', { orderId: o.id });
      if (!(Math.abs(Date.parse(d.placedTime) - Date.parse(row.date)) <= 6 * 36e5)) continue;
      used.add(o.id);
      const items = zeptoItems(d), cats = items.length && (await itemCats(env, items.map((i) => i.name)));
      if (cats) { await writeSplit(env, row, splitParts(items, cats, row.amount)); split++; }
      break;
    }
  }
  return { split, waiting: rows.length - split };
}

/* ---------- order screenshot (Blinkit) ------------------------------------------------ */

// Blinkit sends no item email and has no API. The iPhone shortcut "Split order" (Share a screenshot of the order) reads
// the text on the phone (Live Text) and posts it to /order. Workers AI lists the items and the total, the unsplit shop
// payment of that total from the last 7 days is found, and it is split like a Zepto order. The answer is the
// notification the phone shows. Works for any shop row not yet split (Blinkit, Zepto, Amazon, Instamart ...).
export function readOrderReply(reply) { // "Milk 500 ml | 33" lines and "TOTAL | 4912" -> { items, total }
  const items = [];
  let total = 0;
  for (const m of String(reply).matchAll(/^\s*[-*\d.)]*\s*(.+?)\s*\|\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*$/gim)) {
    const price = Number(m[2].replace(/,/g, ''));
    if (/^total$/i.test(m[1].trim())) total = price; else if (price > 0) items.push({ name: m[1].trim().slice(0, 80), price });
  }
  return { items, total };
}

export async function splitOrder(env, text, now = Date.now()) {
  let reply;
  try {
    reply = (await env.AI.run(AI_MODEL, { max_tokens: 900, messages: [
      { role: 'system', content: 'This is the text of a screenshot of an order in a grocery app (Blinkit, Zepto and the like), read by the phone. List every item bought with the price paid for it, one per line as: item name | price. Then one line: TOTAL | the amount actually paid (grand total, bill total, to pay). Leave out MRP, savings, fees and discount lines. Numbers only, no currency signs, no other text.' },
      { role: 'user', content: String(text).slice(0, 6000) },
    ] }))?.response;
  } catch { return "The AI couldn't read it just now. Try again in a minute."; }
  const { items, total: t } = readOrderReply(reply);
  if (!items.length) return "Couldn't find the items in that screenshot. Use one that shows the item list and the bill total.";
  const total = t || Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
  const since = new Date(now - 7 * 864e5).toISOString().slice(0, 10);
  const shops = SHOPS.map(([, name]) => name);
  const row = (await query(env, { and: [{ property: 'Type', select: { equals: 'Debit' } }, { property: 'Status', select: { does_not_equal: 'Confirmed' } },
    { property: 'Date', date: { on_or_after: since } }] })).map(rowOf)
    .filter((r) => shops.includes(r.entry) && Math.abs(r.amount - total) <= 2).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!row) return `No shop payment of ₹${total} from the last 7 days is waiting to be split. If you paid another way, there's nothing to split.`;
  const cats = await itemCats(env, items.map((i) => i.name));
  if (!cats) return "The AI couldn't sort the items just now. Try again in a minute.";
  const parts = splitParts(items, cats, row.amount);
  await writeSplit(env, row, parts, row.entry);
  return `${row.entry} ₹${row.amount} split: ${parts.map((p) => `${p.category} ₹${p.amount}`).join(', ')}.`;
}

/* ---------- nightly snapshot safety net --------------------------------------------- */

// The nightly Claude routine writes each day's Daily Snapshots row: Binance quantities and costs from its connector,
// INDmoney from its own. When the Claude plan's limit skips it (19 and 20 Oct 2026), the net worth chart got a hole. At
// 05:00 IST (SNAPSHOT_CRON, after the routine's 04:00 run) this fills the day in when the routine hasn't: the last known
// Binance holdings revalued at Binance's public USDT prices times Coinbase's USDT to INR (the routine's and the site's
// pricing), INDmoney carried over. Its rows start Insights with "Worker:", which the health check counts.
const SNAPSHOT_CRON = '30 23 * * *';
const STABLE = /^(USDT|USDC|FDUSD)$/;
const holdingLines = (text) => String(text || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0] === 'Binance' && p.length >= 5);
export const istDay = (start) => (!start ? '' : start.length === 10 ? start : istFromEpoch(Date.parse(start)).slice(0, 10));

// "Binance | BTC | Crypto | 0.00144855 | 11141.77 | 124.761451 USDT" lines at new prices. Throws if a coin has no
// price: no row is better than a wrong one.
export function revalue(text, usdt, usdtInr) {
  const rows = holdingLines(text).map(([platform, asset, type, qty, , cost = '']) => {
    const price = STABLE.test(asset) ? 1 : usdt[asset];
    if (!(price > 0)) throw new Error(`no price for ${asset}`);
    return { line: [platform, asset, type, qty], cost, inr: Math.round(Number(qty) * price * usdtInr * 100) / 100 };
  }).sort((a, b) => b.inr - a.inr);
  return { text: rows.map((r) => `${[...r.line, r.inr.toFixed(2)].join(' | ')} | ${r.cost}`.trimEnd()).join('\n'),
    total: Math.round(rows.reduce((s, r) => s + r.inr, 0) * 100) / 100 };
}

export async function fillSnapshot(env, now = Date.now()) {
  // The routine runs at 22:30 UTC and names its row after that UTC date ("23 Oct 2026" was written at 04:18 IST on the
  // 24th); this runs an hour later, so the UTC date is the routine's day too.
  const day = new Date(now).toISOString().slice(0, 10);
  const recent = (await notion(env, `data_sources/${SNAPSHOTS_DS}/query`, { page_size: 15, sorts: [{ property: 'Date', direction: 'descending' }] })).results;
  const dayOf = (pg) => istDay(pg.properties.Date?.date?.start);
  const today = recent.filter((pg) => dayOf(pg) === day);
  if (today.some((pg) => plain(pg.properties.Holdings))) return { day, skipped: 'the routine wrote it' };
  const last = recent.find((pg) => plain(pg.properties.Holdings));
  if (!last) return { day, skipped: 'no Binance holdings to carry over' };
  const coins = [...new Set(holdingLines(plain(last.properties.Holdings)).map((p) => p[1]).filter((a) => !STABLE.test(a)))];
  // KuCoin, not Binance: Binance (data-api.binance.vision too) answers Cloudflare with 403, so until 28 Oct 2026 this
  // never filled a night. Coinbase's own rates can't stand in: its "JUP" is a different coin at $0.0003.
  const [prices, fx] = await Promise.all([
    coins.length ? fetch('https://api.kucoin.com/api/v1/market/allTickers').then((r) => r.json()) : {},
    fetch('https://api.coinbase.com/v2/prices/USDT-INR/spot').then((r) => r.json()),
  ]);
  const usdt = Object.fromEntries((prices?.data?.ticker || []).filter((t) => /-USDT$/.test(t.symbol)).map((t) => [t.symbol.slice(0, -5), Number(t.last)]));
  const usdtInr = Number(fx?.data?.amount);
  if (!(usdtInr > 0)) throw new Error('no USDT to INR price from Coinbase');
  const { text, total } = revalue(plain(last.properties.Holdings), usdt, usdtInr);
  const inv = recent.find((pg) => pg.properties.Investments?.number != null)?.properties.Investments.number;
  const props = { Binance: { number: total }, Holdings: txt(text, 2000), ...(inv != null && { Investments: { number: inv } }),
    Insights: txt(`Worker: the nightly Claude routine didn't write Binance holdings for ${day}. Binance holdings from ${dayOf(last)} revalued at today's prices; INDmoney carried over.`) };
  if (today[0]) await notion(env, `pages/${today[0].id}`, { properties: props }, 'PATCH'); // e.g. the row an SMS balance made
  else {
    const [y, m, d] = day.split('-');
    await notion(env, 'pages', { parent: { type: 'data_source_id', data_source_id: SNAPSHOTS_DS }, properties: { ...props, Date: { date: { start: day } },
      Snapshot: { title: [{ text: { content: `${+d} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[m - 1]} ${y}` } }] } } });
  }
  return { day, filled: true, binance: total, from: dayOf(last) };
}

/* ---------- weekly backup --------------------------------------------------------- */

// Every Saturday night (BACKUP_CRON, Sunday 03:00 IST) every Notion table the site uses is saved as plain JSON in KV:
// `backup:<date>`, the newest 8 kept, with row counts and unreadable tables in the key's metadata for the health check.
// KV, not R2: R2 needs a card on the account. How to restore: README, "Backup".
// ponytail: one run reads at most ~45 pages of 100 rows (the free plan allows 50 requests a run). Expense Tracker had
// 881 rows on 25 Oct 2026 (~2,600 a year): past ~4,000 rows, split it across two runs.
const BACKUP_CRON = '30 21 * * 6';
const BACKUP_KEEP = 8;
const TABLES = { 'Expense Tracker': EXPENSES_DS, 'Daily Snapshots': SNAPSHOTS_DS, Subscriptions: '00000000-0000-0000-0000-000000000002',
  Budgets: '00000000-0000-0000-0000-000000000004', 'Savings Goals': '00000000-0000-0000-0000-000000000005',
  'Holdings Snapshots': '00000000-0000-0000-0000-000000000006', Wishlist: '00000000-0000-0000-0000-000000000007' };

// A Notion row as plain values ("Category": "Fitness & Diet"). Formulas and rollups are left out: Notion works them out again.
const plainValue = (p) => {
  switch (p.type) {
    case 'title': case 'rich_text': return plain(p);
    case 'select': case 'status': return p[p.type]?.name ?? null;
    case 'multi_select': return p.multi_select.map((o) => o.name);
    case 'date': return p.date ? (p.date.end ? `${p.date.start}/${p.date.end}` : p.date.start) : null;
    case 'files': return p.files.map((f) => f.name);
    case 'relation': return p.relation.map((r) => r.id);
    case 'number': case 'checkbox': case 'url': case 'email': case 'phone_number': case 'created_time': case 'last_edited_time': return p[p.type];
    default: return undefined;
  }
};
export const plainRow = (pg) => ({ id: pg.id, ...Object.fromEntries(Object.entries(pg.properties).map(([k, p]) => [k, plainValue(p)]).filter(([, v]) => v !== undefined)) });

export async function backup(env, now = Date.now()) {
  const tables = {}, rows = {}, errors = [];
  for (const [name, ds] of Object.entries(TABLES)) {
    try { tables[name] = (await query(env, undefined, ds)).map(plainRow); rows[name] = tables[name].length; }
    catch (e) { errors.push(name); tables[name] = { error: String(e.message || e).slice(0, 200) }; }
  }
  const key = `backup:${new Date(now + 5.5 * 36e5).toISOString().slice(0, 10)}`; // the IST date
  await env.SEEN.put(key, JSON.stringify({ at: now, tables }), { metadata: { at: now, rows, errors } });
  const old = (await env.SEEN.list({ prefix: 'backup:' })).keys.map((k) => k.name).sort().slice(0, -BACKUP_KEEP);
  for (const k of old) await env.SEEN.delete(k);
  return { key, rows, errors, removed: old.length };
}

/* ---------- health check -------------------------------------------------------- */

// Checks everything this setup leans on. The iPhone fetches /health every morning and shows a notification unless the
// answer is "OK" (README, "Phone alerts"); a push from here can't work for free: ntfy.sh limits free senders per IP and
// Cloudflare's shared IPs use that up. Llama 3.1 8B was retired on 30 May 2026 and every AI call failed quietly until
// 24 Oct: this is what would have said so. Gmail and Notion are covered by the 15-minute sync, which records its last
// success and last error in KV.
// Payments in Notion twice: the same Ref ID, direction and amount (a statement upload or a routine adding a row the sync
// already had), or a split part ("-s2") written twice. Allowed to share a ref: the site's own "-split" parts, and a
// reversal, which goes the other way. Five such rows were found and removed by hand on 24 Oct 2026.
/* ---------- nightly fixer (Claude) ------------------------------------------ */

// Once a night Claude Haiku 5.5 (paid API, a cent or two a night) files the spending still waiting for review, with
// the payments you confirmed in the last 120 days as examples. Only the ones it is sure of change: to "Auto-filed"
// (their own tab on the site, never used to train), with its reason in the Note. Amount, date and payee are never
// touched. Mixed orders and odd alerts stay for you. Off until the ANTHROPIC_API_KEY secret is set.
const FIX_CRON = '0 22 * * *'; // 03:30 IST
const FIX_MODEL = 'claude-haiku-5-5';
const FIX_MAX = 30; // rows per night: with the Notion reads it stays under the free plan's 50 requests per run
const FIX_CATS = ['Foods & Drinks', 'Fitness & Diet', 'Home', 'Personal Expense', 'Transport', 'Subscription', 'Business', 'In Cash', 'Transfers'];
const LEAVE = /mixed|split pending|no order email|not recognised|refund|reversal/;
const FIX_SCHEMA = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['n', 'category', 'sure', 'why'],
  properties: { n: { type: 'integer' }, category: { type: 'string', enum: FIX_CATS }, sure: { type: 'boolean' }, why: { type: 'string' } } } } } };

export async function fixUnsorted(env, now = Date.now()) {
  if (!env.ANTHROPIC_API_KEY) return { skipped: 'no ANTHROPIC_API_KEY' };
  const debits = async (status, days) => (await query(env, { and: [{ property: 'Status', select: { equals: status } },
    { property: 'Type', select: { equals: 'Debit' } }, { property: 'Date', date: { on_or_after: new Date(now - days * 864e5).toISOString().slice(0, 10) } }] })).map(rowOf);
  const shop = (r) => SHOPS.some(([k]) => new RegExp(k, 'i').test(`${r.entry} ${r.payee}`)); // a basket: Claude can't see what was in it
  const todo = (await debits('Needs review', 60)).filter((r) => !NON_SPEND.includes(r.category) && !LEAVE.test(r.note || '') && !shop(r)).slice(0, FIX_MAX);
  if (!todo.length) return { filed: 0, left: 0 };
  const examples = [...new Set((await debits('Confirmed', 120)).filter((r) => r.category).map((r) => `${r.entry} | ${r.payee} | ₹${r.amount} | ${r.category}`))].slice(0, 400);
  const res = await new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).messages.create({
    model: FIX_MODEL, max_tokens: 8000, output_config: { effort: 'low', format: { type: 'json_schema', schema: FIX_SCHEMA } },
    system: `You file payments from the owner's Indian bank account (HDFC, UPI and card) into budget categories, the way the owner files them.
Foods & Drinks: food eaten out or ready to eat (restaurants, cafes, street food, sweet shops, tea stalls, bakeries, Swiggy, Zomato). Fitness & Diet: groceries to cook or eat at home, gyms, sports, protein and supplements. Home: hardware, cleaning, furniture, rent, electricity, gas. Transport: fuel, cabs, autos, metro, parking, tolls. Subscription: apps and services billed every month or year. Business: costs of the owner's work (domains, design and dev tools). In Cash: cash withdrawn. Transfers: money to a friend or family member (a private person, not a shop). Personal Expense: clothes, salons, pharmacy, electronics, anything else.
The owner's own past choices win over these descriptions. A UPI handle like "*****ab1@okaxis" with the entry "UPI payment" is usually a person. Mark sure true only when the name, handle or the owner's past choices make the category clear; otherwise give your best guess with sure false. "why" is under 8 words, e.g. "same handle filed as Transport before".`,
    messages: [{ role: 'user', content: `Payments the owner filed (entry | payee or UPI handle | amount | category):\n${examples.join('\n') || '(none yet)'}\n\nFile these (n | entry | payee or UPI handle | amount | IST date and time):\n${todo.map((r, i) => `${i + 1} | ${r.entry} | ${r.payee} | ₹${r.amount} | ${r.date.slice(0, 16).replace('T', ' ')}`).join('\n')}` }],
  });
  if (res.stop_reason !== 'end_turn') throw new Error(`Claude stopped: ${res.stop_reason}`);
  const { items } = JSON.parse(res.content.find((b) => b.type === 'text').text);
  let filed = 0;
  for (const it of items) {
    const r = todo[it.n - 1];
    if (!r || !it.sure || !FIX_CATS.includes(it.category)) continue;
    await notion(env, `pages/${r.id}`, { properties: { Category: { select: { name: it.category } }, Status: { select: { name: 'Auto-filed' } },
      Note: txt(`Claude: ${it.why}`, 120) } }, 'PATCH');
    filed++;
  }
  return { filed, left: todo.length - filed, tokens: res.usage.input_tokens + res.usage.output_tokens };
}

// Before Claude files anything, the same night run clears the extra copies the Duplicates check finds, plus the ₹0
// "[DUPLICATE" rows the nightly routine leaves when it notices it wrote a payment twice (29 Oct 2026). An extra copy
// goes unless you confirmed it; a "[DUPLICATE" row goes whatever its status, since it is ₹0 by definition (one got
// Auto-filed before this ran and sat in the banner for a week, 1 Nov 2026). They go to Notion's trash (restorable
// for 30 days). At most 5 a night: the rest wait, and the Duplicates check keeps showing them.
export async function removeDuplicates(env, now = Date.now()) {
  const rows = await recentRows(env, now - 45 * 864e5);
  const junk = rows.filter((r) => r.amount === 0 && /^\[DUPLICATE/i.test(r.entry));
  const extra = [...duplicates(rows).filter((r) => r.status !== 'Confirmed'), ...junk];
  const gone = [...new Map(extra.map((r) => [r.id, r])).values()].slice(0, 5);
  for (const r of gone) await notion(env, `pages/${r.id}`, { in_trash: true }, 'PATCH');
  return gone.map((r) => `₹${r.amount} ${r.date.slice(0, 10)} ${r.ref}`);
}

export function duplicates(rows) {
  const seen = new Set(), out = [], card = [];
  for (const r of rows) {
    if (!r.ref || /-split$/.test(r.ref)) continue;
    const k = /-s\d+$/.test(r.ref) ? r.ref : `${r.ref}|${r.type}|${Math.round(r.amount)}`;
    if (seen.has(k)) { out.push(r); continue; }
    seen.add(k);
    // A card spend has no ref the SMS and the email share, so a second writer can miss it (₹514 Amazon, 25 Oct 2026:
    // the Worker saved the SMS, the nightly routine the email). Same test as findSame.
    if (!bankRef(r.ref)) { if (findSame(r, card)) out.push(r); else card.push(r); }
  }
  return out;
}

export async function health(env, now = Date.now()) {
  const problems = [];
  const hours = (ms) => Math.round((now - ms) / 36e5);
  const check = async (what, fn) => {
    try { const p = await fn(); if (p) problems.push(`${what}: ${p}`); }
    catch (e) { problems.push(`${what}: ${String(e.message || e).slice(0, 140)}`); }
  };
  await check('Bank sync', async () => {
    const ok = Number(await env.SEEN.get('health:sync')) || 0, err = await env.SEEN.get('health:error');
    if (hours(ok) >= 2) return `not working for ${ok ? hours(ok) + ' hours' : 'a while'}${err ? ` (${err})` : ''}. If it says invalid_grant, redo the Gmail login (sync-worker README).`;
  });
  await check('iPhone SMS', async () => {
    const at = Number(await env.SEEN.get('health:sms'));
    if (!at) return void (await env.SEEN.put('health:sms', String(now))); // nothing recorded yet: start counting today
    if (hours(at) >= 72) return `no HDFC SMS has arrived for ${Math.round(hours(at) / 24)} days. Check the Shortcuts automation is still on.`;
  });
  await check('AI', async () => {
    const r = await env.AI.run(AI_MODEL, { max_tokens: 3, messages: [{ role: 'user', content: 'Say OK' }] });
    if (!String(r?.response || '').trim()) return `${AI_MODEL} gave no answer`;
  });
  if (env.ZEPTO_CLIENT_ID) await check('Zepto', async () => { await zeptoToken(env); });
  await check('Claude fixer', async () => {
    const e = await env.SEEN.get('health:fix');
    if (e) return `last night's run failed (${e}). If it mentions credit or a limit, check the Finance workspace on console.anthropic.com.`;
  });
  await check('Site', async () => {
    const errs = ((await env.SEEN.get('site:errors', 'json')) || []).filter((x) => now - x.at < 864e5);
    if (errs.length) return `${errs.length} page error${errs.length > 1 ? 's' : ''} in the last day. Latest: "${errs[0].msg}" on ${errs[0].page}${errs[0].v ? ` (v${errs[0].v})` : ''}${errs[0].where ? `, ${errs[0].where}` : ''}. Tell Claude.`;
  });
  await check('Backup', async () => {
    const last = (await env.SEEN.list({ prefix: 'backup:' })).keys.sort((a, b) => (a.name < b.name ? -1 : 1)).pop();
    if (!last || now - (last.metadata?.at || 0) > 8 * 864e5) return `no weekly Notion backup since ${last ? last.name.slice(7) : 'ever'}. Check the hdfc-sync logs for "backup".`;
    if (last.metadata?.errors?.length) return `the ${last.name.slice(7)} backup couldn't read ${last.metadata.errors.join(', ')}. Share it with the expense-site connection in Notion.`;
  });
  await check('Duplicates', async () => { // the last 45 days: 1 or 2 Notion requests
    const d = duplicates(await recentRows(env, now - 45 * 864e5));
    if (d.length) return `${d.length} payment${d.length > 1 ? 's are' : ' is'} in Notion twice: ${d.slice(0, 3).map((r) => `₹${r.amount} on ${r.date.slice(0, 10)} (Ref ${r.ref})`).join(', ')}${d.length > 3 ? ' and more' : ''}. The 3:30 AM fixer removes extra copies you didn’t confirm; if one stays, search its Ref ID on Transactions and delete it yourself.`;
  });
  await check('Nightly snapshot', async () => {
    const j = await notion(env, `data_sources/${SNAPSHOTS_DS}/query`, { page_size: 5, sorts: [{ property: 'Date', direction: 'descending' }],
      filter: { property: 'Holdings', rich_text: { is_not_empty: true } } });
    const d = j.results[0]?.properties.Date?.date?.start;
    if (!d || hours(Date.parse(d)) > 48) return `none since ${d ? d.slice(0, 10) : 'ever'}. The Claude "HDFC Daily Sync" routine may have stopped (plan limit?).`;
    // The Worker filling in (fillSnapshot) keeps the chart going, but quantities and INDmoney go stale.
    const filled = j.results.findIndex((pg) => !plain(pg.properties.Insights).startsWith('Worker:'));
    const n = filled < 0 ? j.results.length : filled;
    if (n >= 2) return `the Claude "HDFC Daily Sync" routine has missed the last ${n} nights, so Binance quantities and INDmoney aren't being refreshed (the Worker is filling in prices). Check it on claude.ai (plan limit?).`;
  });
  return problems;
}


export default {
  async scheduled(event, env) {
    if (event.cron === ZEPTO_CRON) return console.log('zepto-split', JSON.stringify(await splitZepto(env)));
    if (event.cron === BACKUP_CRON) return console.log('backup', JSON.stringify(await backup(env)));
    if (event.cron === SNAPSHOT_CRON) return console.log('snapshot', JSON.stringify(await fillSnapshot(env)));
    if (event.cron === FIX_CRON) {
      try {
        console.log('dedupe', JSON.stringify(await removeDuplicates(env)));
        console.log('fix', JSON.stringify(await fixUnsorted(env))); await env.SEEN.delete('health:fix');
      }
      catch (e) { await env.SEEN.put('health:fix', String(e.message || e).slice(0, 160)); throw e; }
      return;
    }
    const seen = (await env.SEEN.get('seen', 'json')) || {};
    try {
      console.log('hdfc-sync', JSON.stringify(await sync(env, seen)));
      await env.SEEN.put('health:sync', String(Date.now()));
    } catch (e) {
      await env.SEEN.put('health:error', String(e.message || e).slice(0, 160));
      throw e;
    } finally {
      await env.SEEN.put('seen', JSON.stringify(seen));
    }
  },
  async fetch(request, env) {
    try { return await handleSms(request, env); }
    catch (e) { console.log('hdfc-sms error', String(e.message || e).slice(0, 200)); return Response.json({ ok: false, error: 'sync failed, try again' }, { status: 502 }); }
  },
};
