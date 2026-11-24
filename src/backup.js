import { todayKey } from './data.js';
import { icon } from './icons.js';
import { allowedFields, validEntity, validId, validTimestamp } from './schema.js';
import { validScheduleSeries } from './schedule.js';
import { isDemo, isShared, personalSnapshot, sameEntity } from './store.js';
import { esc, modal, notify } from './ui.js';

const collections = ['sites', 'records', 'reminders'];
const names = { sites: 'Хяналтын цэг', records: 'Био-тест', reminders: 'Сануулга' };
const format = 'terrasense.personal-backup';
const version = 1;
export const backupLimit = 16 * 1024 * 1024;
const sizeMessage = 'Нөөц файлын дээд хэмжээ 16 МиБ. Жижиг файл сонгоно уу.';

function issue(code, message) {
  return Object.assign(new Error(message), { code });
}

function checkState(state) {
  if (!allowedFields(state, collections) || !collections.every(key => Array.isArray(state[key]))) {
    throw issue('INVALID', 'Нөөц файлд цэг, био-тест, сануулгын гурван жагсаалт бүрэн байх ёстой.');
  }
  const siteIds = new Set();
  for (const key of collections) {
    const ids = key === 'sites' ? siteIds : new Set();
    for (const [index, row] of state[key].entries()) {
      const rowName = names[key] + ', ' + (index + 1) + '-р мөр';
      if (!validId(row?.id) || !validEntity(key, row, row.id)) {
        throw issue('INVALID', rowName + ' дэх утга эсвэл талбар буруу байна.');
      }
      if (ids.has(row.id)) throw issue('DUPLICATE', rowName + ' дахь дугаар файл дотор давхардсан байна.');
      if (key !== 'sites' && !siteIds.has(row.siteId)) {
        throw issue('REFERENCE', rowName + ' дэх хяналтын цэг файлд байхгүй байна.');
      }
      ids.add(row.id);
    }
  }
  if (!validScheduleSeries(state.reminders)) {
    throw issue('SCHEDULE', 'Файл доторх давтамжтай сануулгын товууд хоорондоо зөрж байна.');
  }
}

function checkSize(json) {
  if (json.length > backupLimit || new TextEncoder().encode(json).byteLength > backupLimit) {
    throw issue('TOO_LARGE', sizeMessage);
  }
}

export function backupText(state, now = new Date()) {
  checkState(state);
  const json = JSON.stringify({ format, version, exportedAt: now.toISOString(), data: state });
  checkSize(json);
  return json;
}

export function parseBackup(json) {
  checkSize(json);
  let file;
  try { file = JSON.parse(json.replace(/^\uFEFF/, '')); }
  catch { throw issue('INVALID', 'JSON файлыг уншиж чадсангүй. TerraSense нөөц файл сонгоно уу.'); }
  if (file?.format !== format) throw issue('FORMAT', '«Миний бүртгэл» орчноос татсан TerraSense нөөц файл сонгоно уу.');
  if (file.version !== version) throw issue('VERSION', 'Нөөц файлын энэ хувилбарыг нээхийн тулд аппыг шинэчилнэ үү.');
  if (!allowedFields(file, ['format', 'version', 'exportedAt', 'data']) || !validTimestamp(file.exportedAt)) {
    throw issue('INVALID', 'Файлын бүтэц эсвэл нөөцөлсөн огноо буруу байна.');
  }
  checkState(file.data);
  return file;
}

export function planRestore(current, incoming) {
  const groups = {};
  let totalNew = 0;
  let totalConflicts = 0;
  let totalMatches = 0;
  for (const key of collections) {
    const existing = new Map(current[key].map(row => [row.id, row]));
    const additions = new Set();
    const conflicts = [];
    let matches = 0;
    for (const row of incoming[key]) {
      if (!existing.has(row.id)) additions.add(row.id);
      else if (sameEntity(existing.get(row.id), row)) matches++;
      else conflicts.push(row.id);
    }
    groups[key] = { additions, matches, conflicts };
    totalNew += additions.size;
    totalConflicts += conflicts.length;
    totalMatches += matches;
  }
  const combinedReminders = current.reminders.concat(
    incoming.reminders.filter(row => groups.reminders.additions.has(row.id))
  );
  const scheduleConflict = !validScheduleSeries(combinedReminders);
  return { groups, totalNew, totalConflicts, totalMatches, scheduleConflict };
}

export function mergeBackup(current, incoming, preview) {
  const latest = planRestore(current, incoming);
  if (latest.scheduleConflict) {
    throw issue('CONFLICT', 'Файл болон төхөөрөмжид нэг цувралын сануулгын товууд зөрж байна. Сануулгын түүхийг шалгана уу.');
  }
  if (latest.totalConflicts) {
    throw issue('CONFLICT', 'Ижил дугаартай бүртгэлийн утга зөрсөн байна. Файл болон төхөөрөмжийн бүртгэлийг шалгана уу.');
  }
  if (!latest.totalNew) return current;
  const next = {};
  for (const key of collections) {
    const { additions } = latest.groups[key];
    for (const id of additions) {
      if (!preview.groups[key].additions.has(id)) {
        throw issue('STALE', 'Урьдчилж шалгаснаас хойш төхөөрөмжийн бүртгэл өөрчлөгдсөн байна. Шинэ тоогоор дахин шалгана уу.');
      }
    }
    next[key] = current[key].concat(incoming[key].filter(row => additions.has(row.id)));
  }
  return next;
}

function download(json) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'TerraSense-' + todayKey() + '-backup.json';
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function previewMarkup(file, plan) {
  const prettyDate = new Intl.DateTimeFormat('mn-MN', {
    timeZone: 'Asia/Ulaanbaatar', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(file.exportedAt));
  const rows = collections.map(key => {
    const { additions, matches, conflicts } = plan.groups[key];
    return `<tr><th scope="row">${names[key]}</th><td>${additions.size}</td><td>${matches}</td><td>${conflicts.length}</td></tr>`;
  }).join('');
  const conflictLabels = collections.flatMap(key =>
    plan.groups[key].conflicts.slice(0, 3).map(id => names[key] + ' · ' + id)
  ).slice(0, 3);
  const conflictNote = plan.totalConflicts
    ? `<p class="backup-warning">Утга нь зөрсөн ${plan.totalConflicts} бүртгэл байна. Дугаарыг файлаас шалгана уу.</p>
       <ul class="backup-conflicts">${conflictLabels.map(label => '<li>' + esc(label) + '</li>').join('')}</ul>`
    : '';
  return `<p class="sub">Нөөцөлсөн хугацаа · ${esc(prettyDate)}</p>
    <table class="backup-counts"><thead><tr><th scope="col">Төрөл</th><th scope="col">Шинэ</th><th scope="col">Ижил</th><th scope="col">Зөрчил</th></tr></thead>
    <tbody>${rows}</tbody></table>${conflictNote}${plan.scheduleConflict ? '<p class="backup-warning">Файл болон төхөөрөмжийн давтамжтай сануулгын товууд зөрж байна.</p>' : ''}`;
}

export function openBackup({ onRestore } = {}) {
  if (isShared() || isDemo()) {
    notify('Нөөц хуулбар ашиглахын тулд «Миний бүртгэл» орчныг нээнэ үү.');
    return;
  }
  const dialog = modal('Нөөц хуулбар', `<div class="backup-panel">
    <section><h3>Файлд хадгалах</h3><p class="sub">Цэг, био-тест, сануулгаа нэг JSON файлд татна.</p>
    <button type="button" class="button outline" data-backup="download">${icon('download', 17)} Нөөц файл татах</button></section>
    <section><h3>Файлаас сэргээх</h3><p class="sub">Эхлээд файлын агуулгыг шалгана. Зөвшөөрөхөд шинэ бүртгэлүүд нэмэгдэнэ.</p>
    <input type="file" accept=".json,application/json" data-backup="file" hidden>
    <button type="button" class="button outline" data-backup="choose">Файл сонгох</button>
    <div data-backup="preview" class="backup-preview"></div>
    <p data-backup="message" role="status" aria-live="polite" class="sub"></p>
    <button type="button" class="button primary" data-backup="restore" hidden></button></section></div>`, 'download');
  const part = key => dialog.querySelector('[data-backup="' + key + '"]');
  const restoreButton = part('restore');
  const input = part('file');
  let file = null;
  let preview = null;
  let busy = false;

  function feedback(text, error = false) {
    const message = part('message');
    message.textContent = text;
    message.classList.toggle('backup-warning', error);
  }
  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    for (const button of dialog.querySelectorAll('button')) button.disabled = value;
    if (!value && preview) restoreButton.disabled = !preview.totalNew || Boolean(preview.totalConflicts) || preview.scheduleConflict;
  }
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('click', event => {
    if (busy && event.target === dialog) event.stopImmediatePropagation();
  }, true);

  async function refreshPreview() {
    preview = planRestore(await personalSnapshot(), file.data);
    part('preview').innerHTML = previewMarkup(file, preview);
    restoreButton.textContent = preview.totalNew + ' бүртгэл нэмэх';
    restoreButton.hidden = !preview.totalNew || Boolean(preview.totalConflicts) || preview.scheduleConflict;
    if (!preview.totalNew && !preview.totalConflicts && !preview.scheduleConflict) feedback('Файлын бүх бүртгэл төхөөрөмжид байна.');
  }
  part('download').onclick = async () => {
    setBusy(true);
    try {
      download(backupText(await personalSnapshot()));
      feedback('Нөөц файлыг татахаар илгээлээ.');
    } catch (error) { feedback(error.message, true); }
    finally { setBusy(false); }
  };
  part('choose').onclick = () => input.click();
  input.onchange = async () => {
    const selected = input.files[0];
    if (!selected) return;
    input.value = '';
    file = preview = null;
    restoreButton.hidden = true;
    part('preview').replaceChildren();
    setBusy(true);
    feedback('');
    try {
      if (selected.size > backupLimit) throw issue('TOO_LARGE', sizeMessage);
      file = parseBackup(await selected.text());
      await refreshPreview();
    } catch (error) { feedback(error.message, true); }
    finally { setBusy(false); }
  };
  restoreButton.onclick = async () => {
    if (busy || !file || !preview || preview.totalConflicts || preview.scheduleConflict || !preview.totalNew) return;
    setBusy(true);
    try {
      let added = 0;
      const result = await personalSnapshot(current => {
        const next = mergeBackup(current, file.data, preview);
        added = collections.reduce((sum, key) => sum + next[key].length - current[key].length, 0);
        return next;
      });
      dialog.close();
      onRestore?.(result);
      notify(added + ' бүртгэл сэргээгдлээ.');
    } catch (error) {
      if (error.code === 'STALE' || error.code === 'CONFLICT') {
        try { await refreshPreview(); }
        catch { restoreButton.hidden = true; }
      }
      feedback(error.message, true);
    } finally { setBusy(false); }
  };
  return dialog;
}
