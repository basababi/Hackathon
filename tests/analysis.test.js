import assert from "node:assert/strict";
import test from "node:test";
import { compareSites } from "../src/analysis.js";

const now = new Date("2026-11-23T10:00:00Z");
const sites = [
  { id: "west", name: "Баруун цэг", district: "Баянгол" },
  { id: "east", name: "Зүүн цэг", district: "Баянзүрх" },
  { id: "other", name: "Бусад цэг" },
];
const read = (id, siteId, date, status, kit = "Kit A") => ({ id, siteId, date, status, kit });
function analyze(records, filters) {
  return compareSites({ sites, records }, { days: 30, now, ...filters });
}

test("compare the last reading on the first and last Ulaanbaatar dates", () => {
  const records = [
    read("4", "west", "2026-11-21T16:00:00Z", "medium", " Kit   A "),
    read("1", "west", "2026-11-20T16:00:00Z", "low", "KIT A"),
    read("3", "west", "2026-11-21T15:59:59Z", "high"),
    read("2", "west", "2026-11-21T12:00:00Z", "medium"),
  ];
  const report = analyze(records);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].from.id, "3");
  assert.equal(report.rows[0].to.id, "4");
  assert.deepEqual(report.counts, { improved: 1, unchanged: 0, worsened: 0 });
  assert.deepEqual(analyze([...records].reverse()), report);
});

test("each site votes once using the eligible kit with the newest follow-up", () => {
  const records = [
    read("a1", "east", "2026-11-02T08:00:00Z", "high"),
    read("a2", "east", "2026-11-19T06:00:00Z", "low"),
    read("b1", "east", "2026-11-13T06:00:00Z", "low", "Kit B"),
    read("b2", "east", "2026-11-20T06:00:00Z", "high", "Kit B"),
    read("c1", "east", "2026-11-21T06:00:00Z", "low", "Kit C"),
    read("c2", "east", "2026-11-21T06:10:00Z", "low", "Kit C"),
  ];
  const report = analyze(records);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].to.kit, "Kit B");
  assert.equal(report.rows[0].outcome, "worsened");
  assert.equal(report.counts.worsened, 1);
});

test("exclude unnamed kits, inconclusive results, orphan sites and future observations", () => {
  const records = [
    read("1", "west", "2026-11-20T12:00:00Z", "high", ""),
    read("2", "west", "2026-11-21T12:00:00Z", "low", "  "),
    read("3", "east", "2026-11-20T12:00:00Z", "unread"),
    read("4", "east", "2026-11-21T12:00:00Z", "low"),
    read("5", "east", "2026-11-23T12:00:00Z", "high"),
    read("6", "absent", "2026-11-23T07:00:00Z", "low", ""),
    read("7", "other", "invalid-date", "high"),
  ];
  const report = analyze(records);
  assert.equal(report.rows.length, 0);
  assert.equal(report.withoutKit, 2);
  assert.equal(report.withoutStatus, 1);
  assert.equal(report.observed, 2);
  assert.equal(report.registered, 3);
});

test("window is inclusive on local-day boundaries and supports all-time and unnamed districts", () => {
  const records = [
    read("old", "other", "2026-10-24T15:59:59Z", "high"),
    read("start", "other", "2026-10-24T16:00:00Z", "medium"),
    read("last", "other", "2026-11-23T09:59:59Z", "medium"),
    read("other-district", "east", "2026-11-22T07:00:00Z", "low", ""),
  ];
  const recent = analyze(records, { district: "" });
  assert.equal(recent.start, "2026-10-25");
  assert.equal(recent.rows[0].outcome, "unchanged");
  assert.equal(recent.registered, 1);
  assert.equal(recent.withoutKit, 0);
  const lifetime = analyze(records, { district: "", days: 0 });
  assert.equal(lifetime.start, null);
  assert.equal(lifetime.rows[0].from.id, "old");
  assert.equal(lifetime.rows[0].outcome, "improved");
});
