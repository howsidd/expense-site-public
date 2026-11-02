// GET /api/data -> raw rows the dashboard (app.js) shapes in the browser.
// Reads Notion only. The nightly "HDFC Daily Sync" routine writes transactions, Daily Snapshots
// and INDmoney Holdings Snapshots; Binance and Coinbase values live on Daily Snapshots rows.

const DS = {
  expenses: '00000000-0000-0000-0000-000000000001',
  subs: '00000000-0000-0000-0000-000000000002',
  snapshots: '00000000-0000-0000-0000-000000000003',
  budgets: '00000000-0000-0000-0000-000000000004',
  goals: '00000000-0000-0000-0000-000000000005',
  holdings: '00000000-0000-0000-0000-000000000006',
  wishlist: '00000000-0000-0000-0000-000000000007',
};

/* ---------- Notion transport ---------------------------------------------- */
// The workspace may be on either API generation, so try the data-source route first and
// fall back to the classic database route. Whichever answers is cached for the isolate.
let ROUTE = null;

async function queryAll(token, id, body, maxPages = 40) {
  const routes = ROUTE ? [ROUTE] : ['data_sources', 'databases'];
  let lastErr = null;
  for (const route of routes) {
    const pages = [];
    let cursor;
    try {
      for (let guard = 0; guard < maxPages; guard++) {
        // Notion answers the odd 500 or 429; a short retry beats failing the whole page on one blip.
        let res;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
          res = await fetch(`https://api.notion.com/v1/${route}/${id}/query`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Notion-Version': route === 'data_sources' ? '2025-09-03' : '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ page_size: 100, start_cursor: cursor, ...(body || {}) }),
          });
          if (res.status < 500 && res.status !== 429) break;
        }
        if (!res.ok) throw new Error(`${route} ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const j = await res.json();
        pages.push(...(j.results || []));
        if (!j.has_more) break;
        cursor = j.next_cursor;
      }
      ROUTE = route;
      return pages;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Notion query failed');
}

/* ---------- tolerant property readers --------------------------------------
   Property names drift as the databases get edited by hand, so every read matches on a
   list of candidate names, case and space insensitive, then falls back by type.          */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function findProp(props, candidates, type) {
  const keys = Object.keys(props || {});
  for (const c of candidates) { const k = keys.find((x) => norm(x) === norm(c)); if (k && (!type || props[k].type === type)) return props[k]; }
  for (const c of candidates) { const k = keys.find((x) => norm(x).includes(norm(c))); if (k && (!type || props[k].type === type)) return props[k]; }
  if (type) { const k = keys.find((x) => props[x].type === type); if (k) return props[k]; }
  return null;
}
const readText = (p) => {
  if (!p) return '';
  if (p.type === 'title') return (p.title || []).map((t) => t.plain_text).join('').trim();
  if (p.type === 'rich_text') return (p.rich_text || []).map((t) => t.plain_text).join('').trim();
  if (p.type === 'select') return p.select ? p.select.name : '';
  if (p.type === 'status') return p.status ? p.status.name : '';
  if (p.type === 'url') return p.url || '';
  if (p.type === 'formula') return p.formula ? p.formula.string || '' : '';
  return '';
};
const readNum = (p) => {
  if (!p) return null;
  if (p.type === 'number') return p.number;
  if (p.type === 'formula' && p.formula) return p.formula.number ?? null;
  if (p.type === 'rollup' && p.rollup) return p.rollup.number ?? null;
  const t = readText(p).replace(/[^\d.-]/g, '');
  return t ? Number(t) : null;
};
const readDate = (p) => (p && p.type === 'date' && p.date ? p.date.start : null);
const txt = (props, names, type) => readText(findProp(props, names, type));
const num = (props, names) => readNum(findProp(props, names, 'number') || findProp(props, names));

/* ---------- shaping --------------------------------------------------------- */
function shapeTx(r) {
  const p = r.properties || {};
  const category = txt(p, ['Category'], 'select') || null;
  return {
    id: r.id,
    entry: txt(p, ['Entry', 'Name', 'Title'], 'title'),
    amount: Math.abs(num(p, ['Amount']) || 0),
    type: txt(p, ['Type'], 'select') || (category === 'Income' ? 'Credit' : 'Debit'),
    category,
    note: txt(p, ['Note', 'Description']),
    payee: txt(p, ['Payee']),
    source: txt(p, ['Source'], 'select'),
    refId: txt(p, ['Ref ID', 'RefID', 'Reference']),
    // Keep the full timestamp (with its +05:30 or Z); the browser converts it to local time.
    date: readDate(findProp(p, ['Date'], 'date')) || r.created_time || null,
    status: txt(p, ['Status'], 'select'),
    exclude: !!findProp(p, ['Exclude from spend'], 'checkbox')?.checkbox,
  };
}

// Holdings text on a snapshot: one line per holding, "platform | asset | type | qty | value | invested".
// Invested is ₹, or "<n> USDT" for Binance coins (the cost of the trades, so gains don't move with the rupee).
const parseHoldings = (s) => s.split('\n').map((l) => l.split('|').map((x) => x.replace(/\\/g, '').trim()))
  .filter((c) => c.length >= 5 && c[1])
  .map((c) => {
    const usdt = /USDT$/i.test(c[5] || '') ? Number(c[5].replace(/[^\d.]/g, '')) : null;
    return { platform: c[0], asset: c[1], type: c[2], qty: Number(c[3]) || 0, value: Number(c[4]) || 0, invested: c[5] && usdt == null ? Number(c[5]) : null, investedUsdt: usdt };
  });

function shapeSnapshot(r) {
  const p = r.properties || {};
  return {
    id: r.id,
    created: r.created_time,
    date: readDate(findProp(p, ['Date'], 'date')) || (r.created_time || '').slice(0, 10),
    bank: num(p, ['Bank balance', 'Balance']),
    investments: num(p, ['Investments', 'Investment value', 'Portfolio']),
    binance: num(p, ['Binance']),
    coinbase: num(p, ['Coinbase']),
    indmoney: num(p, ['INDmoney']),
    holdings: parseHoldings(txt(p, ['Holdings'], 'rich_text')),
    insights: txt(p, ['Insights', 'AI insights', 'Notes'], 'rich_text'),
    // A real balance (typed in, or a statement's closing balance). The site counts transactions on from the latest one.
    checked: !!findProp(p, ['Balance checked'], 'checkbox')?.checkbox,
  };
}

// INDmoney holdings written nightly, one row per holding per day. Only the latest date is current.
function shapeHoldingRows(rows) {
  const all = rows.map((r) => {
    const p = r.properties || {};
    return {
      asset: txt(p, ['Holding', 'Name', 'Instrument'], 'title') || 'Holding',
      ticker: txt(p, ['Ticker', 'Symbol']) || null,
      type: txt(p, ['Asset class', 'AssetClass', 'Type']) || 'Other',
      value: num(p, ['Current value', 'Market value', 'Value']) || 0,
      invested: num(p, ['Invested', 'Invested amount']),
      returnPct: num(p, ['Return %', 'PnL %']),
      dayPct: num(p, ['Day change %', 'Daily change %', 'Change %']),
      date: readDate(findProp(p, ['Date'], 'date')),
    };
  }).filter((h) => h.value > 0);
  const latest = all.map((h) => h.date).filter(Boolean).sort().pop();
  return all.filter((h) => !latest || h.date === latest).map((h) => ({ ...h, platform: 'INDmoney', qty: 0 }));
}

const shapeNews = (rows) => rows.map((r) => {
  const p = r.properties || {};
  return {
    headline: txt(p, ['Headline', 'Title', 'Name'], 'title'),
    source: txt(p, ['Source', 'Publisher']),
    ticker: txt(p, ['Ticker', 'Symbol']) || null,
    url: findProp(p, ['URL', 'Link'], 'url')?.url || txt(p, ['URL', 'Link']) || '',
    published: readDate(findProp(p, ['Published', 'Date'], 'date')),
  };
}).filter((n) => n.headline).sort((a, b) => String(b.published).localeCompare(String(a.published))).slice(0, 6);

/* ---------- handler --------------------------------------------------------- */
export async function onRequestGet({ env }) {
  const token = env.NOTION_TOKEN;
  if (!token) return json({ ok: false, error: 'NOTION_TOKEN is not set' }, 500);

  // Transactions: the last 13 months only, so the page stays fast as the table grows.
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)).toISOString().slice(0, 10);

  // Only the Expense Tracker is essential. Anything else failing empties one card and is
  // reported in `warnings` (visible at /api/data), never blanks the whole dashboard.
  const warnings = [];
  const optional = async (label, id, body, maxPages) => {
    if (!id) return [];
    try { return await queryAll(token, id, body, maxPages); }
    catch (e) { warnings.push(`${label}: ${String(e?.message || e)}`); return []; }
  };

  try {
    const expenses = env.NOTION_EXPENSES_DS || DS.expenses;
    // Notion pages 100 rows at a time, one after another. Four date ranges in parallel cut the wait ~4x.
    const cut = (m) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1)).toISOString().slice(0, 10);
    const ranges = [[since, cut(-8)], [cut(-8), cut(-4)], [cut(-4), cut(-1)], [cut(-1), null]];
    const txChunks = Promise.all(ranges.map(([from, to]) => queryAll(token, expenses, { filter: to
      ? { and: [{ property: 'Date', date: { on_or_after: from } }, { property: 'Date', date: { before: to } }] }
      : { property: 'Date', date: { on_or_after: from } } })));
    const [txParts, subRows, snapRows, budRows, goalRows, holdRows, newsRows, wishRows] = await Promise.all([
      txChunks,
      optional('Subscriptions', env.NOTION_SUBS_DS || DS.subs),
      optional('Daily Snapshots', env.NOTION_SNAPSHOTS_DS || DS.snapshots),
      optional('Budgets', env.NOTION_BUDGETS_DS || DS.budgets),
      optional('Savings Goals', env.NOTION_GOALS_DS || DS.goals),
      // Newest 100 rows are more than one night's set; shapeHoldingRows keeps the latest date.
      optional('Holdings Snapshots', env.NOTION_HOLDINGS_DS || DS.holdings, { sorts: [{ timestamp: 'created_time', direction: 'descending' }] }, 1),
      optional('Market News', env.NOTION_NEWS_DS),
      optional('Wishlist', env.NOTION_WISHLIST_DS || DS.wishlist),
    ]);

    const txRows = txParts.flat();
    return json({
      ok: true,
      since,
      transactions: txRows.map(shapeTx).filter((t) => t.date),
      subscriptions: subRows.map((r) => {
        const p = r.properties || {};
        return {
          id: r.id,
          name: txt(p, ['Name', 'Subscription', 'Service'], 'title') || 'Subscription',
          amount: num(p, ['Amount', 'Price', 'Cost']) || 0,
          nextDue: readDate(findProp(p, ['Next due', 'Due'], 'date')),
          status: txt(p, ['Status']),
          // Matched by name only: a type fallback would read Status or Amount instead.
          paidVia: (findProp(p, ['Paid via'])?.multi_select || []).map((o) => o.name),
          cycle: readText(findProp(p, ['Cycle'])) || 'Monthly',
          note: readText(findProp(p, ['Note'])),
        };
      }),
      // Sorted by date, then creation time, so the last row really is the latest.
      snapshots: snapRows.map(shapeSnapshot).filter((s) => s.date)
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.created).localeCompare(String(b.created))),
      budgets: budRows.map((r) => ({ id: r.id, category: txt(r.properties, ['Category', 'Name'], 'title'), amount: num(r.properties, ['Monthly budget']) })),
      goals: goalRows.map((r) => {
        const p = r.properties || {};
        return {
          id: r.id,
          name: txt(p, ['Goal', 'Name'], 'title') || 'Goal',
          target: num(p, ['Target amount', 'Target']),
          saved: num(p, ['Saved amount', 'Saved']),
          deadline: readDate(findProp(p, ['Deadline'], 'date')),
          status: txt(p, ['Status']),
        };
      }),
      wishlist: wishRows.map((r) => {
        const p = r.properties || {};
        return {
          id: r.id,
          name: txt(p, ['Item', 'Name'], 'title') || 'Item',
          price: num(p, ['Price']) || 0,
          priority: txt(p, ['Priority']) || 'Want',
          by: readDate(findProp(p, ['By'], 'date')),
          note: txt(p, ['Note'], 'rich_text'),
          bought: !!findProp(p, ['Bought'], 'checkbox')?.checkbox,
          boughtOn: readDate(findProp(p, ['Bought on'], 'date')),
          // Notion's file links last an hour; every load fetches fresh ones.
          color: txt(p, ['Color'], 'rich_text') || null,
          photo: ((f) => f?.file?.url || f?.external?.url || null)(findProp(p, ['Photo'], 'files')?.files?.[0]),
        };
      }),
      indHoldings: shapeHoldingRows(holdRows),
      news: shapeNews(newsRows),
      warnings,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
