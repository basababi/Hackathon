import test from 'node:test';
import assert from 'node:assert/strict';
import workspace from '../api/workspace.js';
import { changesBetween, emptyState, mergeChanges } from '../src/store.js';

const teamKey = 'test-only-workspace-access-token-32';
const site = { id: 'site-1', name: 'Хяналтын цэг', district: 'Сүхбаатар', lat: 47.93, lng: 106.9 };
const record = { id: 'record-1', siteId: site.id, date: '2026-11-23T04:30:00Z', status: 'low', method: 'manual' };
const reminder = { id: 'reminder-1', siteId: site.id, due: '2026-11-25', product: 'Бэлдмэл', dose: 5, unit: 'мл', done: false };

function request(method, changes, token = teamKey) {
  const init = { method, headers: { Authorization: 'Bearer ' + token } };
  if (changes) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify({ changes });
  }
  return workspace.fetch(new Request('https://example.test/api/workspace', init));
}

function fakeRedis(t) {
  const previous = {};
  const config = {
    WORKSPACE_ACCESS_TOKEN: teamKey,
    UPSTASH_REDIS_REST_URL: 'https://test.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'test-storage'
  };
  for (const key of Object.keys(config)) {
    previous[key] = process.env[key];
    process.env[key] = config[key];
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let stored = null;
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, config.UPSTASH_REDIS_REST_URL);
    assert.equal(options.headers.Authorization, 'Bearer ' + config.UPSTASH_REDIS_REST_TOKEN);
    const [cmd, , , , oldState, nextState] = JSON.parse(options.body);
    if (cmd === 'GET') return Response.json({ result: stored });
    assert.equal(cmd, 'EVAL');
    if ((stored || '') !== oldState) return Response.json({ result: 0 });
    stored = nextState;
    return Response.json({ result: 1 });
  });
}

const add = (collection, after) => ({ collection, id: after.id, before: null, after });

test('shared records require a valid team key before database access', async t => {
  const storage = fakeRedis(t);
  const response = await request('GET', null, 'incorrect-key');
  assert.equal(response.status, 401);
  assert.equal(storage.mock.callCount(), 0);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('site, test and reminder persist as a single change and can be retried', async t => {
  fakeRedis(t);
  const expected = { sites: [site], records: [record], reminders: [reminder] };
  const changes = changesBetween(emptyState(), expected);
  assert.deepEqual(await (await request('GET')).json(), emptyState());
  for (let i = 0; i < 2; i++) {
    const response = await request('PATCH', changes);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
  assert.deepEqual(await (await request('GET')).json(), expected);
});

test('reject orphaned records, bad coordinates and impossible dates without partial writes', async t => {
  fakeRedis(t);
  const invalidSite = { ...site, lat: 95 };
  const badReminder = { ...reminder, due: '2026-02-30' };
  assert.equal((await request('PATCH', [add('records', record)])).status, 409);
  assert.equal((await request('PATCH', [add('sites', invalidSite)])).status, 422);
  assert.equal((await request('PATCH', [add('sites', site), add('reminders', badReminder)])).status, 422);
  assert.deepEqual(await (await request('GET')).json(), emptyState());
});

test('two editors can save distinct records, conflicting edits require a refresh', async t => {
  fakeRedis(t);
  const another = { ...site, id: 'site-2' };
  const writes = await Promise.all([
    request('PATCH', [add('sites', site)]),
    request('PATCH', [add('sites', another)])
  ]);
  assert.deepEqual(writes.map(response => response.status), [200, 200]);
  const edit = name => ({ collection: 'sites', id: site.id, before: site, after: { ...site, name } });
  assert.equal((await request('PATCH', [edit('Нэгдүгээр цэг')])).status, 200);
  assert.equal((await request('PATCH', [edit('Өөр цэг')])).status, 409);
  const latest = await (await request('GET')).json();
  assert.equal(latest.sites.length, 2);
  assert.equal(latest.sites.find(row => row.id === site.id).name, 'Нэгдүгээр цэг');
});

test('completing and deleting a reminder preserves rows added by another operator', () => {
  const before = { sites: [site], records: [], reminders: [reminder] };
  const serverState = { ...before, records: [record] };
  const completed = { ...before, reminders: [{ ...reminder, done: true }] };
  const merged = mergeChanges(serverState, changesBetween(before, completed));
  assert.deepEqual(merged.records, [record]);
  assert.equal(merged.reminders[0].done, true);
  const removed = mergeChanges(merged, changesBetween(completed, { ...completed, reminders: [] }));
  assert.deepEqual(removed, { sites: [site], records: [record], reminders: [] });
});
