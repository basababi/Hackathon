import { evaluateReading, measurePatch } from './color-reading.js';
import { statusNames as levels, todayKey } from './data.js';
import { icon as sharedIcon } from './icons.js';
import { downloadCalendar } from './calendar.js';
import { fieldDateTime, measurementInstant, nextDueDay, undoIssue } from './schedule.js';
const sampleNames = { test: 'Тестийн өнгө', low: 'Бага', medium: 'Дунд', high: 'Өндөр' };
const icons = {
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7l-4-4L4 15z"/>',
};

function icon(name) {
  if (!icons[name]) return sharedIcon(name, 20);
  return `<svg class="wf-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

function el(parent, name) {
  return parent.querySelector(`[data-wf="${name}"]`);
}

function openDialog(title, subtitle, symbol, body, footer) {
  const dialog = document.createElement('dialog');
  const titleId = `wf-${crypto.randomUUID()}`;
  dialog.className = 'wf-dialog';
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `<form class="wf-form">
    <header class="wf-head"><span class="wf-head-icon">${icon(symbol)}</span><div><h2 id="${titleId}">${title}</h2><p>${subtitle}</p></div>
      <button type="button" class="wf-close" data-wf="close" aria-label="Хаах">${icon('close')}</button></header>
    <div class="wf-body">${body}<p class="wf-error" role="alert" data-wf="error" hidden></p></div>
    <footer class="wf-footer">${footer}</footer></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const error = el(dialog, 'error');
  const showError = (message) => {
    error.textContent = message;
    error.hidden = !message;
    if (message) error.scrollIntoView({ block: 'nearest' });
  };
  const close = () => { if (!form.inert) dialog.close(); };
  el(dialog, 'close').addEventListener('click', close);
  el(dialog, 'cancel')?.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { if (form.inert) event.preventDefault(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  const save = async (action) => {
    if (form.inert) return;
    form.inert = true;
    dialog.setAttribute('aria-busy', 'true');
    showError('');
    try {
      await action();
      dialog.close();
    } catch (error) {
      showError(error?.code && error.message ? error.message : 'Хадгалах үед алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      form.inert = false;
      dialog.removeAttribute('aria-busy');
    }
  };
  dialog.showModal();
  return { dialog, form, save, showError };
}

const siteField = '<label class="wf-field"><span>Хяналтын цэг</span><select name="siteId" required></select></label>';
const cancelButton = '<button class="wf-btn" type="button" data-wf="cancel">Цуцлах</button>';

function fillSites(select, sites, selectedId) {
  for (const site of sites) select.add(new Option(site.name, site.id));
  if (sites.some(site => site.id === selectedId)) select.value = selectedId;
}

function hex(rgb) {
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const photoFields = `<section data-wf="photoPanel" class="wf-photo-panel">
  <div class="wf-media" data-wf="media"><div class="wf-empty" data-wf="placeholder">
    <span class="wf-photo-symbol">${icon('camera')}</span><strong>Тестийн зургаа оруулна уу</strong>
    <p>Тест болон иж бүрдлийн бага, дунд, өндөр түвшний өнгөний лавлахыг нэг гэрэлд хамтад нь авна уу.</p>
    </div><video data-wf="video" muted playsinline hidden></video>
    <canvas data-wf="preview" tabindex="0" role="button" aria-label="Өнгө сонгох зураг. Цэгийг сумтай товчоор зөөж, Enter товчоор сонгоно." hidden></canvas></div>
  <input type="file" accept="image/*" data-wf="file" hidden><input type="file" accept="image/*" capture="environment" data-wf="nativeCamera" hidden>
  <div class="wf-media-actions"><button type="button" class="wf-btn" data-wf="camera">${icon('camera')}Камер нээх</button>
    <button type="button" class="wf-btn" data-wf="upload">${icon('upload')}Зураг оруулах</button></div>
  <div data-wf="sampling" hidden><p class="wf-tip" data-wf="instruction" aria-live="polite"></p><div class="wf-swatches" data-wf="swatches"></div></div>
  <p data-wf="photoMessage" class="wf-tip" role="status" hidden></p>
  </section>`;

function photoReader(dialog, invalidate) {
  const video = el(dialog, 'video');
  const preview = el(dialog, 'preview');
  const raw = document.createElement('canvas');
  const ctx = raw.getContext('2d', { willReadFrequently: true });
  const view = preview.getContext('2d');
  const samples = {};
  const keys = Object.keys(sampleNames);
  const buttons = {};
  let active = 'test', method = '', stream, revision = 0, cursor = { x: 0, y: 0 }, keyboard = false;
  const message = (content) => {
    const node = el(dialog, 'photoMessage');
    node.textContent = content;
    node.hidden = !content;
  };
  const cameraButton = el(dialog, 'camera');
  function stopCamera() {
    revision++;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    preview.hidden = !method;
    el(dialog, 'placeholder').hidden = !!method;
    cameraButton.innerHTML = `${icon('camera')}Камер нээх`;
  }
  function draw() {
    view.drawImage(raw, 0, 0);
    const size = Math.max(5, Math.round(Math.min(raw.width, raw.height) * 0.017));
    for (const [key, point] of Object.entries(samples)) {
      view.beginPath();
      view.arc(point.x, point.y, size, 0, Math.PI * 2);
      view.strokeStyle = '#172a24'; view.lineWidth = Math.max(2, size * 0.35); view.stroke();
      view.strokeStyle = '#fff'; view.lineWidth = Math.max(1, size * 0.17); view.stroke();
      view.font = `bold ${Math.max(10, size * 1.3)}px sans-serif`;
      view.textBaseline = 'bottom'; view.textAlign = 'left';
      const label = sampleNames[key];
      view.lineWidth = Math.max(2, size * 0.25); view.strokeStyle = '#20352d';
      view.strokeText(label, point.x + size, point.y - size / 2);
      view.fillStyle = '#fff'; view.fillText(label, point.x + size, point.y - size / 2);
    }
    if (keyboard) {
      view.beginPath(); view.moveTo(cursor.x - size, cursor.y); view.lineTo(cursor.x + size, cursor.y);
      view.moveTo(cursor.x, cursor.y - size); view.lineTo(cursor.x, cursor.y + size);
      view.lineWidth = 3; view.strokeStyle = 'black'; view.stroke(); view.lineWidth = 1; view.strokeStyle = '#fff'; view.stroke();
    }
  }
  function refresh() {
    for (const key of keys) {
      const button = buttons[key];
      button.setAttribute('aria-pressed', String(key === active));
      button.firstElementChild.style.backgroundColor = samples[key] ? hex(samples[key].rgb) : '';
      button.title = samples[key] ? `${sampleNames[key]} ${hex(samples[key].rgb)}` : sampleNames[key];
    }
    el(dialog, 'instruction').textContent = active ? `Зургаас «${sampleNames[active]}» хэсгийн голд дарна уу.` : 'Өнгөний цэгийг засах бол доорх нэрийг сонгоно уу.';
    draw();
  }
  for (const key of keys) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'wf-swatch';
    button.innerHTML = `<i aria-hidden="true"></i>${sampleNames[key]}`;
    button.onclick = () => { active = key; refresh(); };
    el(dialog, 'swatches').append(button); buttons[key] = button;
  }
  function selectPoint(x, y) {
    if (!active || !method) return;
    samples[active] = measurePatch(ctx, x, y);
    active = keys.find(key => !samples[key]) || '';
    invalidate(); refresh();
    if (!active) {
      const result = evaluateReading(samples);
      if (result.issue) dialog.querySelector('[name=status]').value = 'unread';
      message(result.issue ? 'Тодорхойгүй. ' + result.message : `Хамгийн ойролцоо лавлах өнгө — ${levels[result.status]}. Иж бүрдлийн заавартай тулгаж, түвшнийг доор баталгаажуулна уу.`);
    }
  }
  preview.addEventListener('click', event => {
    const r = preview.getBoundingClientRect();
    const x = Math.max(0, Math.min(raw.width - 1, Math.floor((event.clientX - r.left) / r.width * raw.width)));
    const y = Math.max(0, Math.min(raw.height - 1, Math.floor((event.clientY - r.top) / r.height * raw.height)));
    cursor = { x, y }; keyboard = false; selectPoint(x, y);
  });
  preview.addEventListener('keydown', event => {
    if (!method) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); selectPoint(cursor.x, cursor.y); return;
    }
    const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!offset) return;
    event.preventDefault(); keyboard = true;
    const step = event.shiftKey ? 1 : Math.max(1, Math.round(Math.min(raw.width, raw.height) * 0.02));
    cursor.x = Math.min(raw.width - 1, Math.max(0, cursor.x + offset[0] * step));
    cursor.y = Math.min(raw.height - 1, Math.max(0, cursor.y + offset[1] * step));
    draw();
  });
  function capture(source, width, height, sourceMethod) {
    if (!width || !height) return false;
    const scale = Math.min(1, 1600 / Math.max(width, height));
    raw.width = preview.width = Math.max(1, Math.round(width * scale));
    raw.height = preview.height = Math.max(1, Math.round(height * scale));
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, raw.width, raw.height);
    ctx.drawImage(source, 0, 0, raw.width, raw.height);
    method = sourceMethod; stopCamera(); invalidate(); message('');
    keys.forEach(key => delete samples[key]); active = 'test';
    cursor = { x: Math.floor(raw.width / 2), y: Math.floor(raw.height / 2) }; keyboard = false;
    el(dialog, 'sampling').hidden = false; refresh();
    return true;
  }
  async function loadFile(input, sourceMethod) {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024 || (file.type && !file.type.startsWith('image/'))) {
      message('20 МБ хүртэлх зургийн файл сонгоно уу.'); return;
    }
    stopCamera(); const version = revision;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (dialog.open && revision === version) capture(image, image.naturalWidth, image.naturalHeight, sourceMethod);
    } catch { if (revision === version) message('Зургийг уншиж чадсангүй. JPEG эсвэл PNG зураг оруулна уу.'); }
    finally { URL.revokeObjectURL(url); }
  }
  const file = el(dialog, 'file'), nativeCamera = el(dialog, 'nativeCamera');
  el(dialog, 'upload').onclick = () => file.click();
  file.onchange = () => loadFile(file, 'upload');
  nativeCamera.onchange = () => loadFile(nativeCamera, 'camera');
  cameraButton.onclick = async () => {
    if (stream) {
      if (!capture(video, video.videoWidth, video.videoHeight, 'camera')) message('Камерын дүрс гарсны дараа зураг авна уу.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { nativeCamera.click(); return; }
    stopCamera(); const version = revision;
    message('Камерын холболтыг хүлээж байна…');
    try {
      const live = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      if (!dialog.open || revision !== version) { live.getTracks().forEach(track => track.stop()); return; }
      stream = live; video.srcObject = live; video.hidden = false; preview.hidden = true;
      el(dialog, 'placeholder').hidden = true; await video.play();
      if (revision !== version) return;
      cameraButton.innerHTML = `${icon('camera')}Зураг авах`; message('Тест, өнгөний лавлахаа кадрт багтааж зураг авна уу.');
    } catch {
      if (revision === version) { stopCamera(); message('Камерт хандах боломжгүй байна. Камерын зөвшөөрлөө шалгах эсвэл зураг оруулна уу.'); }
    }
  };
  dialog.addEventListener('close', stopCamera, { once: true });
  return { stopCamera, getReading() {
    if (stream || !method || !keys.every(key => samples[key])) return null;
    const values = keys.map(key => `${sampleNames[key]} ${hex(samples[key].rgb)}`).join(', ');
    const result = evaluateReading(samples);
    return { method, issue: result.issue, note: `${values}. Зургийн үнэлгээ — ${levels[result.status]}. ${result.message}`.trim() };
  } };
}

export function openTest({ sites = [], siteId, kitNames = [], onSave }) {
  const body = `<div class="wf-mode" role="group" aria-label="Бүртгэх арга">
    <button type="button" data-wf="usePhoto" aria-pressed="true">${icon('camera')}Зургаар унших</button>
    <button type="button" data-wf="useManual" aria-pressed="false">${icon('edit')}Гараар оруулах</button></div>
    ${photoFields}
    ${siteField}
    <fieldset data-wf="newSite" class="wf-new-site" hidden disabled>
      <label class="wf-field"><span>Хяналтын цэгийн нэр</span><input type="text" name="siteName" maxlength="80" required></label>
      <label class="wf-field"><span>Дүүрэг <small>Заавал биш</small></span><input type="text" name="district" maxlength="80" placeholder="Жишээ нь Чингэлтэй"></label>
      <div class="wf-pair">
        <label class="wf-field"><span>Өргөрөг</span><input type="number" step="any" min="-90" max="90" name="lat" placeholder="47.9200" required></label>
        <label class="wf-field"><span>Уртраг</span><input type="number" step="any" min="-180" max="180" name="lng" placeholder="106.9200" required></label>
      </div><button type="button" class="wf-text-btn" data-wf="locate">${icon('pin')}Одоогийн байршил авах</button>
      <span class="wf-tip" role="status" data-wf="geoStatus"></span>
    </fieldset>
    <label class="wf-field"><span>Хэмжсэн огноо, цаг <small>Улаанбаатар</small></span>
      <input type="datetime-local" name="measuredAt" required></label>
    <label class="wf-field"><span>Бохирдлын түвшин</span><select name="status" required><option value="">Түвшин сонгох</option></select></label>
    <label class="wf-field"><span>Тестийн иж бүрдэл <small>Заавал биш</small></span><input name="kit" type="text" maxlength="100" placeholder="Иж бүрдлийн нэр, загвар"></label>
    <p class="wf-field-hint">Давтан хэмжилтийг харьцуулахдаа ижил иж бүрдлийн нэрийг сонгоно уу.</p>
    <label class="wf-field"><span>Тэмдэглэл <small>Заавал биш</small></span>
      <textarea name="note" rows="2" maxlength="500" placeholder="Сорьц авсан орчин, талбайн ажиглалт…"></textarea></label>`;
  const controls = cancelButton + '<button class="wf-btn wf-primary" type="submit">Үр дүн хадгалах</button>';
  const { dialog, form, showError, save } = openDialog('Шинэ био-тест', 'Тестийн үр дүнг хяналтын цэгтэй холбон бүртгэнэ.', 'flask', body, controls);
  const fields = form.elements;
  const knownKits = document.createElement('datalist');
  knownKits.id = 'kits-' + crypto.randomUUID();
  for (const name of kitNames) knownKits.append(new Option(name, name));
  fields.kit.setAttribute('list', knownKits.id);
  fields.kit.after(knownKits);
  const picker = fields.siteId;
  if (sites.length) picker.add(new Option('Хяналтын цэгээ сонгоно уу', ''));
  const newSiteOption = '#new-site';
  fillSites(picker, sites, siteId);
  picker.add(new Option('＋ Шинэ хяналтын цэг', newSiteOption));
  const newSite = el(dialog, 'newSite');
  const syncSite = () => { newSite.disabled = newSite.hidden = picker.value !== newSiteOption; };
  picker.onchange = syncSite; syncSite();
  const locate = el(dialog, 'locate'), geoStatus = el(dialog, 'geoStatus');
  locate.onclick = () => {
    if (!navigator.geolocation) { geoStatus.textContent = 'Координатыг гараар оруулна уу.'; return; }
    locate.disabled = true; geoStatus.textContent = 'Байршил тогтоож байна…';
    navigator.geolocation.getCurrentPosition(position => {
      fields.lat.value = position.coords.latitude.toFixed(6);
      fields.lng.value = position.coords.longitude.toFixed(6);
      locate.disabled = false; geoStatus.textContent = 'Одоогийн байршлыг орууллаа.';
    }, () => {
      locate.disabled = false; geoStatus.textContent = 'Байршил авах боломжгүй байна. Координатыг гараар оруулна уу.';
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  };
  for (const [value, label] of Object.entries(levels)) fields.status.add(new Option(label, value));
  const recordId = crypto.randomUUID(), newSiteId = crypto.randomUUID();
  const openedAt = new Date();
  fields.measuredAt.value = fieldDateTime(openedAt);
  let photoMode = true;
  const reader = photoReader(dialog, () => { fields.status.value = ''; });
  function mode(value) {
    if (value === photoMode) return;
    photoMode = value;
    reader.stopCamera(); showError(''); fields.status.value = '';
    el(dialog, 'usePhoto').setAttribute('aria-pressed', String(value));
    el(dialog, 'useManual').setAttribute('aria-pressed', String(!value));
    el(dialog, 'photoPanel').hidden = !value;
  }
  el(dialog, 'usePhoto').onclick = () => mode(true);
  el(dialog, 'useManual').onclick = () => mode(false);
  form.onsubmit = event => {
    event.preventDefault();
    const reading = photoMode ? reader.getReading() : { method: 'manual', note: '' };
    if (!reading) { showError('Зураг дээр тест болон гурван лавлах өнгийг сонгоно уу.'); return; }
    if (reading.issue && fields.status.value !== 'unread') {
      fields.status.value = 'unread';
      showError('Энэ зурагт тодорхой ангилал өгөх боломжгүй. Тодорхойгүй дүнг хадгалах эсвэл цэгүүдийг дахин сонгоно уу.');
      return;
    }
    let created;
    if (picker.value === newSiteOption) {
      const name = fields.siteName.value.trim();
      if (!name) { fields.siteName.focus(); showError('Хяналтын цэгийн нэрийг оруулна уу.'); return; }
      created = { id: newSiteId, name, lat: fields.lat.valueAsNumber, lng: fields.lng.valueAsNumber };
      if (fields.district.value.trim()) created.district = fields.district.value.trim();
    }
    const measuredAt = measurementInstant(fields.measuredAt.value, openedAt);
    if (!measuredAt) {
      fields.measuredAt.focus();
      showError('Хэмжилтийн бодит огноо, цагийг оруулна уу. Ирээдүйн цаг сонгох боломжгүй.');
      return;
    }
    const record = {
      id: recordId, siteId: created?.id || picker.value, date: measuredAt,
      status: fields.status.value, method: reading.method,
      note: [fields.note.value.trim(), reading.note].filter(Boolean).join('\n'),
    };
    if (created) record.newSite = created;
    if (fields.kit.value.trim()) record.kit = fields.kit.value.trim();
    save(() => onSave(record));
  };
  return dialog;
}

export function openReminder({ sites = [], siteId, onSave }) {
  const body = `${siteField}<p class="wf-tip" data-wf="siteHint" hidden>Эхлээд био-тест бүртгэхдээ хяналтын цэг үүсгэнэ үү.</p>
    <label class="wf-field"><span>Био-бэлдмэлийн нэр</span><input name="product" maxlength="80" placeholder="Савлагаан дээрх нэр" required></label>
    <div class="wf-pair"><label class="wf-field"><span>Хэрэглэх хэмжээ</span>
      <input type="number" step="any" min="0" name="dose" inputmode="decimal" required></label>
      <label class="wf-field"><span>Нэгж</span><select name="unit"><option>мл</option><option>л</option><option>г</option><option>кг</option><option>ширхэг</option></select></label></div>
    <p class="wf-field-hint">Бүтээгдэхүүний шошгонд заасан хэмжээг оруулна уу.</p>
    <label class="wf-field"><span>Хэрэглэх огноо</span><input type="date" name="due" min="0001-01-01" max="9999-12-31" required></label>
    <label class="wf-repeat"><input type="checkbox" name="recurs"><span>Товыг давтах</span></label>
    <fieldset class="wf-new-site" data-wf="repeatSettings" hidden disabled>
      <label class="wf-field"><span>Давтамж (хоног)</span>
        <input type="number" min="1" step="1" inputmode="numeric" name="repeatDays" required></label>
      <p class="wf-tip" data-wf="repeatPreview" aria-live="polite"></p>
    </fieldset>`;
  const controls = cancelButton + '<button class="wf-btn wf-primary" data-wf="submit" type="submit">Сануулга хадгалах</button>';
  const { dialog, form, save, showError } = openDialog('Сануулга нэмэх', 'Био-бэлдмэл хэрэглэх өдөр, хэмжээг товлоно.', 'bell', body, controls);
  const fields = form.elements;
  fields.siteId.add(new Option('Хяналтын цэгээ сонгоно уу', ''));
  fillSites(fields.siteId, sites, siteId);
  if (!sites.length) {
    el(dialog, 'siteHint').hidden = false; el(dialog, 'submit').disabled = true;
  }
  const reminderId = crypto.randomUUID();
  fields.due.value = todayKey();
  const repeat = el(dialog, 'repeatSettings');
  function updateRepeat() {
    repeat.disabled = repeat.hidden = !fields.recurs.checked;
    const next = nextDueDay(fields.due.value, fields.repeatDays.valueAsNumber);
    el(dialog, 'repeatPreview').textContent = next
      ? 'Энэ товыг гүйцэтгэхэд ' + next.replaceAll('-', '.') + '-нд дараагийн тов үүснэ.'
      : 'Бүтээгдэхүүний зааварт заасан давтамжийг хоногоор оруулна уу.';
  }
  fields.recurs.onchange = updateRepeat;
  fields.repeatDays.oninput = updateRepeat;
  fields.due.oninput = updateRepeat;
  form.onsubmit = event => {
    event.preventDefault();
    const product = fields.product.value.trim(), dose = fields.dose.valueAsNumber;
    if (!product) { fields.product.focus(); showError('Био-бэлдмэлийн нэрийг оруулна уу.'); return; }
    if (!Number.isFinite(dose) || dose <= 0) { fields.dose.focus(); showError('Хэрэглэх хэмжээ тэгээс их байх ёстой.'); return; }
    const reminder = {
      id: reminderId, siteId: fields.siteId.value, due: fields.due.value,
      product, dose, unit: fields.unit.value, done: false,
    };
    if (fields.recurs.checked) {
      const interval = fields.repeatDays.valueAsNumber;
      if (!nextDueDay(reminder.due, interval)) {
        fields.repeatDays.focus();
        showError('Дараагийн тов нь хүчинтэй огноонд багтах эерэг бүхэл тоо оруулна уу.');
        return;
      }
      reminder.repeatDays = interval;
      reminder.seriesId = reminderId;
    }
    save(() => onSave(reminder));
  };
  return dialog;
}

export function openReminderDetail({ reminder, site, reminders = [], onToggle, onDelete }) {
  const body = `<dl class="wf-details"><div><dt>Хяналтын цэг</dt><dd data-wf="site"></dd></div>
    <div><dt>Био-бэлдмэл</dt><dd data-wf="product"></dd></div>
    <div><dt>Хэрэглэх хэмжээ</dt><dd data-wf="amount"></dd></div>
    <div><dt>Хэрэглэх огноо</dt><dd data-wf="date"></dd></div>
    <div><dt>Төлөв</dt><dd data-wf="state"></dd></div>
    <div data-wf="completedRow" hidden><dt>Гүйцэтгэсэн огноо</dt><dd data-wf="completedDate"></dd></div>
    <div data-wf="intervalRow" hidden><dt>Давтамж</dt><dd data-wf="interval"></dd></div></dl>
    <p class="wf-schedule-note" data-wf="scheduleNote" aria-live="polite" hidden></p>
    <button class="wf-text-btn" type="button" data-wf="calendar">${icon('calendar')}Календарьт нэмэх (.ics)</button>
    <p class="wf-field-hint">Файлыг календарьтаа оруулбал товлосон өдрийн 09:00 цагт (Улаанбаатар) сануулна.</p>`;
  const controls = `<button class="wf-btn wf-danger" type="button" data-wf="delete">Устгах</button>
    <button class="wf-btn wf-primary" type="button" data-wf="toggle"></button>`;
  const { dialog, form, save } = openDialog('Био-бэлдмэлийн сануулга', 'Товлосон ажил, гүйцэтгэлийн мэдээлэл.', 'calendar', body, controls);
  form.onsubmit = event => event.preventDefault();
  el(dialog, 'site').textContent = site?.name || 'Хяналтын цэг тодорхойгүй';
  el(dialog, 'product').textContent = reminder.product;
  el(dialog, 'amount').textContent = `${reminder.dose} ${reminder.unit}`;
  el(dialog, 'date').textContent = reminder.due.replaceAll('-', '.');
  el(dialog, 'state').textContent = reminder.done ? 'Гүйцэтгэсэн' : 'Хүлээгдэж буй';
  const calendar = el(dialog, 'calendar');
  calendar.hidden = calendar.nextElementSibling.hidden = !!reminder.done;
  calendar.onclick = () => downloadCalendar([reminder], site ? [site] : []);
  const toggle = el(dialog, 'toggle'), del = el(dialog, 'delete');
  if (reminder.completedOn) {
    el(dialog, 'completedRow').hidden = false;
    el(dialog, 'completedDate').textContent = reminder.completedOn.replaceAll('-', '.');
  }
  const note = el(dialog, 'scheduleNote');
  if (reminder.repeatDays) {
    el(dialog, 'intervalRow').hidden = false;
    el(dialog, 'interval').textContent = reminder.repeatDays + ' хоног тутам';
    const next = nextDueDay(reminder.due, reminder.repeatDays);
    const blocked = undoIssue(reminders, reminder);
    if (blocked) {
      toggle.disabled = true;
      note.textContent = blocked;
    } else if (reminder.done) {
      const pendingNext = reminders.some(row => row.seriesId === reminder.seriesId && row.due === next && !row.done);
      if (pendingNext) note.textContent = 'Гүйцэтгэлийг буцаахад дараагийн хүлээгдэж буй тов цуцлагдана.';
    } else if (next) {
      note.textContent = 'Гүйцэтгэлийг тэмдэглэхэд дараагийн тов ' + next.replaceAll('-', '.') + '-нд үүснэ.';
    }
    note.hidden = !note.textContent;
  }
  toggle.textContent = reminder.done ? 'Гүйцэтгэлийг буцаах' : 'Гүйцэтгэсэн гэж тэмдэглэх';
  toggle.hidden = !onToggle; del.hidden = !onDelete;
  toggle.onclick = () => save(() => onToggle(reminder));
  del.onclick = () => {
    del.textContent = 'Устгахыг батлах';
    note.textContent = reminder.repeatDays && !reminder.done
      ? 'Хүлээгдэж буй энэ товыг устгахад давтамж дуусна. Өмнөх гүйцэтгэлүүд түүхэнд үлдэнэ.'
      : 'Сонгосон товыг бүртгэлээс устгана.';
    note.hidden = false;
    del.onclick = () => save(() => onDelete(reminder));
  };
  return dialog;
}
