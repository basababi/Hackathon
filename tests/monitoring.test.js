import test from "node:test";
import assert from "node:assert/strict";
import { upgradeDemoFixtureKits } from "../src/store.js";
import {
  makeSeed,
  latestBySite,
  monthlySeries,
  todayKey,
  dayKey,
} from "../src/data.js";

test("Ulaanbaatar calendar days follow historical DST and day arithmetic across clock changes", () => {
  assert.equal(todayKey(new Date("2016-08-11T15:15:00Z")), "2016-08-12");
  assert.equal(todayKey(new Date("1920-01-01T16:00:00Z")), "1920-01-01");
  assert.equal(dayKey(-1, new Date("2016-03-26T15:30:00Z")), "2016-03-26");
  assert.equal(dayKey(-1, new Date("2016-09-23T15:30:00Z")), "2016-09-22");
});

test("monthly trend uses each site’s latest reading and excludes inconclusive readings", () => {
  const records = [
    { siteId: "a", date: "2026-08-31T16:00:00Z", status: "high" },
    { siteId: "a", date: "2026-09-04T16:00:00Z", status: "low" },
    { siteId: "b", date: "2026-09-04T16:00:00Z", status: "high" },
    { siteId: "c", date: "2026-09-10T16:00:00Z", status: "unread" },
    { siteId: "b", date: "2026-09-30T16:00:00Z", status: "unread" },
  ];
  const now = new Date("2026-10-12T12:00:00Z");
  const months = monthlySeries(records, 3, now);
  assert.deepEqual(
    months.map((m) => m.percent),
    [null, 50, null],
  );
  assert.equal(months[1].total, 2);
  assert.equal(latestBySite(records).get("b").status, "unread");
  assert.equal(todayKey(new Date(records[0].date)), "2026-09-01");
});

test("seed data references valid sites, spans six local months and never dates results in the future", () => {
  for (const time of [
    "2026-11-23T00:00:00Z",
    "2025-12-31T16:00:05Z",
    "2024-02-29T00:05:00Z",
  ]) {
    const now = new Date(time),
      { sites, records, reminders } = makeSeed(now);
    const ids = new Set(sites.map((s) => s.id));
    assert.ok(
      records.every(
        (r) => ids.has(r.siteId) && Date.parse(r.date) <= now.getTime(),
      ),
    );
    assert.ok(reminders.every((r) => ids.has(r.siteId)));
    assert.equal(new Set(records.map((r) => r.id)).size, records.length);
    assert.equal(monthlySeries(records, 6, now).length, 6);
  }
});
test("only original legacy demo fixtures receive the sample kit on upgrade", () => {
  const seed = makeSeed(new Date("2026-11-23T06:00:00Z"));
  const [first, second] = seed.records.map(({ kit, ...record }) => record);
  const edited = { ...second, note: "field note" };
  const custom = { ...first, id: "custom" };
  const mixed = { ...seed, records: [first, edited, custom] };
  const next = upgradeDemoFixtureKits(mixed, seed);
  assert.equal(next.records[0].kit, seed.records[0].kit);
  assert.strictEqual(next.records[1], edited);
  assert.strictEqual(next.records[2], custom);
  assert.strictEqual(upgradeDemoFixtureKits(next, seed), next);
});
