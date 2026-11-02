# hdfc-sync (Cloudflare Worker)

Adds HDFC Bank transactions to the Notion Expense Tracker every 15 minutes, with no AI involved, so nothing
is missed when the Claude plan hits its weekly limit (the routine runs on 19 and 20 Oct 2026 were skipped that way).

## What it does each run
1. Reads `alerts@hdfcbank.bank.in` / `alerts@hdfcbank.net` emails from the last 3 days through the Gmail API
   (read-only). Message ids it has already handled are kept in KV (`SEEN`), so it only opens new emails.
2. Parses them with regexes (`index.js`, `parseAlert`): UPI debits and credits, debit card spends and refunds,
   IMPS/NEFT transfers out, deposits. Dates carry `+05:30`. UPI alerts have no time, so the email's time is used.
   E-mandate notices, "added to ME DC SI", forex markup fees and declines are skipped (the card alert already
   reports the charge). An alert that says money moved but matches no known wording becomes a "Needs review" row
   ("alert format not recognised") instead of being lost.
3. Skips Ref IDs Notion already has (including split parts `-s1`, `-s2`, and the site's `-split`). Ref ID is the
   UPI or IMPS reference, else the Gmail message id, exactly as the Claude routines do, so they never double up.
4. Picks the category with the rules from `hourly-sync-instructions.txt`, then the "learned" rule: 2+ Confirmed
   rows with the same Payee and Type, all one category, win. Money to or from a person (a UPI handle that isn't a
   shop) is Transfers, Needs review: never spending, never income. A credit from the handle of an earlier debit, same
   amount within ₹1, up to 45 days later, is a repayment: the credit is Transfers, Confirmed, "paid back" (or the
   debit's own spending category if that was confirmed, e.g. a friend's share of dinner), and a debit still waiting
   for review becomes Transfers, Confirmed, "lent, paid back". Anything unsure is "Needs review"; the site's model
   can auto-file it, and `lending()` in app.js pairs repayments again on load as a backup.
   A payment still "Needs review" after that (a name no rule knows, like "SAMPLE CHAAT CORNER") gets a category
   guess from Workers AI (`aiGuess`, Llama 3.3 70B (`AI_MODEL`; 3.1 8B was retired 30 May 2026) on Cloudflare's free daily allowance, no Claude): note "AI guess",
   still Needs review, shown first on the site's review card. The name is sent to the model but never stored; if
   the model thinks it's a person, nothing changes. Chaat and pani puri stalls are Foods & Drinks, Fitness & Diet is groceries for home; 10 of 10 example names were right on 22 Oct 2026.
5. Payee is a merchant name or the UPI handle, never a person's name. A display name counts as a merchant when it
   is a known shop, says LLP, Ltd, Store, Hotel, Cafe ..., is paid to a handle only businesses get (`MERCHANT_VPA`:
   @ptys, @okbizaxis, PayU, Razorpay, BillDesk `bdpg`, BharatPe ..., still readable after HDFC masks the handle), or
   Workers AI calls it a business. Then the row is named after the shop ("Sample Grill", not "UPI payment") and
   learns by that name. If the SMS came first without the name, the email renames it. Deposit references drop the sender's name.

Bank balance is only ever the bank's own "available balance" from an SMS or email, written as a checked
balance (see SMS below); it never keeps a running total. Shopping payments (Amazon, Instamart, Flipkart, ...) are created as
"Needs review, mixed order, split pending"; the daily Claude run splits them by order email. Blinkit and Zepto send no
item email, so theirs are "Auto-filed" at once under the category you filed their orders under most (else Fitness & Diet); change
one on the site if a basket was mostly something else.

Limits: at most 10 new emails per run (the free plan allows 50 outbound requests per run); the rest come next
run. If Notion or Gmail fails, nothing is marked handled and the next run retries.

## One-time setup (you do this; Claude never sees these values)

### 1. Google OAuth client (Gmail read-only)
1. https://console.cloud.google.com → project picker → **New project** `expense-sync` → Create, and select it.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **Google Auth Platform → Branding** (or "OAuth consent screen") → Get started: app name `expense-sync`,
   your email for support and contact, Audience **External** → Create.
4. **Audience** → **Publish app** → Confirm. (Leaving it in "Testing" makes the token expire after 7 days.
   It stays unverified, which is fine for your own account; you'll see a warning screen once.)
5. **Clients → Create client** → Application type **Web application**, name `expense-sync`.
   Under **Authorized redirect URIs** add `https://developers.google.com/oauthplayground` → Create.
   Keep the **Client ID** and **Client secret** open.
6. Open https://developers.google.com/oauthplayground → gear icon (top right) → tick
   **Use your own OAuth credentials** → paste the Client ID and secret → Close.
7. Left side, "Input your own scopes": `https://www.googleapis.com/auth/gmail.readonly` → **Authorize APIs** →
   pick your Gmail → "Google hasn't verified this app" → **Advanced → Go to expense-sync** → Continue.
8. **Exchange authorization code for tokens** → copy the **Refresh token** (starts with `1//`).

### 2. Cloudflare
In this folder (`sync-worker/`), in your own terminal:

```bash
npm install
npx wrangler login
npx wrangler kv namespace create SEEN
```
(Already done for this repo: the id is in `wrangler.toml`.) Then set the four secrets. Each command asks
for the value; paste it and press Enter:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put NOTION_TOKEN
```
(`SMS_TOKEN` is the fifth secret, made in the SMS section below.)
`NOTION_TOKEN` is the same "expense-site" integration secret the site uses (notion.so/profile/integrations →
expense-site → Internal Integration Secret → Show).

Then `npm run deploy` (tests first, then `wrangler deploy`). It runs at :00, :15, :30, :45.

## Zepto orders (split by item)

Zepto sends no item email, so the Worker reads your orders through Zepto's own MCP (`mcp.zepto.co.in`, read-only use:
only `list_order_history` and `get_order_detail`). A second cron, at :05 and :35, looks for Zepto payments from the last
15 days that aren't split yet (Entry "Zepto", Status not Confirmed), matches each to an order by total (within ₹1) and
time (within 6 hours), sorts the items with Workers AI (Fitness & Diet, Foods & Drinks, Home, Personal Expense) and splits the row:
"Zepto (1/2)", "Zepto (2/2)", Ref ID `-s1`, `-s2`, Status Confirmed, fees spread by price. Until it's split, a Zepto
payment is Auto-filed like Blinkit's. Logs: `zepto-split {"split":1,"waiting":0}`.

Login, once (it was done on 24 Oct 2026): in this folder run `node zepto-login.mjs`. It opens Zepto's login page; sign in
with your phone and OTP. It saves `ZEPTO_CLIENT_ID` and `ZEPTO_REFRESH_TOKEN` to the Worker without printing them (later
refresh tokens are kept in KV, `zepto:refresh`), and writes the tool list and your latest orders to `zepto-*.json` here
(git-ignored). If the log says `zepto login: ... run zepto-login.mjs again`, do exactly that.

## Phone alerts (daily health check)

`GET /health` checks: page errors on the site in the last day, the weekly Notion backup, payments in Notion twice
in the last 45 days (same Ref ID, direction and amount, or a split part twice; `duplicates`), the 15-minute bank sync last worked under 2 hours ago (Gmail + Notion), an HDFC SMS arrived in
the last 3 days (the iPhone automation), Workers AI answers (`AI_MODEL`), the Zepto login still refreshes, and the
nightly Claude snapshot is under 2 days old. All well: an empty 204. Otherwise one paragraph per problem with what to do.
It needs `X-Sync-Token`: the SMS token, or `HEALTH_TOKEN` (the iPhone shortcut) or `SITE_HEALTH_TOKEN` (the site's
banner, Pages secret `HEALTH_TOKEN`), which open only `/health`. `SITE_HEALTH_TOKEN` also opens `POST /report`: errors
the site's pages hit (reporter at the top of index.html → functions/api/report.js) are kept in KV `site:errors` (last 20)
and raised by the "Site" check for a day. The answer is kept in KV (`health:last`) for an hour.

On the iPhone (set up 25 Oct 2026): the shortcut **Finance Health Check** fetches `/health` with `HEALTH_TOKEN` and,
"If Contents of URL has any value", shows a "Finance needs a look" notification with the text. The automation **Daily
Finance Check** runs it at 09:00 every day. Quiet when all is well. If the Worker can't be reached at all, iOS shows its
own "problem running the shortcut" notification. To test: run Finance Health Check in Shortcuts; nothing happens when
healthy. To force an alert, set KV `health:sms` to a time 4 days ago and delete `health:last`, run it, then put it back.

A push from the Worker isn't used: ntfy.sh limits free senders per IP, and Cloudflare's shared IPs use the quota up
(429 "daily message quota reached", 25 Oct 2026).
## Snapshot safety net (nightly)

The nightly Claude routine writes each day's Daily Snapshots row (Binance quantities and costs, INDmoney). When the
Claude plan's limit skips it, the net worth chart got holes (18, 19 and 20 Oct 2026). At 05:00 IST (cron `30 23 * * *`,
an hour after the routine) `fillSnapshot` checks the routine's day (it names rows by the UTC date) and, only if that row
has no Holdings, writes one: the last known Binance holdings revalued at Binance's public USDT prices times Coinbase's
USDT to INR (the routine's own pricing), INDmoney carried over, Insights starting "Worker:". It never writes Bank balance.
The health check warns once two nights in a row were filled this way, since quantities and INDmoney then go stale.
Log line: `snapshot {...}`.

## Backup (weekly, Notion)

Every Saturday night (cron `30 21 * * 6`, Sunday 03:00 IST) the Worker reads every table the site uses (Expense
Tracker, Daily Snapshots, Subscriptions, Budgets, Savings Goals, Holdings Snapshots, Wishlist) and saves the rows as
plain JSON in KV under `backup:<date>`. The newest 8 are kept. The first one, 25 Oct 2026, was 411 KB with 881 expense
rows. The health check warns when the newest backup is over 8 days old or a table couldn't be read. Log line: `backup {...}`.
KV, not R2, because R2 needs a card on the account. One run reads up to about 4,000 expense rows; past that, split it.

To restore, in this folder:
```bash
npx wrangler kv key list --binding SEEN --remote --prefix backup:
```
```bash
npx wrangler kv key get --binding SEEN --remote backup:2026-10-25 > backup.json
```
`backup.json` holds `tables["Expense Tracker"]` and the others as rows of plain values ("Category": "Fitness & Diet", "Date":
"2026-10-23T11:34:00.000+05:30"), each with its Notion page `id`. Give it to Claude to put lost or changed rows back;
deleted pages can also come back from Notion's own Trash for 30 days.

## SMS from the iPhone (second source, and the bank balance)

The Worker also takes HDFC SMS at `POST https://hdfc-sync.<your-subdomain>.workers.dev/sms` (the address
`npx wrangler deploy` prints). An iPhone Shortcuts automation sends every HDFC SMS there the moment it arrives, so
transactions show up within seconds even if the email is late. The SMS and the email dedupe against each other: by
the shared UPI / IMPS reference, or for card spends and deposits (no shared reference) by same type and amount
within 30 minutes. An SMS to a person names them rather than their UPI handle, so its row starts with no Payee; the
email that follows fills it in. When the SMS carries "Avl Bal", that figure becomes today's **Bank balance** on Daily Snapshots
with **Balance checked** ticked (one row per day, updated in place, never moved back to an older figure), so the
site's balance stays exact without you typing it. IMPS and deposit emails carry the same figure and do the same.

Every other path on that address answers 404, and `/sms` answers 401 without the token.

### 1. Make the token (Mac terminal, in `sync-worker/`)
```bash
openssl rand -hex 32 | pbcopy
```
```bash
npx wrangler secret put SMS_TOKEN
```
Paste with Cmd+V when it asks. The token stays on your clipboard; with Handoff on, your iPhone can paste it too
(otherwise put it in a note for a minute, then delete the note). Then `npx wrangler deploy` and note the
`https://hdfc-sync....workers.dev` address it prints.

Check it from the Mac (sends an OTP-style text, which is accepted and ignored, so nothing is written):
```bash
curl -s https://hdfc-sync.YOUR-SUBDOMAIN.workers.dev/sms -H "X-Sync-Token: $(pbpaste)" -H 'Content-Type: application/json' -d '{"text":"Your OTP is 123456 for HDFC Bank","sender":"AX-HDFCBK"}'
```
It should print `{"ok":true,"result":"ignored"}`. `Unauthorized` means the token doesn't match.

### 2. The automation (iPhone, Shortcuts app)
1. **Automation** tab → **+** → **Message**.
2. **Message Contains**: `HDFC`. Leave Sender empty (HDFC sends from several IDs: AX-HDFCBK, VM-HDFCBK, JD-HDFCBK ...;
   the Worker checks the sender and text itself).
3. Choose **Run Immediately** (turn **Notify When Run** off if you like) → **Next** → **New Blank Automation**.
4. Add the action **Get Contents of URL**. Set the URL to `https://hdfc-sync.YOUR-SUBDOMAIN.workers.dev/sms`.
5. Tap the **>** on the action to show more:
   - **Method**: POST
   - **Headers** → Add new header: key `X-Sync-Token`, value: paste the token.
   - **Request Body**: JSON. Add three Text fields:
     - `text` → tap the value, choose the variable **Shortcut Input**, then tap it and pick **Content**.
     - `sender` → **Shortcut Input** again, pick **Sender**.
     - `receivedAt` → choose **Current Date**, tap it, Date Format **ISO 8601**, Include ISO 8601 Time on.
6. **Done**.

The next HDFC SMS should appear in Notion within a few seconds; the Worker logs `hdfc-sms added` (or `already in
Notion` when the email beat it). SMS wording the parser can't read is answered `ignored`, so nothing breaks on the
phone. If you see a transaction SMS that never arrives in Notion, paste it (names removed) into `test.mjs` and fix
`parseSms`.

## Checking it
- `npm run logs` (live) or Cloudflare dashboard → Workers → hdfc-sync → Logs. Each run logs one line:
  `hdfc-sync {"emails":2,"added":1,"review":0,"duplicate":1,"ignored":0}`.
- A run that fails (expired Google token, Notion down) shows as an error there; nothing is lost, the 3-day
  window catches up once it is fixed. If Google says `invalid_grant`, redo steps 6 to 8 and
  `npx wrangler secret put GOOGLE_REFRESH_TOKEN`.
- `npm test` checks the parser against the real alert wording (names and refs replaced) and a full mocked run.

## When HDFC changes a template
Rows with Note "alert format not recognised" mean a new wording. Add a regex to `parseAlert` and a case to
`test.mjs`, then `npm test && npx wrangler deploy`.
