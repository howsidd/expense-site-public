# ₹ Dashboard

Personal finance dashboard on Cloudflare Pages, with Notion as the database. Built for one person's HDFC Bank
account, so the SMS/email parsers in `sync-worker/` expect HDFC's alert formats; other banks need their own regexes.

## Use it yourself
1. Fork this repo and connect it to Cloudflare Pages (build command `npm test`, output directory `/`).
2. Make the Notion tables listed under "Notion tables used", share them with a Notion connection, and put their
   data source IDs in place of the `00000000-...` placeholders in `functions/api/*.js` and `sync-worker/index.js`
   (or set the `NOTION_*_DS` variables below).
3. Pages secrets: `NOTION_TOKEN`, `SITE_PASSWORD`, optionally `SITE_URL` (your custom domain), and `WORKER_URL` +
   `HEALTH_TOKEN` once the Worker runs (e.g. `https://hdfc-sync.YOUR-SUBDOMAIN.workers.dev`).
4. Optional bank sync: `sync-worker/README.md` (set your KV namespace id in `sync-worker/wrangler.toml`).

All numbers, names and account digits in the tests are made up.

## Files
- `index.html`  page shell and styles (plain HTML/CSS, no framework)
- `app.js`      the whole app: Overview, Transactions, Investments, Goals, popups, charts
- `functions/api/data.js`    reads Notion (transactions from the last 13 months only, so it stays fast)
- `functions/api/update.js`  every write: edit, split, add transaction, bulk edit, budgets, goals, add money, snapshots

Motion (top of app.js, no library): Web Animations on transform and opacity only, so nothing re-lays out mid-flight.
Pages rise in (below the fold as you scroll), bars and charts grow in, rows glide when one is filed or filtered out,
changed numbers slide up, popups zoom and drawers slide (both are sheets from below on a phone), and the tab pill
slides. Data that arrives in the background waits for the entrance to finish; taps render at once. It respects
"reduce motion". Every chart shows its values under the cursor, or on tap on a phone.


## Setup
- Login: `functions/_middleware.js` locks every page, script and /api/* behind one password, the `SITE_PASSWORD`
  secret (Pages → expense-site → Settings → Variables and Secrets, then redeploy). No secret = open site. A correct
  password gives a 30-day signed cookie; changing the password signs every device out; the lock icon (/logout) signs out.
- `HEALTH_TOKEN` (secret): lets `functions/api/health.js` ask the hdfc-sync Worker's `/health`. Anything it reports
  shows as a yellow "... needs a look" banner under every page's title (`healthBanner` in app.js), checked on load and on Refresh. JavaScript errors on any page are reported there too (top of index.html → `functions/api/report.js`).
- Env var `NOTION_TOKEN` (the "expense-site" Notion connection). Optional overrides: `NOTION_EXPENSES_DS`,
  `NOTION_SUBS_DS`, `NOTION_SNAPSHOTS_DS`, `NOTION_BUDGETS_DS`, `NOTION_GOALS_DS`, `NOTION_HOLDINGS_DS`, `NOTION_NEWS_DS`, `NOTION_WISHLIST_DS`.
- Live Binance amounts: secrets `BINANCE_API_KEY` and `BINANCE_API_SECRET`, a READ-ONLY Binance API key
  (`functions/api/binance.js`: Spot, Funding and Simple Earn). Without them the page uses the nightly snapshot.
  A coin you bought more of shows no gain until that night's snapshot records its new cost.
- Every Notion table must be shared with that connection (open it, ••• → Connections). Unshared tables show up
  as `warnings` at /api/data.
- Deploy: connect your fork to Cloudflare Pages; every push to `main` deploys. Its build command is `npm test`
  (both test suites: `model.test.mjs` and `sync-worker/test.mjs`), so a failing test stops the deploy and the site stays
  on the last good version (proved 25 Oct 2026 with a throwaway branch). Bump `app.js?v=` and the `vN` label in index.html
  with every app.js change, or browsers keep the old file. The Worker deploys with `npm run deploy` in sync-worker/, which
  runs its tests first.

## Notion tables used
- Expense Tracker: transactions. Categories: Subscription, Business, Personal Expense, Home, Fitness & Diet, Transport,
  Foods & Drinks, In Cash, Sweety, Savings, Investing & Trading, Income, Transfers.
  Investing & Trading, Income, Savings and Transfers never count as spending. Spending still waiting for review shows as
  grey "Unsorted" (tally in app.js), not as its guessed category, so category budgets only hold what you've filed; it stays
  in the month's total because the money is gone either way. Tapping Unsorted opens the To review list. Transfers is shown as "Exchange" on the
  site (`catName`): mostly cash swaps with friends and family (UPI for cash), sometimes paying someone back. The stored
  name stays Transfers because the Worker and the routines write it. There is no "who owes you" card any more: with
  swaps it was always wrong (removed 24 Oct 2026, when nothing was owed). In Cash always counts (even with
  "Exclude from spend" ticked), because cash isn't part of the bank balance. A confirmed credit filed under a
  spending category (a friend paying you back for dinner) lowers that category. Tiny round trips (₹1 sent and
  returned within an hour, same person) are hidden.
- Daily Snapshots: Bank balance, Investments, plus Binance, Coinbase, INDmoney (₹) and Holdings.
  Holdings is one line per holding: `platform | asset | type | quantity | value in ₹ | invested ₹ (optional)`.
  The site revalues crypto rows at live Coinbase prices in the browser.
- Subscriptions: Name, Amount, Next due, Status (Active, Watch, Ending, Cancelled), Billing day, Cycle (Monthly or
  Yearly) and Paid via (App Store, Google Pay, HDFC Card, Manual). The first Paid via in that order is where to cancel.
  The site rolls Next due forward a cycle at a time, since App Store and Google Pay charges rarely name the service.
- Wishlist (Goals page): Item, Price, Priority (Need or Want), By, Note, Bought, Bought on. Big things to buy
  later; ticking Bought only marks it (no transaction). "Save for it" opens Add goal filled in from the item.
  Photo (Files column): the browser crops it to a square and sends a 600px JPEG; update.js uploads it through
  Notion's file upload API. Notion's file links expire after an hour, so a photo that fails to load falls back to the icon.
  Items show as photo cards; the card colour (Color column) is the photo's bottom third, darkened, worked out when cropping.
- Bank payments (a bank Ref ID, not "manual-") keep the bank's amount: the edit popup shows it locked and
  `functions/api/update.js` refuses a changed amount, and a split's parts must add up to the payment (checked on the
  server too). Category, note and the rest stay editable; cash and manual rows stay fully editable. Notion keeps page history.
- Blinkit (or any shop payment not yet split): iPhone shortcut "Split order", Share a screenshot of the order. The phone
  reads the text (Live Text), the Worker's `/order` lists the items with Workers AI, finds the unsplit shop payment of that
  total from the last 7 days and splits it like Zepto; the answer comes back as a notification.
- Budgets, Savings Goals: as before. "Add money" on a goal also logs a Savings transaction
  with the note `Goal: <name>`, which is where goal history comes from.

Coinbase is being closed (CLOSED in app.js), so it's left out of every total, chart and snapshot.
The Investments page's "Cost known" and "Profit / loss" cards say how many holdings they cover and what those are worth
now (most holdings have no recorded cost, and USDT is cash). Gain is only shown against a real cost: INDmoney reports its own; a Binance coin's Holdings line ends with the cost of
its trades as "<n> USDT" (from Binance trade history). USDT has no gain. Binance coins are priced from Binance's public
USDT prices times Coinbase's USDT→INR rate (Coinbase's own INR prices for small coins were wrong). The old
"balance change since the first snapshot" gain was dropped: it counted money moved in as profit.
The Investments page has a $ / ₹ switch (Coinbase USD→INR), remembered per browser.
Hide numbers draws every amount as ₹**** rather than blurring it.
Insights (Overview) are worked out on the page from the same numbers as the rest of it: budget pace, the category most
over budget, what's still Unsorted, this month against the same days of last month, a category well above its usual
month. The nightly routine's Insights text in Daily Snapshots is no longer shown.
The review tab learns: a naive Bayes model in app.js (`trainModel`) trains on every transaction you confirmed (payee, words
in the name and note, amount size, time of day, account). Only Confirmed rows train it; its own guesses never do.
- 90%+ sure, with a payee or word you've filed twice pointing mostly at one category: filed for you on load, Status
  "Auto-filed" (its own tab on Transactions; editing or "Mark reviewed" confirms it, which then trains the model).
- 80%+: shown as "learned" in To review and fileable in one tap. Anything less waits for you.
- Your latest choice for a payee (`lastPicks`) is the first suggestion ("Last time you chose …"), and while the model's
  favourite disagrees with it nothing is learned or auto-filed for that payee, so one correction sticks.
- The To review card shows how often the model is right (`evalModel`: each of your last 300 reviews hidden and guessed
  from the rest), overall and for the ones it would file by itself.
`npm test` checks the model and the bank balance maths.

Bank balance is counted, not stored: the latest Daily Snapshots row with "Balance checked" ticked (what you typed in
"Update", a statement's closing balance, or the bank's "Avl Bal" from an HDFC SMS or email via the hdfc-sync Worker),
plus every bank transaction after it (rows with a bank Ref ID; "manual-" rows are cash/bookkeeping). A missed alert
added later fixes the balance by itself. No sync keeps a running total: the old one drifted to -₹1 lakh in October
because missed credits and skipped runs stayed in it.

Sync without AI: the `hdfc-sync` Cloudflare Worker in `sync-worker/` reads HDFC alert emails every 15 minutes, and
takes HDFC SMS the moment they arrive from an iPhone Shortcuts automation. It adds them with regex parsing and the same
rules and Ref IDs as the routines below, so it keeps going when the Claude plan's limit stops them. Setup, the iPhone
steps, checks and limits: `sync-worker/README.md`.

The nightly routine "HDFC Daily Sync"(04:00 IST) runs `daily-sync-instructions.txt`
(a local copy, kept out of git like the 2-hourly one). Updated 25 Oct 2026 to match the Worker: INDmoney / Binance credits
are Investing & Trading and other big credits wait for review; Zepto and Blinkit are left to the Worker (no order-email
searches); no Insights text (the site works them out). The 2-hourly routine is off.

Sync: "HDFC Sync (every 2h)"(06:35 to 22:35 IST, Gmail + Notion only, last 8 hours,
prompt = `hourly-sync-instructions.txt`) and "HDFC Daily Sync" (nightly, last 4 days, plus subscriptions, investments,
news, insights). Both dedupe on Ref ID, so overlap is safe. Shopping payments (Amazon, Blinkit, Zepto, Instamart, ...)
are matched to the shop's order email and split by item into Fitness & Diet / Foods & Drinks / Home / Personal Expense; the nightly
run also clears up to 15 old shopping reviews this way. Runs are skipped when the Claude plan's weekly limit is hit (it
happened on 19 and 20 Oct), which is why the windows overlap.

Upload statement (Transactions page) reads HDFC's locked PDF (pdf.js from cdnjs, in the browser; the password can be
remembered in that browser's localStorage, never sent anywhere) or an XLS/XLSX/CSV export (SheetJS, also loaded on demand), adds the rows Notion doesn't have (matched on the bank's reference, else type + amount within a day) to To review,
and can set the bank balance from the statement's closing balance. The Ref ID is the bank's, so the nightly sync skips them.
A pay-back credit only cancels spending in its own category.

## Updating investments
"Log snapshot" on the Investments page saves your bank balance and today's holdings values.
Holdings quantities come from the latest snapshot; update them in Notion (or have Claude sync
Binance, Coinbase and INDmoney) when you buy or sell.
