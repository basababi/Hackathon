import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarText, downloadCalendar } from '../src/calendar.js';

const site = { id: 's1', name: 'Хороо 1, А; Б' };
const reminder = { id: 'r1', siteId: 's1', product: 'Бэлдмэл', dose: 1.5, unit: 'л', due: '2028-02-29', done: false };

test('calendar exports pending events for 09:00 Ulaanbaatar with stable UIDs and display alarms', () => {
  const events = [reminder, { ...reminder, id: 'r2', due: '2028-06-01' }, { ...reminder, id: 'done', done: true }];
  const content = calendarText(events, [site], new Date('2026-11-23T15:13:10+08:00'));
  assert.equal(content.match(/BEGIN:VEVENT/g).length, 2);
  assert.equal(content.match(/TRIGGER:PT0S/g).length, 2);
  assert.equal(content.match(/ACTION:DISPLAY/g).length, 2);
  assert.match(content, /DTSTART:20280229T010000Z\r\n/);
  assert.match(content, /DTSTART:20280601T010000Z\r\n/);
  assert.match(content, /DTSTAMP:20261123T071310Z\r\n/);
  assert.match(content, /UID:r1@soil-monitor\.local/);
  assert.doesNotMatch(content, /UID:done/);
  assert.match(content, /END:VCALENDAR\r\n$/);
});

test('calendar preserves UTF-8 text, folds at 75 octets, and escapes user-entered punctuation', () => {
  const product = 'Био\\сорьц;\nбулан, ' + 'Хөрс 🌱 '.repeat(12);
  const content = calendarText([{ ...reminder, product }], [site]);
  for (const line of content.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = content.replaceAll('\r\n ', '');
  assert.ok(unfolded.includes('LOCATION:Хороо 1\\, А\\; Б'));
  assert.ok(unfolded.includes('SUMMARY:Био\\\\сорьц\\;\\nбулан\\, ' + 'Хөрс 🌱 '.repeat(12) + ' хэрэглэх'));
});

test('completed schedules create no download and invalid dates are rejected', () => {
  assert.equal(downloadCalendar([{ ...reminder, done: true }], [site]), false);
  assert.throws(() => calendarText([{ ...reminder, due: '2027-02-29' }], [site]), /огноо/);
});

test('calendar uses historical Ulaanbaatar civil offsets for scheduled dates', () => {
  for (const [due, start] of [
    ['2016-08-12', '20160812T000000Z'],
    ['2016-11-23', '20161123T010000Z'],
    ['1900-01-02', '19000102T015228Z'],
  ]) {
    assert.ok(calendarText([{ ...reminder, due }], [site]).includes('DTSTART:' + start + '\r\n'));
  }
});
