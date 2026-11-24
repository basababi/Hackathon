import { calendarDay, validScheduleFields } from './schedule.js';

export { calendarDay };

export function allowedFields(item, fields) {
  return item !== null && typeof item === 'object' && !Array.isArray(item) &&
    Object.keys(item).every(key => fields.includes(key));
}

export function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,100}$/.test(value);
}

export function validTimestamp(value) {
  if (typeof value !== 'string' || !calendarDay(value.slice(0, 10))) return false;
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const optionalText = (value, max) => value === undefined || (typeof value === 'string' && value.length <= max);
const fieldsByCollection = {
  sites: ['id', 'name', 'lat', 'lng', 'district'],
  records: ['id', 'siteId', 'date', 'status', 'value', 'note', 'method', 'kit'],
  reminders: ['id', 'siteId', 'due', 'product', 'dose', 'unit', 'done', 'repeatDays', 'seriesId', 'completedOn'],
};

// Null represents a missing or removed entity in the server's optimistic patch protocol.
export function validEntity(collection, item, id) {
  if (!Object.hasOwn(fieldsByCollection, collection) || !validId(id)) return false;
  if (item === null) return true;
  if (!allowedFields(item, fieldsByCollection[collection]) || item.id !== id) return false;
  if (collection === 'sites') {
    return text(item.name, 160) && optionalText(item.district, 160) &&
      Number.isFinite(item.lat) && Math.abs(item.lat) <= 90 &&
      Number.isFinite(item.lng) && Math.abs(item.lng) <= 180;
  }
  if (!validId(item.siteId)) return false;
  if (collection === 'records') {
    return (calendarDay(item.date) || validTimestamp(item.date)) &&
      ['low', 'medium', 'high', 'unread'].includes(item.status) &&
      (item.value === undefined || Number.isFinite(item.value)) &&
      optionalText(item.note, 1600) && optionalText(item.kit, 100) && text(item.method, 120);
  }
  return calendarDay(item.due) && text(item.product, 160) &&
    Number.isFinite(item.dose) && item.dose > 0 && text(item.unit, 32) &&
    typeof item.done === 'boolean' && validScheduleFields(item);
}
