import { statusNames } from './data.js';
import { icon } from './icons.js';
import { openDialog, photoFields, photoReader } from './workflows.js';

const results = {
  low: {
    title: 'Бага түвшний дүн',
    glyph: 'leaf',
    next: 'Тестийн хайрцагт заасан хугацаанд дахин шалгаж, дараагийн дүнтэйгээ харьцуулаарай.',
  },
  medium: {
    title: 'Дунд түвшний дүн',
    glyph: 'info',
    next: 'Өнгөө гэрэл сайтай газар карттай дахин тулгаарай. Бэлдмэл хэрэглэдэг бол савлагаанд заасан хуваариа шалгаарай.',
  },
  high: {
    title: 'Өндөр түвшний дүн',
    glyph: 'alert',
    next: 'Иж бүрдлийн зааврын дагуу давтан шалгаарай. Өндөр дүн давтагдвал дүүргийнхээ байгаль орчны мэргэжилтнээс зөвлөгөө аваарай.',
  },
  unread: {
    title: 'Өнгийг ялгаж чадсангүй',
    glyph: 'scan',
    next: 'Тест, картыг нэг гэрэлд зэрэгцүүлж дахин шалгаарай. Энэ удаагийн дүнг «Тодорхойгүй» гэж хадгалж болно.',
  },
};

function inputStep() {
  const choices = Object.entries(statusNames).map(([key, label]) =>
    `<label class="hs-choice"><input type="radio" name="level" value="${key}">
      <span>${key === 'unread' ? 'Ялгахад хэцүү' : label}</span></label>`
  ).join('');
  return `<section data-hs="input" class="hs-input">
    <div class="wf-mode" role="group" aria-label="Шалгах аргаа сонгох">
      <button type="button" data-hs="photo" aria-pressed="true">${icon('camera', 19)}Зургаар унших</button>
      <button type="button" data-hs="manual" aria-pressed="false">${icon('layers', 19)}Карттай тулгах</button>
    </div>
    ${photoFields}
    <fieldset data-hs="choices" class="hs-choices" hidden disabled>
      <legend>Тестийн өнгө аль түвшинтэй таарч байна вэ?</legend>
      <p>Тестийн хайрцагтай хамт ирсэн өнгөний картыг хараад сонгоорой.</p>
      <div class="hs-choice-grid">${choices}</div>
    </fieldset>
  </section>
  <section data-hs="review" class="hs-review" aria-label="Тестийн дүн" hidden>
    <div class="hs-result">
      <span class="hs-result-icon" data-hs="symbol"></span>
      <div><p data-hs="source"></p><h3 data-hs="title" tabindex="-1"></h3></div>
    </div>
    <p class="hs-next" data-hs="advice"></p>
  </section>`;
}

export function openHouseholdTest({ onSave }) {
  const footer = `<button class="wf-btn" type="button" data-wf="cancel">Цуцлах</button>
    <button class="wf-btn" type="button" data-hs="back" hidden>Буцах</button>
    <button class="wf-btn wf-primary" type="submit" data-hs="submit">Дүн харах</button>`;
  const { dialog, form, save, showError } = openDialog(
    'Тестээ шалгах', 'Хашааны хөрсний тест', 'scan', inputStep(), footer
  );
  dialog.classList.add('hs-dialog');
  const part = key => dialog.querySelector(`[data-hs="${key}"]`);
  const panel = dialog.querySelector('[data-wf="photoPanel"]');
  const cancel = dialog.querySelector('[data-wf="cancel"]');
  const submit = part('submit');
  const choices = part('choices');
  const id = crypto.randomUUID();
  let usePhoto = true;
  let record = null;
  const reader = photoReader(dialog, () => showError(''));

  panel.querySelector('.wf-empty strong').textContent = 'Тест, өнгөний картаа зэрэгцүүлээрэй';
  panel.querySelector('.wf-empty p').textContent = 'Хайрцаг дээрх бага, дунд, өндөр гэсэн гурван өнгийг тесттэйгээ нэг зурагт багтаана.';
  function setMethod(photo) {
    if (usePhoto === photo) return;
    reader.stopCamera();
    showError('');
    usePhoto = photo;
    part('photo').setAttribute('aria-pressed', String(photo));
    part('manual').setAttribute('aria-pressed', String(!photo));
    panel.hidden = !photo;
    choices.disabled = choices.hidden = photo;
  }
  function review(value) {
    const result = results[value.status];
    record = { id, date: new Date().toISOString(), method: value.method, status: value.status, note: value.note };
    part('source').textContent = value.method === 'manual' ? 'Карттай тулгасан дүн' : 'Зургаас уншсан дүн';
    part('title').textContent = result.title;
    part('symbol').innerHTML = icon(result.glyph, 28);
    part('advice').textContent = result.next;
    part('review').dataset.level = value.status;
    part('review').hidden = part('back').hidden = false;
    part('input').hidden = cancel.hidden = true;
    submit.textContent = 'Дүнгээ хадгалах';
    showError('');
    part('title').focus();
  }
  part('photo').onclick = () => setMethod(true);
  part('manual').onclick = () => setMethod(false);
  choices.addEventListener('change', () => showError(''));
  part('back').onclick = () => {
    record = null;
    part('input').hidden = cancel.hidden = false;
    part('review').hidden = part('back').hidden = true;
    submit.textContent = 'Дүн харах';
    showError('');
    if (usePhoto) panel.querySelector('canvas').focus();
    else choices.querySelector('input:checked')?.focus();
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (record) {
      save(() => onSave(record));
      return;
    }
    if (usePhoto) {
      const reading = reader.getReading();
      if (!reading) {
        showError('Эхлээд зураг авч эсвэл оруулж, зурган дээр тестийн өнгө болон картын гурван өнгийг дараарай.');
        return;
      }
      review(reading);
    } else {
      const status = form.elements.level.value;
      if (!status) {
        showError('Өнгөө карттай тулгаад нэг хариу сонгоорой.');
        choices.querySelector('input').focus();
        return;
      }
      review({ method: 'manual', status, note: 'Тестийн өнгийг хайрцаг дээрх карттай тулгав.' });
    }
  };
  const listeners = new AbortController();
  const leave = () => dialog.close();
  window.addEventListener('hashchange', leave, { signal: listeners.signal });
  window.addEventListener('pagehide', () => { reader.stopCamera(); leave(); }, { signal: listeners.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reader.stopCamera();
  }, { signal: listeners.signal });
  dialog.addEventListener('close', () => listeners.abort(), { once: true });
  return dialog;
}
