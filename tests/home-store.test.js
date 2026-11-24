import test from "node:test";
import assert from "node:assert/strict";
import {
  applyHomeCommand,
  emptyHome,
  householdSummary,
} from "../src/home-store.js";

const now = new Date("2026-11-24T16:10:00Z"); // November 25 in Ulaanbaatar.
const base = {
  type: "plan",
  id: "first-plan",
  product: "Шошго А",
  dose: 0.1,
  unit: "л",
  stock: 0.3,
  intervalDays: 7,
  nextDue: "2026-11-25",
  expectedRevision: 0,
};
const apply = (state, cmd, at = now) => applyHomeCommand(state, cmd, at);
const planned = () => apply(emptyHome(), base);
const use = {
  type: "use",
  id: "use-today",
  planId: base.id,
  due: base.nextDue,
};

test("household starts without fictitious tests, stock, savings or attendance", () => {
  const state = emptyHome();
  const summary = householdSummary(state, now);
  assert.equal(summary.status, "unknown");
  assert.equal(summary.today, "2026-11-25");
  assert.deepEqual(
    [summary.useCount, summary.testCount, summary.greenDays],
    [0, 0, 0],
  );
  assert.equal(summary.stockWeeks, null);
  assert.equal(summary.daysSinceEmptying, null);
  assert.equal(summary.canUse, false);
  assert.ok(state.householdId && state.householdId !== emptyHome().householdId);
});

test("due application, stock deduction and next date are one immutable atomic change", () => {
  const start = planned();
  const done = apply(start, use);
  assert.equal(done.householdId, start.householdId);
  assert.equal(start.stock, 0.3);
  assert.equal(done.stock, 0.2);
  assert.equal(done.plan.nextDue, "2026-12-02");
  assert.strictEqual(apply(done, use), done); // Retry after a lost response.
  assert.throws(() => apply(done, { ...use, id: "other-tab" }), {
    code: "CONFLICT",
  });
  assert.throws(
    () => apply(done, { ...use, id: "early", due: done.plan.nextDue }),
    { code: "EARLY" },
  );
  assert.deepEqual(
    [
      householdSummary(done, now).useCount,
      householdSummary(done, now).onTimeCount,
    ],
    [1, 1],
  );
});

test("missed dates restart the label interval from application and never permit catch-up dosing", () => {
  const start = apply(emptyHome(), {
    ...base,
    nextDue: "2026-11-01",
    stock: 0.1,
  });
  const done = apply(start, { ...use, due: "2026-11-01" });
  assert.equal(done.stock, 0);
  assert.equal(done.plan.nextDue, "2026-12-02");
  assert.equal(householdSummary(done, now).onTimeCount, 0);
  const nextWeek = new Date("2026-12-02T01:00:00Z");
  assert.throws(
    () => apply(done, { ...use, id: "next", due: done.plan.nextDue }, nextWeek),
    { code: "STOCK" },
  );
  assert.equal(householdSummary(done, nextWeek).canUse, false);
});

test("stock additions merge across tabs, update coverage, preserve decimals and deduplicate retries", () => {
  let state = planned();
  const stock = {
    type: "stock",
    id: "delivery",
    planId: base.id,
    amount: 0.2,
    supplier: "Хорооны цэг",
  };
  state = apply(state, stock);
  assert.equal(state.stock, 0.5);
  assert.equal(state.events[0].supplier, "Хорооны цэг");
  assert.equal(householdSummary(state, now).stockDoses, 5);
  assert.equal(householdSummary(state, now).stockWeeks, 5);
  assert.strictEqual(apply(state, stock), state);
  assert.throws(() => apply(state, { ...stock, amount: 0.8 }), {
    code: "CONFLICT",
  });
  state = apply(state, { ...stock, id: "other-tab" });
  assert.equal(state.stock, 0.7);
  for (const amount of [Infinity, NaN, -1, 0, "0.03", 0.0000009]) {
    assert.throws(() => apply(state, { ...stock, id: "bad", amount }), {
      code: "QUANTITY",
    });
  }
});

test("plan edits detect stale revision and never silently convert stock to another product or unit", () => {
  const start = planned(),
    done = apply(start, use);
  const edit = { ...base, id: "new-plan", expectedRevision: start.revision };
  assert.throws(() => apply(done, edit), { code: "CONFLICT" });
  assert.throws(
    () =>
      apply(done, {
        ...edit,
        expectedRevision: done.revision,
        stock: undefined,
        unit: "г",
      }),
    { code: "STOCK" },
  );
  const next = apply(done, {
    ...edit,
    expectedRevision: done.revision,
    stock: undefined,
  });
  assert.equal(next.stock, 0.2);
  assert.equal(next.plan.id, "new-plan");
  assert.throws(
    () =>
      apply(next, {
        type: "stock",
        id: "old-delivery",
        planId: base.id,
        amount: 1,
      }),
    { code: "CONFLICT" },
  );
  assert.throws(() => apply(emptyHome(), { ...base, intervalDays: 0 }), {
    code: "SCHEDULE",
  });
  assert.throws(() => apply(emptyHome(), { ...base, nextDue: "2026-02-30" }), {
    code: "SCHEDULE",
  });
});

test("condition and tests keep human-entered observations and never mark an inconclusive scan low", () => {
  const tests = {
    type: "test",
    id: "lab",
    method: "camera",
    status: "high",
    note: "Лавлах өнгө",
  };
  const observation = {
    type: "condition",
    id: "condition",
    smell: "low",
    fill: "low",
  };
  let state = apply(emptyHome(), observation);
  assert.equal(householdSummary(state, now).status, "low");
  state = apply(state, { ...tests, status: "unread" });
  assert.equal(householdSummary(state, now).status, "unknown");
  assert.equal(householdSummary(state, now).greenDays, 0);
  state = apply(state, { ...tests, id: "read", date: now.toISOString() });
  state = apply(state, {
    ...tests,
    id: "old",
    status: "low",
    date: "2026-11-01",
  });
  assert.equal(householdSummary(state, now).lastTest.id, "read");
  assert.equal(householdSummary(state, now).status, "high");
  assert.equal(householdSummary(state, now).greenDays, 2);
  assert.throws(
    () =>
      apply(state, { ...tests, id: "future", date: "2026-11-25T14:00:00Z" }),
    { code: "DATE" },
  );
  assert.throws(
    () => apply(state, { ...observation, id: "bad", fill: "extreme" }),
    { code: "INPUT" },
  );
  state = apply(state, { ...observation, id: "full", fill: "high" });
  assert.equal(householdSummary(state, now).status, "high");
});

test("emptying history uses only real service dates; backfilled observations stay in calendar order", () => {
  let state = emptyHome();
  const note = { type: "emptying", id: "current", date: "2026-11-23" };
  state = apply(state, note);
  state = apply(state, { ...note, id: "earlier", date: "2026-10-24" });
  assert.deepEqual(householdSummary(state, now).emptyingIntervals, [30]);
  assert.equal(householdSummary(state, now).daysSinceEmptying, 2);
  assert.throws(() => apply(state, { ...note, id: "duplicate" }), {
    code: "DUPLICATE",
  });
  assert.throws(
    () => apply(state, { ...note, id: "future", date: "2026-11-26" }),
    { code: "DATE" },
  );
});
