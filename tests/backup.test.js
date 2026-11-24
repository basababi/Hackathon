import test from 'node:test';
import assert from 'node:assert/strict';
import { backupLimit, backupText, parseBackup, planRestore, mergeBackup } from '../src/backup.js';
import { emptyState, personalSnapshot } from '../src/store.js';

const now = new Date('2026-11-23T05:00:00Z');
const site = { id:'A', name:'Хяналтын цэг', lat:47.91, lng:106.89, district:'Чингэлтэй' };
const record = { id:'T', siteId:'A', date:'2026-11-23T07:30:00+08:00', method:'camera', status:'low', note:'Өнгө #F0F0F0', kit:'A1' };
const reminder = { id:'R', siteId:'A', due:'2026-11-23', product:'Бүтээгдэхүүн', dose:2.5, unit:'мл', done:false };
const field = { sites:[site], records:[record], reminders:[reminder] };
function importField(mutate) {
  const envelope = JSON.parse(backupText(field, now));
  mutate(envelope);
  return parseBackup(JSON.stringify(envelope));
}

test('versioned field backup round-trips previous records, decimal quantities and a recurring series', () => {
  const done = { ...reminder, done:true, completedOn:'2026-11-24', repeatDays:7, seriesId:'R' };
  const next = { ...reminder, id:'R:2026-11-30', due:'2026-11-30', seriesId:'R', repeatDays:7 };
  const snapshot = { ...field, reminders:[done,next], records:[record,{...record,id:'old',date:'2026-11-20'}] };
  const result = parseBackup('\uFEFF' + backupText(snapshot, now));
  assert.deepEqual(result.data,snapshot);
  assert.equal(result.exportedAt,now.toISOString());
  assert.deepEqual(parseBackup(backupText(emptyState(),now)).data, emptyState());
});

test('backup rejects unsupported formats, malformed input, extra fields and oversized UTF-8 payloads', () => {
  const cases = [
    [file=>{ file.version=12 },'VERSION'],
    [file=>{ file.format='shared' },'FORMAT'],
    [file=>{ file.exportedAt='2026-02-31T12:00:00Z' },'INVALID'],
    [file=>{ file.data.accessToken='private' },'INVALID'],
    [file=>{ file.data.records[0].image='photo-data' },'INVALID'],
    [file=>{ file.metadata={token:'private'} },'INVALID'],
  ];
  for (const [mutate,code] of cases) assert.throws(()=>importField(mutate),{code});
  assert.throws(()=>parseBackup('{"truncated"'),{code:'INVALID'});
  assert.throws(()=>parseBackup('Ө'.repeat(backupLimit/2+1)),{code:'TOO_LARGE'});
});

test('backup validates entity IDs, nullable patch sentinels, relations, calendar dates and numeric fields', () => {
  const cases = [
    [data=>{data.records.push({...data.records[0]})},'DUPLICATE'],
    [data=>{data.reminders[0].siteId='missing'},'REFERENCE'],
    [data=>{data.sites[0].lat=90.0001},'INVALID'],
    [data=>{data.sites[0].lng='106'},'INVALID'],
    [data=>{data.sites[0].id='a/b'},'INVALID'],
    [data=>{data.records[0].date='2026-02-30T09:20:00Z'},'INVALID'],
    [data=>{data.records[0].date='2026-11-23T24:00:00Z'},'INVALID'],
    [data=>{data.records[0].status='red'},'INVALID'],
    [data=>{data.records[0]=null},'INVALID'],
    [data=>{data.reminders[0].dose=0},'INVALID'],
    [data=>{data.reminders[0].done=0},'INVALID'],
    [data=>{data.reminders[0].due='2025-02-29'},'INVALID'],
    [data=>{data.reminders[0].repeatDays=-2},'INVALID'],
  ];
  for (const [mutate,code] of cases) assert.throws(()=>importField(file=>mutate(file.data)),{code});
});

test('preview counts idempotent rows, preserves unrelated concurrent additions and refuses ID clashes atomically', () => {
  const reordered = {lng:site.lng,lat:site.lat,district:site.district,name:site.name,id:site.id};
  const initial = {sites:[reordered],records:[],reminders:[]};
  const preview = planRestore(initial,field);
  assert.equal(preview.totalNew,2);
  assert.equal(preview.totalMatches,1);
  const current = {...initial,sites:[reordered,{...site,id:'B'}],records:[record]};
  const next = mergeBackup(current,field,preview);
  assert.deepEqual(next.sites,current.sites);
  assert.deepEqual(next.records,[record]);
  assert.deepEqual(next.reminders,[reminder]);
  assert.equal(mergeBackup(next,field,planRestore(next,field)),next);
  assert.deepEqual(current.reminders,[]);
  const changed = {...initial,records:[{...record,status:'high'}]};
  const conflict=planRestore(changed,field);
  assert.deepEqual(conflict.groups.records.conflicts,['T']);
  assert.throws(()=>mergeBackup(changed,field,preview),{code:'CONFLICT'});
  assert.deepEqual(changed.reminders,[]);
  assert.throws(()=>mergeBackup(emptyState(),field,preview),{code:'STALE'});
});

test('recurring schedules cannot acquire two pending occurrences across a restore', () => {
  const pending = {...reminder,seriesId:'R',repeatDays:7};
  const second = {...pending,id:'R:2026-11-30',due:'2026-11-30'};
  const local={...field,reminders:[pending]};
  const incoming={...field,reminders:[second]};
  assert.throws(()=>backupText({...field,reminders:[pending,second]},now),{code:'SCHEDULE'});
  const preview=planRestore(local,incoming);
  assert.ok(preview.scheduleConflict);
  assert.throws(()=>mergeBackup(local,incoming,preview),{code:'CONFLICT'});
});

test('personal recovery does not open storage in the default demo workspace', async () => {
  let called=false;
  await assert.rejects(personalSnapshot(()=>{called=true}),{code:'MODE'});
  assert.equal(called,false);
});
