import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarDay, fieldDateTime, measurementInstant, nextDueDay, setReminderDone,
  undoIssue, validScheduleFields, validScheduleSeries
} from '../src/schedule.js';
import { changesBetween, mergeChanges } from '../src/store.js';
import { validEntity } from '../src/schema.js';
import workspace from '../api/workspace.js';

const single = { id: 'r1', siteId: 's1', due: '2028-02-28', product: 'A', dose: 1.5, unit: 'мл', done: false };
const series = { ...single, seriesId: single.id, repeatDays: 1 };
const unrelated = { ...single, id: 'r2' };
const finish = (rows, id = series.id) => setReminderDone(rows, id, true, '2028-03-03');
const reopen = (rows, id = series.id) => setReminderDone(rows, id, false, '2028-03-04');

test('legacy reminders stay one-off and observed completion date survives retries', () => {
  const rows = finish([single]);
  assert.deepEqual(rows, [{ ...single, done: true, completedOn: '2028-03-03' }]);
  assert.equal(setReminderDone(rows, single.id, true, '2028-03-04'), rows);
  assert.deepEqual(reopen(rows), [single]);
  assert.deepEqual(reopen([{ ...single, done: true }]), [single]);
});

test('late completion keeps the original cadence across leap days and calendar years', () => {
  const [done, next] = finish([series]);
  assert.deepEqual(done, { ...series, done: true, completedOn: '2028-03-03' });
  assert.deepEqual(next, { ...series, due: '2028-02-29', id: 'r1:2028-02-29' });
  assert.equal(nextDueDay('2026-12-30', 4), '2027-01-03');
  assert.equal(nextDueDay('2026-02-28', 1), '2026-03-01');
  assert.equal(nextDueDay('9999-12-31', 1), null);
  assert.equal(nextDueDay('2026-02-29', 1), null);
  assert.equal(nextDueDay('2026-02-02', 1.5), null);
});

test('concurrent completion and retry create one successor in the same storage change', () => {
  const previous = { sites: [], records: [], reminders: [series] };
  const next = { ...previous, reminders: finish(previous.reminders) };
  const changes = changesBetween(previous, next);
  assert.equal(changes.length, 2);
  const concurrent = { ...previous, reminders: [series, unrelated] };
  const first = mergeChanges(concurrent, changes);
  assert.equal(first.reminders.length, 3);
  assert.deepEqual(mergeChanges(first, changes), first);
  assert.deepEqual(finish(first.reminders), first.reminders);
  assert.ok(validScheduleSeries(first.reminders));
});

test('undo rolls back a pending successor and detects later completed work', () => {
  const first = finish([series, unrelated]);
  const successor = first.at(-1);
  assert.deepEqual(reopen(first), [series, unrelated]);
  const second = finish(first, successor.id);
  assert.throws(() => reopen(second), { code: 'SCHEDULE' });
  assert.ok(undoIssue(second, second[0]));
  assert.deepEqual(reopen(second, successor.id), first);
  const middleDeleted = second.filter(row => row.id !== successor.id);
  assert.throws(() => reopen(middleDeleted), { code: 'SCHEDULE' });
  assert.ok(validScheduleSeries(middleDeleted));
});

test('deleting the next pending date stops recurrence and preserves completed history', () => {
  const stopped = finish([series, unrelated]).filter(r => r.id !== 'r1:2028-02-29');
  assert.ok(validScheduleSeries(stopped));
  assert.equal(finish(stopped), stopped);
  assert.equal(finish(reopen(stopped)).filter(r => r.seriesId === series.seriesId && !r.done).length, 1);
});

test('a stale undo cannot create a second pending occurrence after another editor removes an intervening completion', () => {
  const before = { sites: [], records: [], reminders: finish([series]) };
  const intermediate = before.reminders[1];
  const latest = finish(before.reminders, intermediate.id).filter(row => row.id !== intermediate.id);
  const undo = changesBetween(before, { ...before, reminders: reopen(before.reminders) });
  assert.throws(() => mergeChanges({ ...before, reminders: latest }, undo), { code: 'CONFLICT' });
});

test('schedule schema validates recurrence pairs, stable occurrence IDs and series ordering', () => {
  assert.ok(validEntity('reminders', single, single.id));
  assert.ok(validEntity('reminders', series, series.id));
  const rows = finish([series]);
  assert.ok(rows.every(row => validEntity('reminders', row, row.id)));
  assert.ok(validScheduleSeries(rows));
  assert.equal(validScheduleFields({ ...single, repeatDays: 2 }), false);
  assert.equal(validScheduleFields({ ...series, repeatDays: 0 }), false);
  assert.equal(validScheduleFields({ ...series, id: 'another' }), false);
  assert.equal(validScheduleFields({ ...series, completedOn: '2026-02-30', done: true }), false);
  assert.equal(validScheduleSeries([series, rows[1]]), false);
  assert.equal(validScheduleSeries([series, { ...rows[1], done: true }]), false);
  assert.equal(validScheduleSeries([rows[0], rows[0]]), false);
});

test('field measurement minutes use Ulaanbaatar time and preserve the default timestamp', () => {
  const opened = new Date('2026-11-22T16:00:09.075Z');
  assert.equal(fieldDateTime(opened), '2026-11-23T00:00');
  assert.equal(measurementInstant('2026-11-23T00:00', opened, opened), opened.toISOString());
  assert.equal(measurementInstant('2026-11-22T07:10', opened, opened), '2026-11-21T23:10:00.000Z');
  assert.equal(measurementInstant('2026-11-23T00:01', opened, opened), null);
  assert.equal(measurementInstant('2026-02-29T10:00', opened, opened), null);
  assert.equal(measurementInstant('2026-11-22T25:10', opened, opened), null);
  assert.equal(calendarDay('2026-1-1'), false);
});

test('shared API merges simultaneous completion, preserves a later cancellation and rejects invalid input atomically', async t => {
  const key = 'test-schedule-workspace-secret-key';
  const config = {
    WORKSPACE_ACCESS_TOKEN: key,
    UPSTASH_REDIS_REST_URL: 'https://test.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'test-token'
  };
  for (const [name, value] of Object.entries(config)) {
    const original = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    });
  }
  const original = { sites: [{ id: 's1', name: 'Site', lat: 47, lng: 106 }], records: [], reminders: [series] };
  let stored = JSON.stringify(original);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, config.UPSTASH_REDIS_REST_URL);
    const [command, , , , expected, next] = JSON.parse(options.body);
    if (command === 'GET') return Response.json({ result: stored });
    assert.equal(command, 'EVAL');
    if (stored !== expected) return Response.json({ result: 0 });
    stored = next;
    return Response.json({ result: 1 });
  });
  const patch = changes => workspace.fetch(new Request('https://app.example.test/api/workspace', {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ changes })
  }));
  const completed = { ...original, reminders: finish(original.reminders) };
  const completion = changesBetween(original, completed);
  const simultaneous = await Promise.all([patch(completion), patch(completion)]);
  assert.deepEqual(simultaneous.map(response => response.status), [200, 200]);
  assert.deepEqual(JSON.parse(stored), completed);
  const stopped = { ...completed, reminders: [completed.reminders[0]] };
  assert.equal((await patch(changesBetween(completed, stopped))).status, 200);
  assert.equal((await patch(completion)).status, 409);
  assert.deepEqual(JSON.parse(stored), stopped);
  const tooMany = { ...stopped, reminders: [
    ...completed.reminders,
    { ...series, id: 'r1:2028-03-01', due: '2028-03-01' }
  ] };
  assert.equal((await patch(changesBetween(stopped, tooMany))).status, 409);
  const future = new Date(Date.now() + 86400000).toISOString();
  const next = { ...stopped, records: [{ id: 't1', siteId: 's1', date: future, method: 'manual', status: 'low' }] };
  assert.equal((await patch(changesBetween(stopped, next))).status, 422);
  assert.deepEqual(JSON.parse(stored), stopped);
});
