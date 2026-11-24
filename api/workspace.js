import { createHash, timingSafeEqual } from 'node:crypto';
import { emptyState, mergeChanges } from '../src/store.js';
import { allowedFields, validEntity, validId } from '../src/schema.js';
import { fieldDateTime } from '../src/schedule.js';

const databaseKey = 'khurs:workspace:v1';
const bodyLimit = 64 * 1024;
const stateLimit = 1024 * 1024;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' };
const atomicWrite = `
local before = redis.call('GET', KEYS[1])
if (before or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;

function fault(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function invalid() {
  return fault(422, 'INVALID', 'Бүртгэлийн талбаруудыг шалгана уу. Байршил, огноо болон утга хүчинтэй байх ёстой.');
}

function checkConfiguration(request) {
  const teamKey = process.env.WORKSPACE_ACCESS_TOKEN;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!teamKey || teamKey.length < 32 || !url?.startsWith('https://') || !token) {
    throw fault(503, 'UNCONFIGURED', 'Багийн санг холбоогүй байна. Vercel төслийн орчны хувьсагчдыг тохируулна уу.');
  }
  const supplied = request.headers.get('authorization') ?? '';
  const digest = input => createHash('sha256').update(input).digest();
  if (!timingSafeEqual(digest(supplied), digest('Bearer ' + teamKey))) {
    throw fault(401, 'AUTH', 'Багийн нэвтрэх түлхүүр буруу байна.');
  }
  return { url, token };
}

async function redis(config, command) {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(4500)
  });
  if (!response.ok) throw new Error('Storage request failed');
  const body = await response.json();
  if (body.error || !Object.hasOwn(body, 'result')) throw new Error('Storage command failed');
  return body.result;
}

async function parseChanges(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) {
    throw fault(415, 'MEDIA_TYPE', 'JSON форматаар илгээнэ үү.');
  }
  const tooLarge = () => fault(413, 'TOO_LARGE', 'Нэг удаагийн өөрчлөлтийн хэмжээ хэтэрсэн байна.');
  if (Number(request.headers.get('content-length')) > bodyLimit) throw tooLarge();
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > bodyLimit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
  if (!Array.isArray(body?.changes) || body.changes.length > 100) throw invalid();
  const seen = new Set();
  const now = new Date();
  for (const change of body.changes) {
    if (!allowedFields(change, ['collection', 'id', 'before', 'after'])) throw invalid();
    const { collection, id, before, after } = change;
    const key = collection + '/' + id;
    if (!['sites', 'records', 'reminders'].includes(collection) || !validId(id) ||
        !validEntity(collection, before, id) || !validEntity(collection, after, id) ||
        (before === null && after === null) || seen.has(key)) throw invalid();
    if (collection === 'records' && after && after.date !== before?.date) {
      // Date-only legacy rows represent a Ulaanbaatar calendar day. The entry control records minutes.
      const future = after.date.length === 10
        ? after.date > fieldDateTime(now).slice(0, 10)
        : Math.floor(Date.parse(after.date) / 60000) > Math.floor(now.getTime() / 60000);
      if (future) throw fault(422, 'DATE', 'Хэмжилтийн огноо, цаг ирээдүйд байна.');
    }
    seen.add(key);
  }
  return body.changes;
}

function checkReferences(state) {
  const ids = new Set(state.sites.map(site => site.id));
  if ([...state.records, ...state.reminders].some(row => !ids.has(row.siteId))) {
    throw fault(409, 'CONFLICT', 'Холбогдох хяналтын цэг олдсонгүй. Ажлын орчноо шинэчлээд дахин оролдоно уу.');
  }
}

async function workspace(request) {
  try {
    const config = checkConfiguration(request);
    if (!['GET', 'PATCH'].includes(request.method)) {
      return Response.json({ code: 'METHOD', message: 'Энэ үйлдэл дэмжигдэхгүй.' }, {
        status: 405, headers: { ...headers, Allow: 'GET, PATCH' }
      });
    }
    const changes = request.method === 'PATCH' ? await parseChanges(request) : [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const raw = await redis(config, ['GET', databaseKey]);
      const current = raw === null ? emptyState() : JSON.parse(raw);
      if (!changes.length) return Response.json(current, { headers });
      const next = mergeChanges(current, changes);
      checkReferences(next);
      const serialized = JSON.stringify(next);
      if (Buffer.byteLength(serialized) > stateLimit) {
        throw fault(413, 'CAPACITY', 'Багийн сангийн хадгалах багтаамж дүүрсэн байна.');
      }
      const saved = await redis(config, ['EVAL', atomicWrite, 1, databaseKey, raw ?? '', serialized]);
      if (saved === 1) return Response.json(next, { headers });
    }
    throw fault(409, 'CONFLICT', 'Багийн сан шинэчлэгдэж байна. Түр хүлээгээд дахин оролдоно уу.');
  } catch (error) {
    if (error.code === 'CONFLICT' || error.status) {
      return Response.json({ code: error.code, message: error.message }, { status: error.status || 409, headers });
    }
    return Response.json({ code: 'STORAGE', message: 'Багийн сантай холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.' }, { status: 503, headers });
  }
}

export default { fetch: workspace };
