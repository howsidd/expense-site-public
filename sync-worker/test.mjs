// node test.mjs — the parser against real HDFC alert wording (Oct 2026). Names, handles and refs are made up.
import assert from 'node:assert/strict';
import { parseAlert, categorize, applyHistory, entryFor, htmlToText, baseRef, sync, parseSms, findSame, handleSms, availBalance, aiGuess, zeptoItems, splitParts, itemCats, splitZepto, health, backup, plainRow, duplicates, revalue, fillSnapshot, istDay, readOrderReply, splitOrder, fixUnsorted, removeDuplicates } from './index.js';

const at = (iso) => ({ id: 'msg1', internalDate: String(Date.parse(iso)) });
// Everything but `display`, which only reaches aiGuess and is never written to Notion (checked at the end).
const stored = (x) => JSON.stringify(x, (k, v) => (k === 'display' ? undefined : v));
const greet = 'Dear Customer, Greetings from HDFC Bank! ';
const run = (text, iso = '2026-10-22T03:20:54Z') => { const tx = parseAlert(text, at(iso)); return tx && { tx, cat: categorize(tx) }; };

// UPI debit to Zepto: time from the email (03:20:54Z = 08:50:54 IST). No item email exists, so it's Auto-filed as Fitness & Diet.
let r = run(`❗ You have done a UPI txn. Check details!. ${greet}Rs.433.00 is debited from your account ending 1234 towards VPA *************payu@hdfcbank (ZEPTO) on 22-10-26. UPI transaction reference no.: 111111111111. If you did not authorize this transaction, please report it`);
assert.deepEqual([r.tx.type, r.tx.amount, r.tx.ref, r.tx.source, r.tx.payee, r.tx.date], ['Debit', 433, '111111111111', 'UPI', 'Zepto', '2026-10-22T08:50:54+05:30']);
assert.deepEqual([r.cat.category, r.cat.status, r.cat.shop], ['Fitness & Diet', 'Auto-filed', true]);
// ...or whatever its orders were filed under most.
const zep = [['Fitness & Diet', 1], ['Home', 2], ['Personal Expense', 1]].flatMap(([category, n]) => Array(n).fill({ type: 'Debit', status: 'Confirmed', category }));
assert.deepEqual([applyHistory(r.tx, r.cat, zep).category, applyHistory(r.tx, r.cat, zep).status], ['Home', 'Auto-filed']);

// UPI debit to a person: payee is the handle, never the name; ₹20 at 21:00 IST is an auto.
r = run(`${greet}Rs.20.00 is debited from your account ending 1234 towards VPA *********abc1@okaxis (JOHN DOE) on 21-10-26. UPI transaction reference no.: 222222222222. If you`, '2026-10-21T15:30:00Z');
assert.equal(r.tx.payee, '*********abc1@okaxis');
assert.ok(!stored(r).includes('JOHN'));
assert.deepEqual([r.cat.category, r.cat.note, r.cat.status, entryFor(r.tx, r.cat)], ['Transport', 'auto', 'Confirmed', 'Auto']);
// Same payment at 14:00 IST: not commute hours, so it waits for review.
assert.equal(run(`${greet}Rs.20.00 is debited from your account ending 1234 towards VPA x9@okaxis (JOHN DOE) on 21-10-26. UPI transaction reference no.: 2.`, '2026-10-21T08:30:00Z').cat.status, 'Needs review');

// Business display names count as merchants; restaurants are Foods & Drinks.
r = run(`${greet}Rs.800.00 is debited from your account ending 1234 towards VPA q000000001@ybl (Hotel sample inn) on 13-10-26. UPI transaction reference no.: 333333333333.`);
assert.deepEqual([r.tx.payee, r.cat.category, r.cat.status], ['Hotel Sample Inn', 'Foods & Drinks', 'Confirmed']);
r = run(`${greet}Rs.110.00 is debited from your account ending 1234 towards VPA *********000h@pty (SOME_SHOP_LLP_) on 19-10-26. UPI transaction reference no.: 444.`);
assert.equal(r.tx.payee, 'Some Shop Llp');
// Shops' company names: "BLINK COMMERCE PRIVATE LIMITED" is Blinkit (seen 22 Oct 2026).
r = run(`${greet}Rs.509.00 is debited from your account ending 1234 towards VPA *******************************payu@indus (BLINK COMMERCE PRIVATE LIMITED) on 22-10-26. UPI transaction reference no.: 121.`);
assert.deepEqual([r.tx.payee, r.cat.shop], ['Blinkit', true]);
r = run(`${greet}Rs.4.85 is debited from your account ending 1234 towards VPA bdpg.iruts@sbi (Indian Railways) on 24-08-26. UPI transaction reference no.: 555.`);
assert.deepEqual([r.cat.category, r.cat.note], ['Transport', 'train ticket']);
// Business-only handles keep the name even with no business word in it (seen 24 Oct 2026).
r = run(`${greet}Rs.895.00 is debited from your account ending 1234 towards VPA ********203n@ptys (SAMPLE GRILL) on 24-10-26. UPI transaction reference no.: 556.`);
assert.deepEqual([r.tx.payee, r.tx.person, entryFor(r.tx, r.cat)], ['Sample Grill', false, 'Sample Grill']);
r = run(`${greet}Rs.83.00 is debited from your account ending 1234 towards VPA ****bdpg@hdfcbank (RAILONE) on 24-10-26. UPI transaction reference no.: 557.`);
assert.deepEqual([r.tx.payee, r.cat.category, r.cat.note], ['Railone', 'Transport', 'train ticket']);
r = run(`${greet}Rs.40.00 is debited from your account ending 1234 towards VPA ******5507@okbizaxis (MOD) on 24-10-26. UPI transaction reference no.: 558.`, '2026-10-24T06:43:00Z');
assert.deepEqual([r.tx.payee, r.cat.category, r.cat.status], ['Mod', 'Personal Expense', 'Needs review']); // a shop, not an auto

// UPI credit from a person: review, handle only.
r = run(`View: Account update for your HDFC Bank A/c. ${greet}We're writing to inform you that Rs.350.00 has been successfully credited to your HDFC Bank account ending in 1234. Transaction Details: a. Date: 21-10-26 b. Sender: SOME PERSON NAME (VPA: **********0000@okaxis) c. UPI Reference No.: 666666666666 Need Help?`);
assert.deepEqual([r.tx.type, r.tx.amount, r.tx.ref, r.tx.payee, r.cat.status], ['Credit', 350, '666666666666', '**********0000@okaxis', 'Needs review']);
assert.ok(!stored(r).includes('PERSON'));

// Debit card: time from the alert itself, Ref ID = Gmail message id (as the routines do).
r = run(`Rs.9111.64 debited via Debit Card **4321. ${greet}Rs.9111.64 is debited from your HDFC Bank Debit Card ending 4321 at ANTHROPIC* CLAUDE SUB on 21 Oct, 2026 at 15:40:31. For more details`);
assert.deepEqual([r.tx.payee, r.tx.ref, r.tx.date, r.tx.source], ['ANTHROPIC CLAUDE SUB', 'msg1', '2026-10-21T15:40:31+05:30', 'Debit Card']);
r = run(`${greet}Rs.158.00 is debited from your HDFC Bank Debit Card ending 4321 at AMAZONIN on 29 Aug, 2026 at 19:46:24. For more`);
assert.equal(r.cat.shop, true);

// Card refund.
r = run(`Dear Card Member, We note that a transaction for Rs 103.76, on your HDFC Bank Debit Card ending 4321 at ORACLE SINGAPORE on 29-09-2026 22:40:59 is reversed. Contact Bank`);
assert.deepEqual([r.tx.type, r.tx.amount, r.tx.date, r.cat.status], ['Credit', 103.76, '2026-09-29T22:40:59+05:30', 'Needs review']);

// IMPS out, Indian digit grouping.
r = run(`${greet}INR 1,00,000.00 has been debited from your account ending xxxxxxxxxx1234 on 12-10-26 and credited to the account ending xxxxxxxxxx0099 via IMPS. IMPS Reference No: 777777777777 Available Balance: INR 21,111.53`);
assert.deepEqual([r.tx.amount, r.tx.ref, r.tx.payee, entryFor(r.tx, r.cat)], [100000, '777777777777', 'A/c 0099', 'IMPS transfer to A/c 0099']);
assert.deepEqual([r.cat.category, r.cat.status, r.cat.exclude], ['Investing & Trading', 'Confirmed', true]); // a Binance payee
assert.equal(categorize({ ...r.tx, payee: 'A/c 6000' }).category, 'Investing & Trading');
assert.notEqual(categorize({ ...r.tx, payee: 'A/c 1234' }).category, 'Investing & Trading');

// Deposits: names in the reference are dropped.
r = run(`Dear Customer, You have received a credit in your HDFC Bank account. Details of the transaction: Amount received: INR 40,111.89 Account: XX1234 Date: 21-OCT-2026 Reference Details: Foreign INR PACB INW-TXN000000R0-SOME NAME-SKYDO Available Balance: INR 41,111.31 For real-time`);
assert.deepEqual([r.tx.payee, r.cat.category, r.cat.status, entryFor(r.tx, r.cat)], ['Skydo', 'Income', 'Confirmed', 'Skydo credit']);
assert.ok(!JSON.stringify(r).includes('NAME'));
r = run(`Amount received: INR 90111.48 Account: XX1234 Date: 25-SEP-2026 Reference Details: NEFT Cr-IDFB0010201-SOME NAME-REF123 Available Balance: INR 1.00`);
assert.deepEqual([r.tx.payee, r.tx.source, r.cat.category], ['NEFT IDFB0010201', 'NEFT', 'Income']);
r = run(`Amount received: INR 4,80000.00 Account: XX1234 Date: 24-SEP-2026 Reference Details: Rev-IMPS-626000000000 Available Balance: INR 1.00`);
assert.deepEqual([r.tx.amount, r.cat.category, r.cat.status], [480000, 'Personal Expense', 'Needs review']);

// Not transactions, or repeats of a card alert.
for (const s of [
  `${greet}Your Apple Distribution International Limited bill, set up through E-mandate (Auto payment), has been successfully paid using your HDFC Bank Debit Card ending 4321. Transaction Details: Amount: INR 349.00`,
  `${greet}Rs. INR 9111.64 is deducted from your account ending XX1234 and added to ME DC SI 400000XXXXXX4321 ANTHROPIC* CLAUDE SUB account on 21-OCT-2026.`,
  `${greet}There is an upcoming E-mandate (Auto payment) of INR 349.00 for Some Limited. Amount will be debited`,
  `Dear Customer, Thank you for choosing HDFC Bank! Recent International Transaction Alert: Your HDFC Bank Debit Card ending in XX4321 was used for an international purchase of INR 2292.43 on 11/10/2026. Forex Conversion Markup Fee`,
  `Important :Transaction Decline on your HDFC Bank Debit Card ending with xx4321`,
]) assert.equal(parseAlert(s, at('2026-10-21T00:00:00Z')), null, s.slice(0, 60));

// An unknown wording that still moves money becomes a review row instead of being lost.
r = run(`${greet}Rs.500.00 has been withdrawn from your account at ATM 1234 on 01-11-26.`);
assert.deepEqual([r.tx.amount, r.tx.type, r.cat.status], [500, 'Debit', 'Needs review']);

// Learned categories and lending pairs.
const tx = parseAlert(`${greet}Rs.40.00 is debited from your account ending 1234 towards VPA x123@okaxis (A B) on 13-10-26. UPI transaction reference no.: 9.`, at('2026-10-13T08:00:00Z'));
const rows = [{ type: 'Debit', status: 'Confirmed', category: 'Fitness & Diet', amount: 30 }, { type: 'Debit', status: 'Confirmed', category: 'Fitness & Diet', amount: 50 }];
assert.deepEqual(applyHistory(tx, categorize(tx), rows).category, 'Fitness & Diet');
assert.equal(applyHistory(tx, categorize(tx), rows.slice(0, 1)).status, 'Needs review');
// Rows disagree: the rules decide, and a payment to a person is Transfers waiting for review.
assert.deepEqual(Object.values(applyHistory(tx, categorize(tx), [...rows, { type: 'Debit', status: 'Confirmed', category: 'Home', amount: 1 }])).slice(0, 2), ['Transfers', 'Needs review']);
// A small credit from a person is Transfers for review, never Income or Personal Expense; a big one is Income.
const credit = { ...tx, type: 'Credit', amount: 500, date: '2026-10-20T10:00:00+05:30' };
assert.deepEqual([categorize(credit).category, categorize(credit).status], ['Transfers', 'Needs review']);
// A big credit is Income only after you confirm it; INDmoney paying out is your own money (Sep 2026: ₹4.4 lakh).
assert.deepEqual(Object.values(categorize({ ...credit, amount: 50000 })).slice(0, 2), ['Income', 'Needs review']);
assert.deepEqual(Object.values(categorize({ ...credit, amount: 40111.89, name: 'Skydo', payee: 'Skydo' })).slice(0, 2), ['Income', 'Confirmed']);
const ind = parseAlert(`Amount received: INR 4,11,111.43 Account: XX1234 Date: 17-SEP-2026 Reference Details: NEFT Cr-CITI0100000-INDMONEY GLOBAL LLC-REF1 Available Balance: INR 5,00,000.00`, at('2026-09-17T06:00:00Z'));
assert.deepEqual([ind.name, categorize(ind).category, categorize(ind).exclude], ['INDmoney', 'Investing & Trading', true]);

// Lending pairs: same handle, amount within ₹1, up to 45 days later; the earliest unpaid debit first.
const lent = { id: 'd1', type: 'Debit', status: 'Needs review', category: 'Transfers', amount: 500.5, date: '2026-10-01T10:00:00+05:30', note: '' };
let pair = applyHistory(credit, categorize(credit), [lent, { ...lent, id: 'd0', date: '2026-08-01T10:00:00+05:30' }]); // d0 is 80 days back
assert.deepEqual([pair.category, pair.status, pair.note, pair.lent], ['Transfers', 'Confirmed', 'paid back', 'd1']);
pair = applyHistory({ ...credit, amount: 50000 }, categorize({ ...credit, amount: 50000 }), [{ ...lent, amount: 50000 }]);
assert.deepEqual([pair.category, pair.note], ['Transfers', 'paid back']); // a repayment beats the ₹15,000 Income rule
pair = applyHistory(credit, categorize(credit), [{ ...lent, status: 'Confirmed', category: 'Foods & Drinks' }]); // a friend's share of dinner
assert.deepEqual([pair.category, pair.status, pair.lent], ['Foods & Drinks', 'Confirmed', null]);
assert.equal(applyHistory(credit, categorize(credit), [{ ...lent, note: 'lent, paid back' }]).note, 'money received from a person'); // already repaid
assert.equal(applyHistory(credit, categorize(credit), [{ ...lent, amount: 498 }]).status, 'Needs review'); // more than ₹1 off
assert.equal(applyHistory(credit, categorize(credit), [{ ...lent, date: '2026-10-21T10:00:00+05:30' }]).status, 'Needs review'); // debit after the credit

assert.equal(htmlToText('<td>We&#39;re&nbsp;<b>Rs.1</b></td>'), "We're Rs.1");
assert.deepEqual(['123-s2', 'abc-split', '123'].map(baseRef), ['123', 'abc', '123']);

// A whole run against fake Gmail and Notion: one new UPI alert, one already in Notion as a split, one e-mandate notice.
const enc = (s) => Buffer.from(s).toString('base64url');
const mail = (id, html) => ({ id, internalDate: String(Date.parse('2026-10-21T14:19:15Z')),
  payload: { mimeType: 'multipart/alternative', headers: [{ name: 'Subject', value: 'UPI txn' }], parts: [{ mimeType: 'text/html', body: { data: enc(html) } }] } });
const inbox = {
  a: mail('a', 'Rs.193.00 is debited from your account ending 1234 towards VPA **aytm@hdfcbank (BLINKIT) on 21-10-26.<br><br>UPI transaction reference no.: 629488549913.'),
  b: mail('b', 'Rs.50.00 is debited from your account ending 1234 towards VPA x@ybl (A B) on 21-10-26.<br>UPI transaction reference no.: 111.'),
  c: mail('c', 'Your bill, set up through E-mandate (Auto payment), has been successfully paid. Amount: INR 349.00'),
};
const created = [];
let failNotion = false;
globalThis.fetch = async (url, opts = {}) => {
  const ok = (j) => ({ ok: true, json: async () => j });
  if (url.includes('oauth2')) return ok({ access_token: 't' });
  if (url.includes('/messages?')) return ok({ messages: ['c', 'b', 'a'].map((id) => ({ id })) });
  if (url.includes('/messages/')) return ok(inbox[url.split('/messages/')[1].split('?')[0]]);
  if (url.endsWith('/query')) {
    const f = JSON.parse(opts.body).filter;
    const row = (ref, extra = {}) => ({ properties: { 'Ref ID': { rich_text: [{ plain_text: ref }] }, ...extra } });
    return ok({ results: f.property === 'Date' ? [row('111-s1')] : [], has_more: false });
  }
  if (url.endsWith('/pages')) { if (failNotion) return { ok: false, status: 502, text: async () => 'down' }; created.push(JSON.parse(opts.body)); return ok({ id: 'p' }); }
  throw new Error('unexpected ' + url);
};
const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', NOTION_TOKEN: 'x', SEEN: { get: async () => null, put: async () => {} } };
failNotion = true;
let seen = {};
await assert.rejects(sync(env, seen));
assert.deepEqual(seen, {}); // nothing marked handled, so the next run retries all of it
failNotion = false;
assert.deepEqual(await sync(env, seen), { emails: 3, added: 1, review: 0, duplicate: 1, ignored: 1 });
const p = created[0].properties;
assert.deepEqual([p['Ref ID'].rich_text[0].text.content, p.Payee.rich_text[0].text.content, p.Date.date.start, p.Status.select.name, created[0].parent.data_source_id],
  ['629488549913', 'Blinkit', '2026-10-21T19:49:15+05:30', 'Auto-filed', '00000000-0000-0000-0000-000000000001']);
assert.ok(!('Bank balance' in p));
assert.deepEqual(await sync(env, seen), { emails: 0, added: 0, review: 0, duplicate: 0, ignored: 0 });
assert.equal(created.length, 1);

// ---- SMS. HDFC's SMS wording (2025-26 templates); names, handles and refs made up. Replace with real samples when available.
const sms = (text, at = '2026-10-22T08:50:54+05:30', sender = 'AX-HDFCBK') => { const tx = parseSms(text, at, sender); return tx && { tx, cat: categorize(tx) }; };
let q = sms('Sent Rs.433.00\nFrom HDFC Bank A/C *1234\nTo ZEPTO\nOn 22/10/26\nRef 111111111111\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808');
assert.deepEqual([q.tx.type, q.tx.amount, q.tx.ref, q.tx.payee, q.tx.date, q.cat.shop], ['Debit', 433, '111111111111', 'Zepto', '2026-10-22T08:50:54+05:30', true]);
q = sms('Sent Rs.20.00\nFrom HDFC Bank A/C *1234\nTo JOHN DOE\nOn 21/10/26\nRef 222222222222\nNot You?', '2026-10-21T21:05:00+05:30');
assert.deepEqual([q.tx.payee, q.cat.category, q.cat.note], ['', 'Transport', 'auto']);
assert.ok(!stored(q).includes('JOHN'));
q = sms('Money Transfer:Rs 20.00 from a/c **1234 on 21-10-26 to VPA abc1@okaxis(UPI Ref No 333333333333). Not you? Call on 18002586161 to report');
assert.deepEqual([q.tx.ref, q.tx.payee, q.tx.source], ['333333333333', 'abc1@okaxis', 'UPI']); // HDFC only in the sender id
q = sms('Credit Alert!\nRs.350.00 credited to HDFC Bank A/c XX1234 on 21-10-26 from VPA abc@okaxis (UPI 444444444444)');
assert.deepEqual([q.tx.type, q.tx.ref, q.tx.payee, q.cat.status], ['Credit', '444444444444', 'abc@okaxis', 'Needs review']);
q = sms('Spent Rs.9111.64 From HDFC Bank Card x4321 At ANTHROPIC* CLAUDE SUB On 2026-10-21:15:40:31 Bal Rs.31,111.67 Not You? To Block+Reissue Call 18002323232/SMS BLOCK DC 4321 to 7308080808');
assert.deepEqual([q.tx.payee, q.tx.date, q.tx.source, q.tx.balance], ['ANTHROPIC CLAUDE SUB', '2026-10-21T15:40:31+05:30', 'Debit Card', 31111.67]);
q = sms('Withdrawn Rs.2000 From HDFC Bank Card x4321 At +MUMBAI ATM On 2026-10-21:10:00:00 Bal Rs.1234.50 Not You? Call 18002586161');
assert.deepEqual([q.tx.amount, q.cat.category, q.cat.status, q.tx.balance], [2000, 'In Cash', 'Confirmed', 1234.5]);
q = sms('IMPS INR 1,00,000.00 sent from HDFC Bank A/c XX1234 on 12-10-26 To A/c xxxxxxxxxx0099 Ref-777777777777 Avl Bal INR 21,111.53. Not you? Call 18002586161');
assert.deepEqual([q.tx.ref, q.tx.payee, q.tx.balance, entryFor(q.tx, q.cat)], ['777777777777', 'A/c 0099', 21111.53, 'IMPS transfer to A/c 0099']);
q = sms('Update! INR 40,111.89 deposited in HDFC Bank A/c XX1234 on 21-OCT-26 for Foreign INR PACB INW-TXN000000R0-SOME NAME-SKYDO.Avl bal INR 41,111.31. Cheque deposits in A/C are subject to clearing', '2026-10-21T12:56:10+05:30');
assert.deepEqual([q.tx.payee, q.cat.category, q.tx.balance], ['Skydo', 'Income', 41111.31]);
assert.ok(!JSON.stringify(q).includes('NAME'));
for (const t of ['123456 is your OTP for txn of Rs.500 at HDFC Bank. Do not share', 'Upcoming E-mandate: Rs.349 will be debited from HDFC Bank A/c for Apple on 21-10-26'])
  assert.equal(parseSms(t, '2026-10-21T10:00:00+05:30', 'AX-HDFCBK'), null);
assert.equal(parseSms('Rs.500 debited from your account', '2026-10-21T10:00:00+05:30', 'AX-OTHERBK'), null);

// The SMS and the email for one card spend or deposit share no reference: same type and amount within 30 min is the same.
const deposit = q.tx;
assert.ok(findSame(deposit, [{ ref: '1a15d5a36d485cdd', type: 'Credit', amount: 40111.89, date: '2026-10-21T07:25:00.000Z' }]));
assert.ok(!findSame(deposit, [{ ref: '1a15d5a36d485cdd', type: 'Credit', amount: 40111.89, date: '2026-10-21T09:25:00.000Z' }]));
assert.ok(!findSame({ ...deposit, ref: '999999999999' }, [{ ref: 'sms-x', type: 'Credit', amount: 40111.89, date: deposit.date }])); // a bank ref only matches exactly
assert.equal(availBalance('New Deposit Alert: Check your A/c balance now!. Amount received: INR 5 Available Balance: INR 41,111.31 For real-time account balance, please call 1800 270 3333'), 41111.31);

// The endpoint against fake Notion: token, one row, today's checked balance updated in place, never moved back.
const TOKEN = 'a'.repeat(64);
let snap = { id: 'snap1', properties: { Date: { date: { start: '2026-10-21T09:00:00+05:30' } }, 'Balance checked': { checkbox: true } } };
const writes = [];
let recent = []; // rows the fake Notion has in the date window
let only = []; // the Gmail messages a save2() run sees
const save2 = (id) => { only = [id]; return sync(env, {}); };
globalThis.fetch = async (url, opts = {}) => {
  const ok = (j) => ({ ok: true, json: async () => j });
  if (url.includes('oauth2')) return ok({ access_token: 't' });
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (url.includes('/messages?')) return ok({ messages: only.map((id) => ({ id })) });
  if (url.includes('/messages/')) return ok(inbox[url.split('/messages/')[1].split('?')[0]]);
  if (url.includes('000000000003') && url.endsWith('/query')) return ok({ results: snap ? [snap] : [], has_more: false });
  if (url.endsWith('/query') && body.filter?.property === 'Date') return ok({ results: recent, has_more: false });
  if (url.endsWith('/query')) return ok({ results: body.filter?.rich_text?.equals === 'friend@okaxis' ? [{ id: 'd1', properties: {
    'Ref ID': { rich_text: [{ plain_text: '123123123123' }] }, Type: { select: { name: 'Debit' } }, Status: { select: { name: 'Needs review' } },
    Category: { select: { name: 'Transfers' } }, Amount: { number: 300 }, Date: { date: { start: '2026-10-10T10:00:00+05:30' } }, Note: { rich_text: [] } } }] : [], has_more: false });
  writes.push([opts.method, url.replace('https://api.notion.com/v1/', ''), body]);
  return ok({ id: 'new' });
};
const post = (text, token = TOKEN, at = '2026-10-21T15:40:40+05:30') => handleSms(new Request('https://w.dev/sms', { method: 'POST', headers: { 'X-Sync-Token': token },
  body: JSON.stringify({ text, sender: 'AX-HDFCBK', receivedAt: at }) }), { ...env, SMS_TOKEN: TOKEN });
const card = 'Spent Rs.9111.64 From HDFC Bank Card x4321 At ANTHROPIC* CLAUDE SUB On 2026-10-21:15:40:31 Bal Rs.31,111.67 Not You?';
assert.equal((await post(card, 'b'.repeat(64))).status, 401);
assert.equal(writes.length, 0);
assert.deepEqual(await (await post(card)).json(), { ok: true, result: 'added, needs review' }); // no history in the fake Notion
assert.equal(writes[0][2].parent.data_source_id, '00000000-0000-0000-0000-000000000001');
assert.deepEqual([writes[1][0], writes[1][1], writes[1][2].properties['Bank balance'].number, writes[1][2].properties['Balance checked'].checkbox, writes[1][2].properties.Date.date.start],
  ['PATCH', 'pages/snap1', 31111.67, true, '2026-10-21T15:40:31+05:30']);
snap.properties.Date.date.start = '2026-10-21T18:00:00+05:30'; writes.length = 0;
await post('Sent Rs.10.00 From HDFC Bank A/C *1234 To x@ybl On 21/10/26 Ref 888888888888 Avl Bal Rs.5.00', TOKEN, '2026-10-21T16:00:00+05:30');
assert.equal(writes.filter((w) => w[1].startsWith('pages/snap1')).length, 0); // older than the balance already there
snap = null; writes.length = 0;
await post('Sent Rs.10.00 From HDFC Bank A/C *1234 To x@ybl On 22/10/26 Ref 999999999999 Avl Bal Rs.5.00', TOKEN, '2026-10-22T00:30:00+05:30');
assert.deepEqual([writes[1][0], writes[1][2].parent.data_source_id, writes[1][2].properties.Snapshot.title[0].text.content], ['POST', '00000000-0000-0000-0000-000000000003', '22 Oct 2026']);
writes.length = 0; snap = null;
assert.deepEqual(await (await post('Credit Alert! Rs.300.00 credited to HDFC Bank A/c XX1234 on 21-10-26 from VPA friend@okaxis (UPI 565656565656)')).json(), { ok: true, result: 'added' });
assert.deepEqual([writes[0][2].properties.Category.select.name, writes[0][2].properties.Note.rich_text[0].text.content], ['Transfers', 'paid back']);
assert.deepEqual([writes[1][0], writes[1][1], writes[1][2].properties.Note.rich_text[0].text.content], ['PATCH', 'pages/d1', 'lent, paid back']);
assert.deepEqual(await (await post('Your OTP is 123456 for HDFC Bank NetBanking')).json(), { ok: true, result: 'ignored' });

// The SMS to a person came first with no Payee; the next alert for that ref fills the UPI handle in, and adds no row.
recent = [{ id: 'sms1', properties: { 'Ref ID': { rich_text: [{ plain_text: '777777777777' }] }, Type: { select: { name: 'Debit' } }, Amount: { number: 10 },
  Date: { date: { start: '2026-10-21T15:40:00+05:30' } }, Payee: { rich_text: [] } } }]; writes.length = 0;
assert.deepEqual(await (await post('Sent Rs.10.00 From HDFC Bank A/C *1234 To x@ybl On 21/10/26 Ref 777777777777')).json(), { ok: true, result: 'already in Notion' });
assert.deepEqual(writes.map((w) => [w[0], w[1], w[2].properties.Payee?.rich_text[0].text.content]), [['PATCH', 'pages/sms1', 'x@ybl']]);
recent[0].properties.Payee = { rich_text: [{ plain_text: 'x@ybl' }] }; writes.length = 0;
await post('Sent Rs.10.00 From HDFC Bank A/C *1234 To x@ybl On 21/10/26 Ref 777777777777');
assert.equal(writes.length, 0); // already has a payee: nothing written
recent = [];

// Workers AI: a name no rule knows gets the model's category, still for review, and keeps the shop's name;
// a person stays Transfers and their name is never stored.
const ai = (answer) => ({ run: async (model, { messages }) => { ai.seen = messages[1].content; return { response: answer }; } });
assert.equal(await aiGuess({}, { display: 'X' }), null); // no AI binding: no guess
assert.equal(await aiGuess({ AI: ai('Fitness & Diet.') }, { display: 'SAMPLE CHAAT CORNER', payee: 'q1@ybl', amount: 180 }), 'Fitness & Diet');
assert.match(ai.seen, /SAMPLE CHAAT CORNER/);
assert.equal(await aiGuess({ AI: ai('Foods & Drinks, not Fitness & Diet') }, { display: 'X' }), 'Foods & Drinks'); // the first one named wins
assert.equal(await aiGuess({ AI: { run: async () => { throw new Error('down'); } } }, { display: 'X' }), null);
const smsAt = (text, AI) => handleSms(new Request('https://w.dev/sms', { method: 'POST', headers: { 'X-Sync-Token': TOKEN },
  body: JSON.stringify({ text, sender: 'AX-HDFCBK', receivedAt: '2026-10-22T13:13:00+05:30' }) }), { ...env, SMS_TOKEN: TOKEN, AI });
writes.length = 0;
assert.deepEqual(await (await smsAt('Sent Rs.180.00\nFrom HDFC Bank A/C *1234\nTo SAMPLE CHAAT CORNER\nOn 22/10/26\nRef 444444444444', ai('Fitness & Diet'))).json(), { ok: true, result: 'added, needs review' });
const aiRow = writes[0][2].properties;
assert.deepEqual([aiRow.Category.select.name, aiRow.Status.select.name, aiRow.Note.rich_text[0].text.content, aiRow.Entry.title[0].text.content, aiRow.Payee.rich_text[0].text.content],
  ['Fitness & Diet', 'Needs review', 'AI guess', 'Sample Chaat Corner', 'Sample Chaat Corner']);
writes.length = 0;
await smsAt('Sent Rs.500.00\nFrom HDFC Bank A/C *1234\nTo JOHN DOE\nOn 22/10/26\nRef 555555555555', ai('Transfers'));
assert.deepEqual([writes[0][2].properties.Category.select.name, writes[0][2].properties.Entry.title[0].text.content], ['Transfers', 'UPI payment']);
assert.ok(!JSON.stringify(writes).includes('JOHN')); // the name went to the model, never to Notion
// The SMS row came first as "UPI payment"; the email names the shop, which replaces it.
recent = [{ id: 'sms2', properties: { 'Ref ID': { rich_text: [{ plain_text: '559' }] }, Type: { select: { name: 'Debit' } }, Amount: { number: 895 },
  Date: { date: { start: '2026-10-24T12:14:00+05:30' } }, Payee: { rich_text: [{ plain_text: 'x@ptys' }] }, Entry: { title: [{ plain_text: 'UPI payment' }] } } }];
inbox.d = mail('d', 'Rs.895.00 is debited from your account ending 1234 towards VPA ****203n@ptys (SAMPLE GRILL) on 24-10-26.<br>UPI transaction reference no.: 559.');
writes.length = 0;
assert.equal((await save2('d')).duplicate, 1);
assert.deepEqual([writes[0][1], writes[0][2].properties.Entry.title[0].text.content], ['pages/sms2', 'Sample Grill']);
assert.equal((await handleSms(new Request('https://w.dev/', { method: 'GET' }), { SMS_TOKEN: TOKEN })).status, 404);

// Zepto: an order detail as get_order_detail returns it (23 Oct 2026, address left out), split by item.
const prod = (productName, rupees, extra = {}) => ({ productName, quantityOrdered: 1, quantityFulfilled: 1, totalFinalSellingPrice: rupees * 100, ...extra });
const detail = { id: 'o1', placedTime: '2026-10-23T11:34:34.485173Z', grandTotalAmount: 20400, formattedStatus: 'DELIVERED', shipments: [{ products: [
  prod('Milky Mist High Protein Paneer', 138), prod('Theobroma Zero Maida Multigrain Bread | No Preservatives | No Palm Oil', 66),
  prod('Out of stock thing', 50, { quantityFulfilled: 0 })] }] };
const items = zeptoItems(detail);
assert.deepEqual(items, [{ name: 'Milky Mist High Protein Paneer', price: 138 }, { name: 'Theobroma Zero Maida Multigrain Bread', price: 66 }]);
assert.deepEqual(splitParts(items, ['Fitness & Diet', 'Home'], 204).map((p) => [p.category, p.amount]), [['Fitness & Diet', 138], ['Home', 66]]);
// A ₹26 delivery fee is spread by price and the parts still add up to the payment.
const fee = splitParts(items, ['Fitness & Diet', 'Home'], 230);
assert.deepEqual(fee.map((p) => p.amount), [155.59, 74.41]);
assert.deepEqual(splitParts(items, ['Fitness & Diet', 'Fitness & Diet'], 204), [{ category: 'Fitness & Diet', amount: 204, note: 'Milky Mist High Protein Paneer, Theobroma Zero Maida Multigrain Bread'.slice(0, 80) }]);
assert.deepEqual(await itemCats({ AI: ai('1: Fitness & Diet\n2. Home (cleaning)') }, ['a', 'b', 'c']), ['Fitness & Diet', 'Home', 'Fitness & Diet']); // skipped -> Fitness & Diet
assert.equal(await itemCats({ AI: { run: async () => { throw new Error('down'); } } }, ['a']), null);

// A whole Zepto run: one unsplit ₹204 payment at 17:04 IST matches order o1 (11:34Z) and becomes two parts.
const zw = [], kv = {};
globalThis.fetch = async (url, opts = {}) => {
  const ok = (j, headers = {}) => ({ ok: true, headers: new Headers({ 'content-type': 'application/json', ...headers }), json: async () => j, text: async () => JSON.stringify(j) });
  const body = String(opts.body || '');
  if (url.includes('auth.zepto')) return ok({ access_token: 'at', refresh_token: 'r2' });
  if (url.includes('mcp.zepto')) {
    const m = JSON.parse(body);
    if (m.method !== 'tools/call') return ok({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's1' });
    assert.ok(['list_order_history', 'get_order_detail'].includes(m.params.name)); // read-only
    return ok({ jsonrpc: '2.0', id: 1, result: { structuredContent: m.params.name === 'list_order_history' ? { orders: [{ id: 'o0', grandTotalAmount: 99900 }, detail] } : detail } });
  }
  const b = JSON.parse(body);
  if (url.endsWith('/query')) return ok({ results: b.filter.and ? [{ id: 'z1', properties: { Entry: { title: [{ plain_text: 'Zepto' }] }, 'Ref ID': { rich_text: [{ plain_text: '777' }] },
    Amount: { number: 204 }, Type: { select: { name: 'Debit' } }, Status: { select: { name: 'Auto-filed' } }, Source: { select: { name: 'UPI' } },
    Date: { date: { start: '2026-10-23T17:04:00+05:30' } } } }] : [], has_more: false });
  zw.push([opts.method, url.replace('https://api.notion.com/v1/', ''), b.properties]);
  return ok({ id: 'n' });
};
const zenv = { ...env, ZEPTO_CLIENT_ID: 'c', ZEPTO_REFRESH_TOKEN: 'r1', AI: ai('1: Fitness & Diet\n2: Home'), SEEN: { get: async (k) => kv[k], put: async (k, v) => { kv[k] = v; } } };
assert.deepEqual(await splitZepto(zenv), { split: 1, waiting: 0 });
assert.equal(kv['zepto:refresh'], 'r2'); // the new refresh token is kept
const zp = zw.map(([m, u, p]) => [m, u, p.Entry.title[0].text.content, p.Amount.number, p.Category.select.name, p['Ref ID'].rich_text[0].text.content, p.Status.select.name]);
assert.deepEqual(zp, [['POST', 'pages', 'Zepto (2/2)', 66, 'Home', '777-s2', 'Confirmed'], ['PATCH', 'pages/z1', 'Zepto (1/2)', 138, 'Fitness & Diet', '777-s1', 'Confirmed']]);
assert.deepEqual(await splitZepto({}), { zepto: 'not connected' });

// Health check: silent when all is well, one line per problem otherwise.
const NOW = Date.parse('2026-10-25T03:30:00Z');
let snapDay = '2026-10-24';
let expenseRows = []; // what the Duplicates check finds in the Expense Tracker
globalThis.fetch = async (url) => {
  assert.ok((url.includes('000000000003') || url.includes('000000000001')) && url.endsWith('/query'));
  return { ok: true, json: async () => ({ results: url.includes('000000000001') ? expenseRows : [{ properties: { Date: { date: { start: snapDay } } } }] }) };
};
const hkv = { 'health:sync': String(NOW - 20 * 6e4), 'health:sms': String(NOW - 5 * 36e5) };
const hmeta = { 'backup:2026-10-25': { at: NOW - 36e5, rows: {}, errors: [] } }; // KV metadata, for list()
const henv = { ...env, AI: { run: async () => ({ response: 'OK' }) }, SEEN: { get: async (k, t) => (t === 'json' ? JSON.parse(hkv[k] ?? 'null') : hkv[k] ?? null), put: async (k, v, o) => { hkv[k] = v; if (o?.metadata) hmeta[k] = o.metadata; }, delete: async (k) => { delete hkv[k]; delete hmeta[k]; },
  list: async ({ prefix }) => ({ keys: Object.keys(hmeta).filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: hmeta[name] })) }) } };
assert.deepEqual(await health(henv, NOW), []);
// Duplicates: same ref, direction and amount, or a split part twice. A reversal and the site's "-split" parts are fine.
const xr = (ref, type, amount, date = '2026-10-20') => ({ properties: { 'Ref ID': { rich_text: [{ plain_text: ref }] }, Type: { select: { name: type } }, Amount: { number: amount }, Date: { date: { start: date } } } });
expenseRows = [xr('111', 'Debit', 30), xr('111', 'Debit', 30), xr('222', 'Debit', 65), xr('222', 'Credit', 65), xr('a-split', 'Debit', 126), xr('a-split', 'Debit', 167),
  xr('b-s2', 'Debit', 139), xr('b-s2', 'Debit', 649), xr('333', 'Debit', 1134.39), xr('333', 'Debit', 103.76)];
// The ₹514 Amazon card spend of 25 Oct 2026: the Worker's SMS row and the routine's email row, 10 s apart.
assert.deepEqual(duplicates([{ ref: 'sms-2026-10-25T18:15:38+05:30', type: 'Debit', amount: 514, date: '2026-10-25T18:15:38+05:30' },
  { ref: '1a1731885e75d0ba', type: 'Debit', amount: 514, date: '2026-10-25T12:45:48Z' }, { ref: '1a1731885e75d0bb', type: 'Debit', amount: 514, date: '2026-10-25T14:00:00Z' }]).map((r) => r.ref), ['1a1731885e75d0ba']);
assert.deepEqual(duplicates(expenseRows.map((r) => ({ ref: r.properties['Ref ID'].rich_text[0].plain_text, type: r.properties.Type.select.name, amount: r.properties.Amount.number }))).map((r) => r.ref), ['111', 'b-s2']);
assert.deepEqual(await health(henv, NOW), ['Duplicates: 2 payments are in Notion twice: ₹30 on 2026-10-20 (Ref 111), ₹649 on 2026-10-20 (Ref b-s2). The 3:30 AM fixer removes extra copies you didn’t confirm; if one stays, search its Ref ID on Transactions and delete it yourself.']);
expenseRows = [];
{ // The fixer trashes extra copies you didn't confirm, plus the routine's ₹0 "[DUPLICATE" rows whatever their status.
  const pg = (id, ref, status, amount, entry = 'UPI payment') => ({ id, properties: { 'Ref ID': { rich_text: [{ plain_text: ref }] }, Type: { select: { name: 'Debit' } },
    Status: { select: { name: status } }, Amount: { number: amount }, Date: { date: { start: '2026-10-20' } }, Entry: { title: [{ plain_text: entry }] } } });
  const rows = [pg('a1', '111', 'Confirmed', 30), pg('a2', '111', 'Needs review', 30), pg('b1', '222', 'Needs review', 65), pg('b2', '222', 'Confirmed', 65),
    pg('c1', '333', 'Confirmed', 50), pg('c2', '333', 'Auto-filed', 50),
    pg('z', '999', 'Needs review', 0, '[DUPLICATE - PLEASE DELETE] Linkway'), pg('y', '777', 'Auto-filed', 0, '[DUPLICATE - PLEASE DELETE] Blinkit'), pg('k', '888', 'Needs review', 0, 'Zero but real')];
  const calls = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === 'PATCH') calls.push([url.split('/v1/')[1], JSON.parse(opts.body)]);
    return { ok: true, json: async () => ({ results: rows }) };
  };
  assert.deepEqual(await removeDuplicates(henv, NOW), ['₹30 2026-10-20 111', '₹50 2026-10-20 333', '₹0 2026-10-20 999', '₹0 2026-10-20 777']);
  assert.deepEqual(calls, ['pages/a2', 'pages/c2', 'pages/z', 'pages/y'].map((p) => [p, { in_trash: true }])); // b2 is confirmed: kept
  globalThis.fetch = realFetch;
}
delete hkv['health:sms'];
assert.deepEqual(await health(henv, NOW), []); // never seen an SMS yet: no alarm, counting starts now
assert.equal(hkv['health:sms'], String(NOW));
Object.assign(hkv, { 'health:sync': String(NOW - 5 * 36e5), 'health:error': 'Google token 400: invalid_grant', 'health:sms': String(NOW - 4 * 864e5) });
snapDay = '2026-10-20';
const hp = await health({ ...henv, AI: { run: async () => { throw new Error('5028: model was deprecated'); } } }, NOW);
assert.equal(hp.length, 4);
assert.match(hp[0], /^Bank sync: not working for 5 hours \(Google token 400: invalid_grant\)/);
assert.match(hp[1], /^iPhone SMS: no HDFC SMS has arrived for 4 days/);
assert.match(hp[2], /^AI: 5028: model was deprecated/);
assert.match(hp[3], /^Nightly snapshot: none since 2026-10-20/);
const hget = (token) => handleSms(new Request('https://w.dev/health', { headers: token ? { 'X-Sync-Token': token } : {} }), { ...henv, SMS_TOKEN: TOKEN });
assert.equal((await hget()).status, 401);
const HT = 'h'.repeat(64);
assert.equal((await handleSms(new Request('https://w.dev/health', { headers: { 'X-Sync-Token': HT } }), { ...henv, SMS_TOKEN: TOKEN, HEALTH_TOKEN: HT })).status, 200); // the health key opens /health
assert.equal((await handleSms(new Request('https://w.dev/sms', { method: 'POST', headers: { 'X-Sync-Token': HT }, body: '{}' }), { ...henv, SMS_TOKEN: TOKEN, HEALTH_TOKEN: HT })).status, 401); // ...and nothing else
assert.match(await (await hget(TOKEN)).text(), /^Bank sync: not working.*\n\niPhone SMS:/s);
assert.match(await (await hget(TOKEN)).text(), /^Bank sync/); // kept for an hour: no second check
Object.assign(hkv, { 'health:sync': String(Date.now()), 'health:sms': String(Date.now()) }); snapDay = new Date().toISOString().slice(0, 10);
hmeta['backup:2026-10-25'].at = Date.now(); // a fresh backup, or this check goes stale 8 days after 25 Oct
delete hkv['health:last'];
const hok = await hget(TOKEN);
assert.deepEqual([hok.status, await hok.text()], [204, '']);

// Page errors: only the site's key may report; they show in health for a day, then drop out.
const SK = 's'.repeat(64);
const rep = (key, body) => handleSms(new Request('https://w.dev/report', { method: 'POST', headers: { 'X-Sync-Token': key }, body: JSON.stringify(body) }), { ...henv, SITE_HEALTH_TOKEN: SK, HEALTH_TOKEN: HT });
assert.equal((await rep(HT, { msg: 'x' })).status, 401); // the iPhone's key can't
assert.equal((await rep(SK, {})).status, 400);
hkv['health:last'] = '{"at":1,"problems":[]}';
assert.equal((await rep(SK, { msg: "Cannot read properties of undefined (reading 'amount')", where: 'app.js:812', page: 'transactions', v: '47' })).status, 200);
assert.equal(hkv['health:last'], undefined); // next health answer is fresh
assert.ok((await health(henv)).includes(`Site: 1 page error in the last day. Latest: "Cannot read properties of undefined (reading 'amount')" on transactions (v47), app.js:812. Tell Claude.`));
assert.ok(!(await health(henv, Date.now() + 2 * 864e5)).some((p) => p.startsWith('Site')));

// Weekly backup: every table as plain rows, unreadable tables named, only the newest 8 kept; health warns when stale.
assert.deepEqual(plainRow({ id: 'p1', properties: { Entry: { type: 'title', title: [{ plain_text: 'Zepto' }] }, Amount: { type: 'number', number: 204 },
  Category: { type: 'select', select: { name: 'Fitness & Diet' } }, Date: { type: 'date', date: { start: '2026-10-23', end: null } }, Total: { type: 'formula', formula: { number: 1 } } } }),
  { id: 'p1', Entry: 'Zepto', Amount: 204, Category: 'Fitness & Diet', Date: '2026-10-23' });
for (let d = 1; d <= 8; d++) hmeta[`backup:2026-08-0${d}`] = { at: 1, errors: [] };
globalThis.fetch = async (url, opts = {}) => {
  if (url.includes('000000000007')) return { ok: false, status: 404, text: async () => 'not shared' };
  const page = JSON.parse(opts.body).start_cursor ? 2 : 1;
  const row = (n) => ({ id: `r${n}`, properties: { Name: { type: 'title', title: [{ plain_text: `row ${n}` }] } } });
  return { ok: true, json: async () => ({ results: page === 1 ? [row(1), row(2)] : [row(3)], has_more: page === 1 && url.includes('000000000001'), next_cursor: 'c2' }) };
};
const b = await backup(henv, Date.parse('2026-10-31T21:30:00Z'));
assert.deepEqual([b.key, b.rows['Expense Tracker'], b.rows.Budgets, b.errors, b.removed], ['backup:2026-11-01', 3, 2, ['Wishlist'], 2]);
assert.equal(JSON.parse(hkv['backup:2026-11-01']).tables['Expense Tracker'][2].Name, 'row 3');
assert.equal(Object.keys(hmeta).filter((k) => k.startsWith('backup:')).length, 8);
const hb = await health(henv, Date.parse('2026-11-01T03:30:00Z'));
assert.ok(hb.some((p) => p.startsWith("Backup: the 2026-11-01 backup couldn't read Wishlist")));
assert.ok((await health(henv, Date.parse('2026-11-12T03:30:00Z'))).some((p) => p.startsWith('Backup: no weekly Notion backup since 2026-11-01')));

// Snapshot safety net: last known Binance holdings at today's prices, only on a day the routine didn't write.
const H = 'Binance | USDT | Stablecoin | 5231.39739393 | 496143.03 |\nBinance | BTC | Crypto | 0.00144855 | 11141.77 | 124.761451 USDT';
const rv = revalue(H, { BTC: 100000 }, 95);
assert.equal(rv.text, 'Binance | USDT | Stablecoin | 5231.39739393 | 496982.75 |\nBinance | BTC | Crypto | 0.00144855 | 13761.23 | 124.761451 USDT');
assert.equal(rv.total, 510743.98);
assert.throws(() => revalue(H, {}, 95), /no price for BTC/);
assert.deepEqual([istDay('2026-10-23'), istDay('2026-10-24T22:48:42Z'), istDay('')], ['2026-10-23', '2026-10-25', '']);
const snapPage = (id, start, extra = {}) => ({ id, properties: { Date: { date: { start } }, Holdings: { rich_text: extra.h ? [{ plain_text: extra.h }] : [] },
  Investments: { number: extra.inv ?? null }, Insights: { rich_text: extra.ins ? [{ plain_text: extra.ins }] : [] } } });
let snapRows, sw = [];
globalThis.fetch = async (url, opts = {}) => {
  const ok = (j) => ({ ok: true, json: async () => j });
  if (url.includes('kucoin')) return ok({ data: { ticker: [{ symbol: 'BTC-USDT', last: '100000' }, { symbol: 'BTC-USDC', last: '1' }] } });
  if (url.includes('coinbase')) return ok({ data: { amount: '95' } });
  if (url.endsWith('/query')) return ok({ results: snapRows });
  sw.push([opts.method || 'POST', url.replace('https://api.notion.com/v1/', ''), JSON.parse(opts.body).properties]);
  return ok({ id: 'n' });
};
const NIGHT = Date.parse('2026-10-25T23:30:00Z'); // 05:00 IST on 26 Oct: the routine's day is the 25th (its UTC date)
snapRows = [snapPage('s25', '2026-10-25', { h: H, inv: 2900 })];
assert.deepEqual(await fillSnapshot(env, NIGHT), { day: '2026-10-25', skipped: 'the routine wrote it' });
snapRows = [snapPage('s24', '2026-10-24T10:18:00Z'), snapPage('s23', '2026-10-23', { h: H, inv: 2838.8 })]; // routine missed the 25th
assert.deepEqual(await fillSnapshot(env, NIGHT), { day: '2026-10-25', filled: true, binance: 510743.98, from: '2026-10-23' });
assert.deepEqual([sw[0][0], sw[0][1], sw[0][2].Snapshot.title[0].text.content, sw[0][2].Date.date.start, sw[0][2].Binance.number, sw[0][2].Investments.number, sw[0][2]['Bank balance']],
  ['POST', 'pages', '25 Oct 2026', '2026-10-25', 510743.98, 2838.8, undefined]);
assert.match(sw[0][2].Insights.rich_text[0].text.content, /^Worker: /);
sw = []; snapRows = [snapPage('s25b', '2026-10-25T19:10:00+05:30'), snapPage('s23', '2026-10-23', { h: H })]; // an SMS balance made the day's row
await fillSnapshot(env, NIGHT);
assert.deepEqual([sw[0][0], sw[0][1], 'Bank balance' in sw[0][2], 'Investments' in sw[0][2]], ['PATCH', 'pages/s25b', false, false]);
// Health: two Worker-filled nights in a row means the routine is missing.
globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [snapPage('a', '2026-10-25', { h: H, ins: 'Worker: x' }), snapPage('b', '2026-10-24', { h: H, ins: 'Worker: y' }), snapPage('c', '2026-10-23', { h: H })] }) });
assert.ok((await health(henv, Date.parse('2026-10-25T03:30:00Z'))).some((p) => p.startsWith('Nightly snapshot: the Claude "HDFC Daily Sync" routine has missed the last 2 nights')));

// Order screenshot: the AI's list is read, the waiting Blinkit payment of that total is split by item.
assert.deepEqual(readOrderReply('Amul Taaza Milk 500 ml | 33\n2. Surf Excel Matic 1 L | ₹ 1,079\nTOTAL | 1,112\nnot a line'),
  { items: [{ name: 'Amul Taaza Milk 500 ml', price: 33 }, { name: 'Surf Excel Matic 1 L', price: 1079 }], total: 1112 });
const oAI = { run: async (_m, { messages }) => ({ response: /screenshot/.test(messages[0].content) ? 'Amul Milk | 33\nSurf Excel | 1079\nTOTAL | 1112' : '1: Fitness & Diet\n2: Home' }) };
const ow = [];
let onlyPeople = false; // the 'nothing to split' case
globalThis.fetch = async (url, opts = {}) => {
  const ok = (j) => ({ ok: true, json: async () => j });
  const b = JSON.parse(opts.body || '{}');
  if (url.endsWith('/query')) return ok({ results: b.filter?.and ? [
    ...(onlyPeople ? [] : [{ id: 'bk1', properties: { Entry: { title: [{ plain_text: 'Blinkit' }] }, 'Ref ID': { rich_text: [{ plain_text: '901' }] }, Amount: { number: 1112 }, Type: { select: { name: 'Debit' } },
      Status: { select: { name: 'Auto-filed' } }, Source: { select: { name: 'UPI' } }, Date: { date: { start: '2026-10-21T19:49:00+05:30' } } } }]),
    { id: 'p2', properties: { Entry: { title: [{ plain_text: 'UPI payment' }] }, 'Ref ID': { rich_text: [{ plain_text: '902' }] }, Amount: { number: 1112 }, Type: { select: { name: 'Debit' } },
      Status: { select: { name: 'Needs review' } }, Date: { date: { start: '2026-10-22T10:00:00+05:30' } } } }] : [], has_more: false });
  ow.push([opts.method || 'POST', url.replace('https://api.notion.com/v1/', ''), b.properties]);
  return ok({ id: 'n' });
};
const oenv = { ...env, AI: oAI };
assert.equal(await splitOrder(oenv, 'blinkit order text', Date.parse('2026-10-25T10:00:00Z')), 'Blinkit ₹1112 split: Home ₹1079, Fitness & Diet ₹33.');
assert.deepEqual(ow.map(([m, u, p]) => [m, u, p.Entry.title[0].text.content, p.Amount.number, p.Category.select.name, p.Payee.rich_text[0].text.content]),
  [['POST', 'pages', 'Blinkit (2/2)', 33, 'Fitness & Diet', 'Blinkit'], ['PATCH', 'pages/bk1', 'Blinkit (1/2)', 1079, 'Home', 'Blinkit']]);
onlyPeople = true;
assert.match(await splitOrder(oenv, 'x'), /^No shop payment of ₹1112/); // a payment to a person of the same amount never matches
assert.match(await splitOrder({ ...env, AI: { run: async () => ({ response: 'nothing useful' }) } }, 'x'), /^Couldn't find the items/);
const OK = 'o'.repeat(64);
assert.equal((await handleSms(new Request('https://w.dev/order', { method: 'POST', headers: { 'X-Sync-Token': TOKEN }, body: '{}' }), { ...oenv, SMS_TOKEN: TOKEN, ORDER_TOKEN: OK })).status, 401); // the SMS key can't

// Nightly fixer: Haiku sees the owner's filed payments as examples, and only the rows it is sure of become Auto-filed.
const fw = [];
let fixAsk;
const page = (id, entry, payee, amount, category, status, note = '') => ({ id, properties: { Entry: { title: [{ plain_text: entry }] }, Payee: { rich_text: [{ plain_text: payee }] },
  Amount: { number: amount }, Type: { select: { name: 'Debit' } }, Category: { select: { name: category } }, Status: { select: { name: status } },
  Note: { rich_text: [{ plain_text: note }] }, 'Ref ID': { rich_text: [] }, Date: { date: { start: '2026-10-27T09:10:00+05:30' } } } });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const b = JSON.parse(opts.body || '{}');
  if (url.startsWith('https://api.anthropic.com/v1/messages')) {
    fixAsk = b;
    const items = [{ n: 1, category: 'Transport', sure: true, why: 'same handle filed as Transport' }, { n: 2, category: 'Personal Expense', sure: false, why: 'unclear' }];
    return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ items }) }], usage: { input_tokens: 900, output_tokens: 120 } }), { headers: { 'content-type': 'application/json' } });
  }
  if (url.endsWith('/query')) {
    const status = b.filter.and[0].select.equals;
    return Response.json({ has_more: false, results: status === 'Confirmed' ? [page('c1', 'UPI payment', 'ab1@okaxis', 30, 'Transport', 'Confirmed')]
      : [page('u1', 'UPI payment', 'ab1@okaxis', 30, 'Personal Expense', 'Needs review'), page('u2', 'UPI payment', 'zz9@ybl', 450, 'Personal Expense', 'Needs review'),
        page('u3', 'AMAZONIN', 'AMAZONIN', 999, 'Personal Expense', 'Needs review'), page('u4', 'UPI payment', 'q@ok', 500, 'Transfers', 'Needs review', 'paid to a person')] });
  }
  fw.push([opts.method, url.replace('https://api.notion.com/v1/', ''), b.properties]);
  return Response.json({ id: 'n' });
};
assert.deepEqual(await fixUnsorted({ ...env }), { skipped: 'no ANTHROPIC_API_KEY' });
assert.deepEqual(await fixUnsorted({ ...env, ANTHROPIC_API_KEY: 'test-key' }), { filed: 1, left: 1, tokens: 1020 });
assert.equal(fixAsk.model, 'claude-haiku-5-5');
assert.match(fixAsk.messages[0].content, /UPI payment \| ab1@okaxis \| ₹30 \| Transport/); // the example
assert.ok(!fixAsk.messages[0].content.includes('AMAZONIN') && !fixAsk.messages[0].content.includes('q@ok')); // mixed order and Transfers stay out
assert.deepEqual(fw, [['PATCH', 'pages/u1', { Category: { select: { name: 'Transport' } }, Status: { select: { name: 'Auto-filed' } },
  Note: { rich_text: [{ text: { content: 'Claude: same handle filed as Transport' } }] } }]]); // u2 wasn't sure: left alone

console.log('sync-worker: all checks passed');
