// Pulls feats/trainModel out of app.js and checks the learning rules.
import { readFileSync } from "fs";
import assert from "assert";
const src = readFileSync(process.argv[2] || new URL("app.js", import.meta.url), "utf8");
const code = src.slice(src.indexOf("const words = "), src.indexOf("function derive(live)"));
const { trainModel } = new Function(code + "; return { trainModel };")();
const tx = (payee, entry, category, amount, type = "Debit", time = "13:00") => ({ payee, entry, category, amount, type, time, source: "UPI" });
const rows = [tx("swiggy@icici", "Swiggy", "Foods & Drinks", 300), tx("swiggy@icici", "Swiggy", "Foods & Drinks", 450),
  tx("zepto@ybl", "Zepto", "Fitness & Diet", 200), tx("zepto@ybl", "Zepto", "Home", 900), tx("a@okaxis", "UPI payment", "Personal Expense", 100),
  tx("b@okaxis", "UPI payment", "Personal Expense", 120), tx("c@okaxis", "UPI payment", "Transport", 30), tx("citi", "Salary", "Income", 90000, "Credit")];
const rank = trainModel(rows), learned = (t) => { const r = rank(t)?.[0]; return r && r.p >= 0.8 && r.n >= 2 ? r : null; };
assert.equal(learned(tx("swiggy@icici", "Swiggy", null, 380))?.cat, "Foods & Drinks");      // repeat payee
assert.equal(rank(tx("new@icici", "Swiggy order", null, 380))[0].cat, "Foods & Drinks"); // new handle, same word: suggested first
assert.equal(learned(tx("zepto@ybl", "Zepto", null, 300)), null);                            // you disagreed with yourself
assert.equal(learned(tx("z@okaxis", "UPI payment", null, 100)), null);                       // generic word alone never decides
assert.equal(learned(tx("x", "refund", null, 50, "Credit")), null);                          // one credit class, no evidence
assert.equal(rank(tx("x", "y", null, 1, "Credit"))[0].cat, "Income");                        // only credit classes are offered
console.log("model ok");

// One correction sticks: the latest confirmed choice for a payee wins, even against older ones.
const { lastPicks, evalModel } = new Function(code + "; return { lastPicks, evalModel };")();
const at = (t, date) => ({ ...t, date });
const last = lastPicks([at(tx("g@ybl", "UPI payment", "Fitness & Diet", 180), "2026-10-01"), at(tx("g@ybl", "UPI payment", "Fitness & Diet", 120), "2026-10-05"),
  at(tx("g@ybl", "UPI payment", "Foods & Drinks", 150), "2026-10-22"), at(tx("g@ybl", "refund", "Income", 50, "Credit"), "2026-10-23")]);
assert.equal(last(tx("g@ybl", "UPI payment", null, 90)), "Foods & Drinks");
assert.equal(last(tx("g@ybl", "x", null, 90, "Credit")), "Income");    // per type
assert.equal(last(tx("new@ybl", "UPI payment", null, 90)), null);
// Accuracy: Swiggy is always Foods & Drinks, so hiding one Swiggy row still gets it right; counts add up.
const E = evalModel([...rows, tx("swiggy@icici", "Swiggy", "Foods & Drinks", 220)]);
assert.equal(E.n, 8); // the one salary credit is skipped: hidden, no other credit is left to learn from
assert.ok(E.top >= 3 && E.top <= E.n && E.sureOk <= E.sure && E.autoOk <= E.auto && E.auto <= E.sure);
console.log("last choice and accuracy ok");

// Bank balance counts on (and back) from the last checked balance; manual rows don't move it.
const bcode = src.slice(src.indexOf("const atMs = "), src.indexOf("function derive(live)"));
const { bankBalance, atMs } = new Function(bcode + "; return { bankBalance, atMs };")();
const B = bankBalance({ bank: 1000, date: "2026-10-10T12:00:00+05:30" }, [
  { refId: "1", amount: 200, type: "Debit", date: "2026-10-10T09:00:00+05:30" },   // before the check: already in it
  { refId: "2", amount: 300, type: "Debit", date: "2026-10-11T10:00:00+05:30" },
  { refId: "3", amount: 50, type: "Credit", date: "2026-10-12" },
  { refId: "manual-1", amount: 999, type: "Debit", date: "2026-10-12T10:00:00+05:30" }]);
assert.equal(B.at(atMs("2026-10-12")), 750);
assert.equal(B.at(atMs("2026-10-09")), 1200);
assert.equal(B.since, 2);
console.log("balance ok");

// A friend paying back the same amount within 45 days pairs with the payment.
const { lending } = new Function(bcode + "; return { lending };")();
const L = lending([
  { id: "d1", type: "Debit", payee: "friend@okaxis", amount: 1000, date: "2026-10-10T10:00:00+05:30", category: "Transfers" },
  { id: "c1", type: "Credit", payee: "friend@okaxis", amount: 1000, date: "2026-10-13T10:00:00+05:30", category: "Transfers" },
  { id: "d2", type: "Debit", payee: "pal@ybl", amount: 500, date: "2026-10-01T10:00:00+05:30", category: "Transfers" },
  { id: "c2", type: "Credit", payee: "pal@ybl", amount: 500, date: "2026-09-01T10:00:00+05:30" },        // before the payment: no pair
  { id: "c3", type: "Credit", payee: "boss@hdfc", amount: 90000, date: "2026-10-01T10:00:00+05:30" }]);
assert.deepEqual(Object.keys(L), ["c1"]);
assert.equal(L.c1.id, "d1");
console.log("lending ok");

// Spending waiting for review is Unsorted, not its guessed category; it still counts in the month's total.
const tcode = src.slice(src.indexOf("const CAT = {"), src.indexOf("const daysIn = "));
const { tally } = new Function(tcode + "; return { tally };")();
const T = tally([
  { type: "Debit", amount: 100, category: "Personal Expense", review: true },
  { type: "Debit", amount: 40, category: "Fitness & Diet" },
  { type: "Debit", amount: 5, category: "" },
  { type: "Debit", amount: 900, category: "Transfers", review: true }]); // an exchange waiting for review is not spending
assert.deepEqual([T.cats, T.spent], [{ Unsorted: 105, 'Fitness & Diet': 40 }, 145]);
console.log("unsorted ok");
