const zone = 'Asia/Ulaanbaatar';
const localClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: zone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const offsetClock = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' });

export function calendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function fieldDateTime(instant = new Date()) {
  const parts = Object.fromEntries(localClock.formatToParts(instant).map(part => [part.type, part.value]));
  return parts.year.padStart(4, '0') + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
}

export function measurementInstant(value, initial, now = new Date()) {
  if (value === fieldDateTime(initial) && initial <= now) return initial.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !calendarDay(value.slice(0, 10))) return null;
  const local = Date.parse(value + ':00Z');
  if (!Number.isFinite(local)) return null;
  // Resolve the offset at the observation date, including Mongolia's historical DST.
  const offsetAt = milliseconds => {
    const offset = offsetClock.formatToParts(milliseconds).find(part => part.type === 'timeZoneName').value;
    const parts = /^GMT\+(\d\d):(\d\d)(?::(\d\d))?$/.exec(offset);
    if (!parts) return NaN;
    return (Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3] || 0)) * 1000;
  };
  // Either side of a clock change may name this local minute. Pick the earlier valid instant.
  const possibleOffsets = new Set([offsetAt(local - 86400000), offsetAt(local + 86400000)]);
  const candidates = [...possibleOffsets].map(offset => new Date(local - offset)).sort((a, b) => a - b);
  const instant = candidates.find(date => date <= now && fieldDateTime(date) === value);
  return instant?.toISOString() || null;
}

export function nextDueDay(due, repeatDays) {
  if (!calendarDay(due) || !Number.isSafeInteger(repeatDays) || repeatDays < 1) return null;
  const next = new Date(due + 'T00:00:00.000Z');
  next.setUTCDate(next.getUTCDate() + repeatDays);
  if (!Number.isFinite(next.getTime()) || next.getUTCFullYear() > 9999) return null;
  return next.toISOString().slice(0, 10);
}

const occurrenceId = (seriesId, due) => seriesId + ':' + due;

export function validScheduleFields(reminder) {
  if (reminder.completedOn !== undefined && (!reminder.done || !calendarDay(reminder.completedOn))) return false;
  if (reminder.repeatDays === undefined) return reminder.seriesId === undefined;
  // Leave room in the 100-character entity ID for the generated ":YYYY-MM-DD" suffix.
  if (typeof reminder.seriesId !== 'string' || !/^[A-Za-z0-9_-]{1,89}$/.test(reminder.seriesId)) return false;
  return Number.isSafeInteger(reminder.repeatDays) && reminder.repeatDays >= 1 &&
    (reminder.id === reminder.seriesId || reminder.id === occurrenceId(reminder.seriesId, reminder.due));
}

function issue(message) {
  return Object.assign(new Error(message), { code: 'SCHEDULE' });
}

export function validScheduleSeries(reminders) {
  const series = new Map();
  for (const row of reminders) {
    if (!row.seriesId) continue;
    const group = series.get(row.seriesId) || { siteId: row.siteId, dates: new Set(), pending: '', lastDone: '' };
    if (group.siteId !== row.siteId || group.dates.has(row.due) || (!row.done && group.pending)) return false;
    group.dates.add(row.due);
    if (!row.done) group.pending = row.due;
    else if (row.due > group.lastDone) group.lastDone = row.due;
    if (group.pending && group.lastDone > group.pending) return false;
    series.set(row.seriesId, group);
  }
  return true;
}

export function guardScheduleReplay(currentReminders, changes) {
  const completions = changes.filter(({ collection, before, after }) =>
    collection === 'reminders' && before?.done === false && after?.done === true && after.seriesId);
  if (!completions.length) return;
  const existing = new Map(currentReminders.map(row => [row.id, row]));
  const inserted = new Set(changes.filter(change =>
    change.collection === 'reminders' && !change.before && change.after).map(change => change.id));
  for (const { after } of completions) {
    if (!existing.get(after.id)?.done) continue;
    const due = nextDueDay(after.due, after.repeatDays);
    const successor = occurrenceId(after.seriesId, due);
    if (inserted.has(successor) && !existing.has(successor)) {
      // Completion reached storage but its response was lost. A teammate then cancelled the next date.
      throw Object.assign(new Error('Дараагийн товыг цуцалсан байна. Товын жагсаалтыг шинэчилнэ үү.'), { code: 'CONFLICT' });
    }
  }
}

export function undoIssue(reminders, current) {
  if (!current.seriesId || !current.done) return '';
  const later = reminders.filter(row => row.seriesId === current.seriesId && row.due > current.due);
  if (later.some(row => row.done)) {
    return 'Энэ цувралын дараагийн тов гүйцэтгэсэн байна. Хамгийн сүүлийн гүйцэтгэлээс эхэлж буцаана уу.';
  }
  const nextDay = nextDueDay(current.due, current.repeatDays);
  if (later.some(row => row.due !== nextDay)) {
    return 'Энэ цувралд хожуу огноотой тов бий. Өмнөх гүйцэтгэлийг буцаахын өмнө тэр товыг шалгана уу.';
  }
  return '';
}

export function setReminderDone(reminders, id, done, completedOn = fieldDateTime().slice(0, 10)) {
  const current = reminders.find(row => row.id === id);
  if (!current) throw issue('Энэ сануулгыг өөрчилсөн байна. Жагсаалтыг шинэчлээд дахин сонгоно уу.');
  if (current.done === done) return reminders;
  if (!validScheduleFields(current) || !calendarDay(completedOn)) throw issue('Сануулгын огноо, давтамжийг шалгана уу.');
  const updated = { ...current, done };
  if (done) updated.completedOn = completedOn;
  else delete updated.completedOn;
  const result = reminders.map(row => row.id === id ? updated : row);
  if (!current.seriesId) return result;

  const nextDay = nextDueDay(current.due, current.repeatDays);
  // A series ends at the last date representable by the stored YYYY-MM-DD format.
  if (!nextDay) return result;
  const nextId = occurrenceId(current.seriesId, nextDay);
  const next = reminders.find(row => row.id === nextId);
  if (next && (next.seriesId !== current.seriesId || next.due !== nextDay)) {
    throw issue('Дараагийн товтой ижил дугаартай бүртгэл байна. Бүртгэлүүдээ шалгана уу.');
  }
  if (done) {
    if (next) return result;
    const subsequent = { ...current, id: nextId, due: nextDay, done: false };
    delete subsequent.completedOn;
    return [...result, subsequent];
  }
  const blocked = undoIssue(reminders, current);
  if (blocked) throw issue(blocked);
  return result.filter(row => row.id !== nextId);
}
