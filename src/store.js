import { guardScheduleReplay, validScheduleSeries } from './schedule.js';
const collections = ['sites', 'records', 'reminders'];
const databaseName = 'khurs-monitor-v1';
const sessionKey = 'khurs-team-session-v1';
let lastState;
let openedDatabase;
let teamToken = '';
let restoredSession = false;
let pending = Promise.resolve();
let localCollection;

function localId() {
  if (!localCollection) {
    try { localCollection = localStorage.getItem('terrasense-local-mode') === 'field' ? 'field' : 'workspace'; }
    catch { localCollection = 'workspace'; }
  }
  return localCollection;
}

export function isDemo() {
  return !isShared() && localId() === 'workspace';
}

const copy = value => structuredClone(value);

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

export function emptyState() {
  return { sites: [], records: [], reminders: [] };
}

// Each entity is a flat JSON object. Key order can vary between clients.
export function sameEntity(first, second) {
  if (first === second) return true;
  if (!first || !second) return false;
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length &&
    keys.every(key => Object.hasOwn(second, key) && first[key] === second[key]);
}

export function changesBetween(previous, next) {
  const changes = [];
  for (const collection of collections) {
    const before = new Map(previous[collection].map(item => [item.id, item]));
    const after = new Map(next[collection].map(item => [item.id, item]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const oldItem = before.get(id) ?? null;
      const newItem = after.get(id) ?? null;
      if (!sameEntity(oldItem, newItem)) {
        changes.push({ collection, id, before: oldItem, after: newItem });
      }
    }
  }
  return changes;
}

export function mergeChanges(current, changes) {
  guardScheduleReplay(current.reminders, changes);
  const next = {};
  for (const collection of collections) {
    const entities = new Map(current[collection].map(item => [item.id, item]));
    for (const change of changes.filter(item => item.collection === collection)) {
      const latest = entities.get(change.id) ?? null;
      if (sameEntity(latest, change.after)) continue; // Safe retry after a lost response.
      if (!sameEntity(latest, change.before)) {
        throw failure('CONFLICT', 'Энэ бүртгэл өөр цонх эсвэл төхөөрөмжөөс өөрчлөгдсөн байна. Мэдээллээ шинэчлээд дахин оролдоно уу.');
      }
      if (change.after === null) entities.delete(change.id);
      else entities.set(change.id, change.after);
    }
    next[collection] = Array.from(entities.values());
  }
  if (!validScheduleSeries(next.reminders)) {
    throw failure('CONFLICT', 'Давтагдах тов өөрчлөгдсөн байна. Сүүлийн товыг нээгээд дахин оролдоно уу.');
  }
  return next;
}

function serial(operation) {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

function remember(state) {
  lastState = copy(state);
  return copy(state);
}

async function database() {
  if (!openedDatabase) {
    openedDatabase = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('data');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          openedDatabase = undefined;
        };
        resolve(db);
      };
    }).catch(() => {
      openedDatabase = undefined;
      throw failure('STORAGE', 'Төхөөрөмжийн хадгалах санг нээж чадсангүй. Хөтчийн хадгалалтын тохиргоог шалгана уу.');
    });
  }
  return openedDatabase;
}

// The read, merge and write share an IndexedDB transaction across browser tabs.
async function localState(seed, changes = [], transform) {
  const key = localId();
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readwrite');
    const store = tx.objectStore('data');
    const request = store.get(key);
    let result;
    let problem;
    request.onsuccess = () => {
      try {
        const current = request.result ?? (key === 'field' ? emptyState() : seed);
        result = transform ? transform(current) : (changes.length ? mergeChanges(current, changes) : current);
        if (request.result === undefined || result !== current) store.put(result, key);
      } catch (error) {
        problem = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(problem ?? failure('STORAGE', 'Төхөөрөмжид хадгалж чадсангүй. Хадгалах зай болон хөтчийн тохиргоог шалгана уу.'));
  });
}

function restoreSession() {
  if (restoredSession) return;
  restoredSession = true;
  try { teamToken = sessionStorage.getItem(sessionKey) || ''; } catch {}
}

function setSession(token) {
  teamToken = token;
  restoredSession = true;
  try {
    if (token) sessionStorage.setItem(sessionKey, token);
    else sessionStorage.removeItem(sessionKey);
  } catch {}
}

export function isShared() {
  restoreSession();
  return Boolean(teamToken);
}

async function sharedRequest(token, changes) {
  let response;
  try {
    const options = {
      method: changes ? 'PATCH' : 'GET',
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    };
    if (changes) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ changes });
    }
    response = await fetch('/api/workspace', options);
  } catch {
    throw failure('NETWORK', 'Багийн сантай холбогдож чадсангүй. Интернет холболтоо шалгаад дахин оролдоно уу.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || !collections.every(key => Array.isArray(body[key]))) {
    throw failure(body?.code || 'UNAVAILABLE', body?.message || 'Багийн өгөгдлийн үйлчилгээ ажиллахгүй байна. Vercel тохиргоогоо шалгана уу.');
  }
  return body;
}

// Old demo installations predate the kit field. Only annotate original
// fixtures whose stable identifiers and sample metadata match our seed.
export function upgradeDemoFixtureKits(current, seed) {
  const examples = new Map(seed.records.map(row => [row.id, row]));
  let updated = false;
  const records = current.records.map(row => {
    const sample = examples.get(row.id);
    if (row.kit !== undefined || !sample?.kit || row.note !== sample.note ||
        row.siteId !== sample.siteId || row.method !== sample.method || row.status !== sample.status) return row;
    updated = true;
    return {...row, kit:sample.kit};
  });
  return updated ? {...current, records} : current;
}

function openLocalWorkspace(seed) {
  return localId() === 'workspace'
    ? localState(seed, [], current => upgradeDemoFixtureKits(current, seed))
    : localState(seed);
}

export function loadState(seed) {
  return serial(async () => remember(isShared()
    ? await sharedRequest(teamToken)
    : await openLocalWorkspace(seed)));
}

export function saveState(next) {
  if (!lastState) return Promise.reject(failure('STATE', 'Өгөгдлийг эхлээд ачаална уу.'));
  const previous = lastState;
  const changes = copy(changesBetween(previous, next));
  const token = teamToken;
  const key = localId();
  return serial(async () => {
    if (token !== teamToken || (!token && key !== localId())) {
      throw failure('STATE', 'Идэвхтэй ажлын орчин өөрчлөгдсөн байна.');
    }
    return remember(token ? await sharedRequest(token, changes) : await localState(previous, changes));
  });
}

// A restore rechecks the preview against the latest data inside the same read-write transaction.
// Reading for preview leaves the ordinary editor's last-seen snapshot intact.
export function personalSnapshot(transform) {
  return serial(async () => {
    if (isShared() || localId() !== 'field') {
      throw failure('MODE', 'Нөөц хуулбарыг ашиглахын тулд «Миний бүртгэл» орчныг нээнэ үү.');
    }
    const result = await localState(emptyState(), [], transform);
    return transform ? remember(result) : result;
  });
}

export function connectShared(token) {
  return serial(async () => {
    const key = String(token ?? '').trim();
    if (!key) throw failure('AUTH', 'Багийн нэвтрэх түлхүүрийг оруулна уу.');
    const state = await sharedRequest(key);
    setSession(key);
    return remember(state);
  });
}

export function disconnectShared(seed) {
  return serial(async () => {
    const local = await openLocalWorkspace(seed);
    setSession('');
    return remember(local);
  });
}

export function switchLocal(demo, seed) {
  return serial(async () => {
    const previous = localId();
    localCollection = demo ? 'workspace' : 'field';
    try {
      const result = await openLocalWorkspace(seed);
      setSession('');
      try { localStorage.setItem('terrasense-local-mode', demo ? 'demo' : 'field'); } catch {}
      return remember(result);
    } catch (error) {
      localCollection = previous;
      throw error;
    }
  });
}
