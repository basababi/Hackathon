const encoder = new TextEncoder();
const zone = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ulaanbaatar', timeZoneName: 'longOffset' });

function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n|[\r\n]/g, '\\n')
    .replace(/[,;]/g, '\\$&').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function foldLine(line) {
  const parts = [];
  let part = '';
  let bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) {
      parts.push(part);
      part = ' ';
      bytes = 1;
    }
    bytes += length;
    part += character;
  }
  return [...parts, part].join('\r\n');
}

const timestamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function offsetAt(instant) {
  const offset = zone.formatToParts(instant).find(part => part.type === 'timeZoneName').value;
  if (offset === 'GMT') return 0;
  const [, sign, hours, minutes, seconds = '0'] = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(offset);
  return (sign === '+' ? 1 : -1) * (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000;
}

function scheduledStart(day) {
  const morning = new Date(day + 'T09:00:00Z');
  if (!Number.isFinite(morning.getTime()) || morning.toISOString().slice(0, 10) !== day) {
    throw new Error('Сануулгын огноо буруу байна.');
  }
  // Resolve the offset at the intended local morning, including historical DST.
  const candidate = new Date(morning.getTime() - offsetAt(morning));
  return timestamp(new Date(morning.getTime() - offsetAt(candidate)));
}

export function calendarText(reminders, sites, now = new Date()) {
  const pending = reminders.filter(reminder => !reminder.done);
  if (!pending.length) return '';
  const locations = new Map(sites.map(site => [site.id, site.name]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TerraSense//Bio Reminders//MN', 'CALSCALE:GREGORIAN'];
  for (const reminder of pending) {
    const title = escapeText(reminder.product + ' хэрэглэх');
    const instructions = escapeText(reminder.product + ' · ' + reminder.dose + ' ' + reminder.unit);
    lines.push('BEGIN:VEVENT', 'UID:' + escapeText(reminder.id) + '@soil-monitor.local',
      'DTSTAMP:' + timestamp(now), 'DTSTART:' + scheduledStart(reminder.due), 'SUMMARY:' + title,
      'LOCATION:' + escapeText(locations.get(reminder.siteId) ?? ''), 'DESCRIPTION:' + instructions,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0S', 'DESCRIPTION:' + instructions, 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function downloadCalendar(reminders, sites) {
  const content = calendarText(reminders, sites);
  if (!content) return false;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'terrasense-reminders.ics';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
