// POST /api/update — every write the site makes. Whitelisted fields only.
//   edit:       { pageId, category?, note?, amount?, entry?, confirm?, exclude? }
//   split:      { pageId, split: [{category, amount, note}] }   original is zeroed + excluded, parts are new rows
//   create:     { action: "create", entry, amount, type: "Debit"|"Credit", category, note?, date, source?, payee?, refId?, review?, auto? }
//   bulk:       { action: "bulk", pageIds: [...], category?, confirm?, exclude?, auto? }
//   budget:     { action: "budget", pageId?, category, amount }
//   goal:       { action: "goal", pageId?, name, target, saved?, deadline?, status? }
//   contribute: { action: "contribute", goalId, goalName, amount, saved, date }
//   wish:       { action: "wish", pageId?, name?, price?, priority?, by?, note?, bought?, boughtOn?, photo?: dataURL | null, color?, remove? }
//   snapshot:   { action: "snapshot", pageId?, date, bank, checked?, investments?, binance?, coinbase?, indmoney?, holdings? }

const DS = {
  expenses: '00000000-0000-0000-0000-000000000001',
  snapshots: '00000000-0000-0000-0000-000000000003',
  budgets: '00000000-0000-0000-0000-000000000004',
  goals: '00000000-0000-0000-0000-000000000005',
  wishlist: '00000000-0000-0000-0000-000000000007',
};

// Must match the Category options in Notion. "In Cash" is what the nightly sync uses for cash;
// "Transfers" is the newer name some rows carry. Both count as spending.
const CATEGORIES = ['Subscription', 'Business', 'Personal Expense', 'Home', 'Fitness & Diet', 'Transport', 'Foods & Drinks',
  'In Cash', 'Sweety', 'Transfers', 'Savings', 'Investing & Trading', 'Income'];
const SOURCES = ['UPI', 'Debit Card', 'NEFT', 'Other'];
const GOAL_STATUS = ['Active', 'Reached', 'Paused'];

/* ---------- Notion transport (either API generation) ----------------------- */
let ROUTE = null;
async function notion(token, path, method, body, version) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': version || '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
async function create(token, dsId, properties) {
  const attempts = ROUTE === 'databases' ? [['databases', '2022-06-28']]
    : ROUTE === 'data_sources' ? [['data_sources', '2025-09-03']]
      : [['data_sources', '2025-09-03'], ['databases', '2022-06-28']];
  let lastErr = null;
  for (const [route, version] of attempts) {
    const parent = route === 'data_sources' ? { type: 'data_source_id', data_source_id: dsId } : { type: 'database_id', database_id: dsId };
    try { const out = await notion(token, 'pages', 'POST', { parent, properties }, version); ROUTE = route; return out.id; }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}
const patch = (token, id, properties) => notion(token, `pages/${id}`, 'PATCH', { properties }, '2022-06-28')
  .catch(() => notion(token, `pages/${id}`, 'PATCH', { properties }, '2025-09-03'));

// Notion keeps the file itself: create an upload, send the bytes, then the page property points at the upload id.
async function uploadFile(token, bytes, filename, type) {
  const up = await notion(token, 'file_uploads', 'POST', { mode: 'single_part', filename, content_type: type });
  const form = new FormData(); form.append('file', new Blob([bytes], { type }), filename);
  const res = await fetch(`https://api.notion.com/v1/file_uploads/${up.id}/send`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' }, body: form });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return up.id;
}

/* ---------- builders & validation ------------------------------------------ */
const title = (s) => ({ title: [{ text: { content: String(s ?? '').slice(0, 200) } }] });
const rich = (s, max = 500) => ({ rich_text: [{ text: { content: String(s ?? '').slice(0, max) } }] });
const select = (s) => ({ select: s ? { name: s } : null });
// Paise, not whole rupees: Math.round() here once turned 1717.91 into 1718.
const money = (v) => { const n = Number(v); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+([+-]\d{2}:\d{2}|Z)?)?$/.test(s);
const isId = (s) => typeof s === 'string' && /^[0-9a-f-]{32,36}$/i.test(s);
class Bad extends Error {}

function txEditProps({ category, note, amount, entry, confirm, exclude, auto }) {
  const props = {};
  if (category !== undefined) { if (!CATEGORIES.includes(category)) throw new Bad('unknown category'); props.Category = select(category); }
  if (note !== undefined) props.Note = rich(note);
  if (entry !== undefined) props.Entry = title(entry);
  if (amount !== undefined) { const n = money(amount); if (n === null) throw new Bad('invalid amount'); props.Amount = { number: n }; }
  if (exclude !== undefined) props['Exclude from spend'] = { checkbox: !!exclude };
  if (confirm) props.Status = select('Confirmed');
  // The model's own guess: off the review list, but not used to train it until you confirm it.
  else if (auto) props.Status = select('Auto-filed');
  return props;
}

const actions = {
  async create(b, token, env) {
    const amount = money(b.amount);
    if (!amount) throw new Bad('amount required');
    if (!['Debit', 'Credit'].includes(b.type)) throw new Bad('type must be Debit or Credit');
    if (!CATEGORIES.includes(b.category)) throw new Bad('unknown category');
    if (!isDate(b.date)) throw new Bad('invalid date');
    if (b.source && !SOURCES.includes(b.source)) throw new Bad('unknown source');
    // A statement row brings the bank's own reference, so the nightly sync sees it and won't add it twice.
    if (b.refId !== undefined && !/^[\w.-]{1,60}$/.test(String(b.refId))) throw new Bad('invalid refId');
    const props = {
      Entry: title(b.entry || b.note || b.category),
      Amount: { number: amount },
      Type: select(b.type),
      Category: select(b.category),
      Note: rich(b.note || ''),
      Source: select(b.source || 'Other'),
      'Ref ID': rich(b.refId || `manual-${Date.now()}`), // the nightly sync dedupes on Ref ID
      Date: { date: { start: b.date } },
      Status: select(b.review ? 'Needs review' : b.auto ? 'Auto-filed' : 'Confirmed'),
      'Exclude from spend': { checkbox: ['Investing & Trading', 'Savings'].includes(b.category) },
    };
    if (b.payee) props.Payee = rich(b.payee, 200);
    return { id: await create(token, env.NOTION_EXPENSES_DS || DS.expenses, props) };
  },

  async bulk(b, token) {
    if (!Array.isArray(b.pageIds) || !b.pageIds.length || b.pageIds.length > 50 || !b.pageIds.every(isId)) throw new Bad('pageIds: 1 to 50 ids');
    const props = txEditProps(b);
    if (!Object.keys(props).length) throw new Bad('nothing to update');
    for (const id of b.pageIds) await patch(token, id, props); // ponytail: sequential to respect Notion's ~3 req/s limit
    return { updated: b.pageIds.length };
  },

  async budget(b, token, env) {
    const amount = money(b.amount);
    if (amount === null) throw new Bad('invalid amount');
    if (b.pageId) { if (!isId(b.pageId)) throw new Bad('bad pageId'); await patch(token, b.pageId, { 'Monthly budget': { number: amount } }); return {}; }
    if (!CATEGORIES.includes(b.category)) throw new Bad('unknown category');
    return { id: await create(token, env.NOTION_BUDGETS_DS || DS.budgets, { Category: title(b.category), 'Monthly budget': { number: amount } }) };
  },

  async goal(b, token, env) {
    const props = {};
    if (b.name !== undefined) { if (!String(b.name).trim()) throw new Bad('name required'); props.Goal = title(b.name); }
    if (b.target !== undefined) { const n = money(b.target); if (!n) throw new Bad('invalid target'); props['Target amount'] = { number: n }; }
    if (b.saved !== undefined) { const n = money(b.saved); if (n === null) throw new Bad('invalid saved'); props['Saved amount'] = { number: n }; }
    if (b.deadline) { if (!isDate(b.deadline)) throw new Bad('invalid deadline'); props.Deadline = { date: { start: b.deadline } }; }
    if (b.status !== undefined) { if (!GOAL_STATUS.includes(b.status)) throw new Bad('invalid status'); props.Status = select(b.status); }
    if (b.pageId) { if (!isId(b.pageId)) throw new Bad('bad pageId'); await patch(token, b.pageId, props); return {}; }
    if (!props.Goal || !props['Target amount']) throw new Bad('name and target required');
    props.Status = props.Status || select('Active');
    return { id: await create(token, env.NOTION_GOALS_DS || DS.goals, props) };
  },

  // Wishlist items are plans, not spending: nothing here touches the Expense Tracker.
  async wish(b, token, env) {
    if (b.pageId !== undefined && !isId(b.pageId)) throw new Bad('bad pageId');
    if (b.remove) { if (!b.pageId) throw new Bad('pageId required'); await notion(token, `pages/${b.pageId}`, 'PATCH', { archived: true }); return {}; }
    const props = {};
    if (b.name !== undefined) { if (!String(b.name).trim()) throw new Bad('name required'); props.Item = title(b.name); }
    if (b.price !== undefined) { const n = money(b.price); if (!n) throw new Bad('invalid price'); props.Price = { number: n }; }
    if (b.priority !== undefined) { if (!['Need', 'Want'].includes(b.priority)) throw new Bad('priority must be Need or Want'); props.Priority = select(b.priority); }
    if (b.by !== undefined) { if (b.by && !isDate(b.by)) throw new Bad('invalid date'); props.By = { date: b.by ? { start: b.by } : null }; }
    if (b.note !== undefined) props.Note = rich(b.note);
    if (b.bought !== undefined) props.Bought = { checkbox: !!b.bought };
    if (b.boughtOn !== undefined) { if (b.boughtOn && !isDate(b.boughtOn)) throw new Bad('invalid date'); props['Bought on'] = { date: b.boughtOn ? { start: b.boughtOn } : null }; }
    if (b.color !== undefined) { if (b.color && !/^#[0-9a-f]{6}$/i.test(b.color)) throw new Bad('invalid color'); props.Color = rich(b.color || ''); }
    // The browser sends the square it cropped as a JPEG data URL (about 50 KB); null removes the photo.
    if (b.photo === null) props.Photo = { files: [] };
    else if (b.photo !== undefined) {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo));
      if (!m || m[1].length > 2_800_000) throw new Bad('photo must be a JPEG under 2 MB');
      const id = await uploadFile(token, Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)), 'photo.jpg', 'image/jpeg');
      props.Photo = { files: [{ type: 'file_upload', file_upload: { id }, name: 'photo.jpg' }] };
    }
    if (b.pageId) { await patch(token, b.pageId, props); return {}; }
    if (!props.Item || !props.Price) throw new Bad('name and price required');
    return { id: await create(token, env.NOTION_WISHLIST_DS || DS.wishlist, props) };
  },

  // Bumps Saved amount and logs a Savings transaction ("Goal: <name>") so goal history exists.
  async contribute(b, token, env) {
    const amount = money(b.amount), saved = money(b.saved);
    if (!amount || saved === null) throw new Bad('invalid amount');
    if (!isId(b.goalId)) throw new Bad('bad goalId');
    if (!isDate(b.date)) throw new Bad('invalid date');
    await patch(token, b.goalId, { 'Saved amount': { number: saved } });
    await create(token, env.NOTION_EXPENSES_DS || DS.expenses, {
      Entry: title('Saved for ' + b.goalName), Amount: { number: amount }, Type: select('Debit'), Category: select('Savings'),
      Note: rich('Goal: ' + b.goalName), Source: select('Other'), 'Ref ID': rich(`goal-${Date.now()}`),
      Date: { date: { start: b.date } }, Status: select('Confirmed'), 'Exclude from spend': { checkbox: true },
    });
    return {};
  },

  // Updates the row for that date when one exists (the nightly sync never wants two rows per day).
  async snapshot(b, token, env) {
    if (!isDate(b.date)) throw new Bad('invalid date');
    const props = { Date: { date: { start: b.date } } };
    for (const [k, name] of [['bank', 'Bank balance'], ['investments', 'Investments'], ['binance', 'Binance'], ['coinbase', 'Coinbase'], ['indmoney', 'INDmoney']]) {
      if (b[k] === undefined || b[k] === null) continue;
      const n = money(b[k]); if (n === null) throw new Bad('invalid ' + k);
      props[name] = { number: n };
    }
    if (b.holdings !== undefined) props.Holdings = rich(b.holdings, 2000);
    if (b.checked !== undefined) props['Balance checked'] = { checkbox: !!b.checked };
    if (b.pageId) { if (!isId(b.pageId)) throw new Bad('bad pageId'); await patch(token, b.pageId, props); return {}; }
    props.Snapshot = title(b.label || b.date);
    return { id: await create(token, env.NOTION_SNAPSHOTS_DS || DS.snapshots, props) };
  },
};

export async function onRequestPost({ request, env }) {
  const token = env.NOTION_TOKEN;
  if (!token) return json({ ok: false, error: 'NOTION_TOKEN is not set' }, 500);
  let body;
  try { body = (await request.json()) || {}; } catch { return json({ ok: false, error: 'Body must be JSON' }, 400); }

  try {
    if (body.action) {
      const fn = actions[body.action];
      if (!fn) return json({ ok: false, error: `Unknown action "${body.action}"` }, 400);
      return json({ ok: true, ...(await fn(body, token, env)) });
    }
    if (!isId(body.pageId)) return json({ ok: false, error: 'pageId required' }, 400);

    // Split: the original is zeroed and excluded rather than deleted, so its Ref ID stays in
    // Notion and the nightly dedupe never re-imports the same alert. Each part is a new row.
    if (Array.isArray(body.split)) {
      const parts = body.split.map((s) => ({ category: s.category, amount: money(s.amount), note: s.note }));
      if (parts.length < 2) throw new Bad('need at least two parts');
      if (parts.some((p) => !CATEGORIES.includes(p.category))) throw new Bad('a split part has an unknown category');
      if (parts.some((p) => !p.amount)) throw new Bad('every split part needs an amount');
      const orig = await notion(token, `pages/${body.pageId}`, 'GET').catch(() => notion(token, `pages/${body.pageId}`, 'GET', null, '2025-09-03'));
      const op = orig.properties || {};
      const plain = (p) => (p?.rich_text || p?.title || []).map((t) => t.plain_text).join('');
      // The parts must add up to the payment, here and not only on the page, or a split could change the total.
      const total = op.Amount?.number || 0, sum = parts.reduce((s, p) => s + p.amount, 0);
      if (Math.abs(sum - total) > 0.01) throw new Bad(`the parts add up to ${sum}, the payment is ${total}`);
      for (const p of parts) {
        const props = {
          Entry: title(plain(op.Entry) || 'Split'), Amount: { number: p.amount }, Type: select(op.Type?.select?.name || 'Debit'),
          Category: select(p.category), Note: rich(p.note || 'split'), Source: select(op.Source?.select?.name || 'Other'),
          'Ref ID': rich(`${plain(op['Ref ID']) || body.pageId}-split`), Status: select('Confirmed'),
        };
        if (op.Date?.date) props.Date = { date: op.Date.date };
        if (plain(op.Payee)) props.Payee = rich(plain(op.Payee), 200);
        await create(token, env.NOTION_EXPENSES_DS || DS.expenses, props);
      }
      await patch(token, body.pageId, { Amount: { number: 0 }, 'Exclude from spend': { checkbox: true }, Status: select('Confirmed'), Note: rich('split into parts') });
      return json({ ok: true, created: parts.length });
    }

    const props = txEditProps(body);
    if (!Object.keys(props).length) return json({ ok: false, error: 'nothing to update' }, 400);
    // A bank payment (a bank Ref ID, not "manual-") keeps the amount the bank sent: an edited amount would make every
    // total quietly wrong. Category, note and the rest stay editable; to divide it, split it. Cash and manual rows stay open.
    if (props.Amount) {
      const pg = await notion(token, `pages/${body.pageId}`, 'GET').catch(() => notion(token, `pages/${body.pageId}`, 'GET', null, '2025-09-03'));
      const ref = (pg.properties?.['Ref ID']?.rich_text || []).map((t) => t.plain_text).join('');
      if (ref && !/^manual-/.test(ref) && Math.abs((pg.properties?.Amount?.number ?? 0) - props.Amount.number) > 0.001) throw new Bad("a bank payment keeps the bank's amount; split it instead");
    }
    await patch(token, body.pageId, props);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof Bad) return json({ ok: false, error: e.message }, 400);
    const msg = String(e?.message || e);
    // Notion answers 404 for tables that exist but aren't shared with this site's connection.
    if (/object_not_found/.test(msg)) return json({ ok: false, error: "Notion can’t see this table yet. In Notion open it, then ••• → Connections → add “expense-site”" }, 424);
    return json({ ok: false, error: msg.slice(0, 300) }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
