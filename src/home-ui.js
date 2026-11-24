import { readHome, changeHome, householdSummary, subscribeHome } from './home-store.js';
import { todayKey, displayDate } from './data.js';
import { downloadCalendar } from './calendar.js';
import { icon } from './icons.js';
import { esc } from './ui.js';

const sections = [
  ['house', 'leaf', 'Миний хашаа'],
  ['supplies', 'layers', 'Нөөц ба тов'],
  ['journal', 'clipboard', 'Тэмдэглэл'],
];
const amounts = new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 3 });
const longDay = new Intl.DateTimeFormat('mn-MN', {
  timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});
const levels = { low: 'Бага', medium: 'Дунд', high: 'Өндөр', unread: 'Тодорхойгүй' };
const smells = { low: 'Бага', medium: 'Мэдэгдэхүйц', strong: 'Хүчтэй' };
const fills = { low: 'Бага', medium: 'Дунд', high: 'Их' };
const eventNames = { condition: 'Ажиглалт', test: 'Хөрсний тест', use: 'Бэлдмэл хэрэглэсэн', stock: 'Нөөц нэмсэн', emptying: 'Соруулсан', plan: 'Хуваарь тохируулсан' };
const eventIcons = { condition: 'leaf', test: 'scan', use: 'check', stock: 'layers', emptying: 'droplet', plan: 'calendar' };
const units = ['ширхэг', 'мл', 'л', 'г', 'кг'];

function dateOf(input) {
  if (!input) return '';
  return displayDate(input);
}
const quantity = (number, unit) => `${amounts.format(number)} ${esc(unit)}`;
const button = (action, label, glyph, kind = 'plain') => `<button type="button" data-hh="${action}" class="hh-button hh-${kind}">${glyph ? icon(glyph,18) : ''}<span>${label}</span></button>`;
const minititle = (glyph, title, tone = '') => `<div class="hh-minititle"><span class="hh-symbol ${tone}">${icon(glyph,20)}</span><h2>${title}</h2></div>`;
const field = (label, input) => `<label class="hh-field"><span>${label}</span>${input}</label>`;

function dueText(days) {
  if (days === 0) return 'Өнөөдөр хэрэглэх өдөр';
  if (days < 0) return 'Товлосон өдөр өнгөрсөн';
  return days === 1 ? 'Маргааш хэрэглэх өдөр' : `${days} хоногийн дараа`;
}

function conditionCard(summary) {
  const { status, condition, lastTest } = summary;
  const titles = { unknown: 'Төлөвөө тэмдэглээрэй', low: 'Төлөв хэвийн', medium: 'Анхаарч ажиглаарай', high: 'Анхаарах шаардлагатай' };
  const parts = [];
  if (condition) parts.push(`Үнэр ${smells[condition.smell].toLowerCase()}, дүүрэлт ${fills[condition.fill].toLowerCase()}.`);
  if (lastTest) parts.push(`Сүүлийн тестийн дүн ${levels[lastTest.status].toLowerCase()}.`);
  const description = parts.length ? parts.join(' ') : 'Үнэр болон дүүрэлтийг хоёр сонголтоор тэмдэглэж эхлээрэй.';
  return `<section class="hh-status-card hh-status-${status}">
    <div class="hh-status-content"><span class="hh-status-label">${icon('leaf',16)} Хашааны төлөв</span>
    <h2>${titles[status]}</h2><p>${description}</p>
    ${button('condition', 'Ажиглалт тэмдэглэх', 'clipboard', 'light')}</div></section>`;
}

function planCard(state, summary, full = false) {
  const { plan } = state;
  let body;
  if (!plan) {
    body = `<h3>Хуваариа тохируулаарай</h3><p>Бүтээгдэхүүний шошгонд заасан хэмжээ, давтамжийг нэг удаа оруулна.</p>${button('plan', 'Хуваарь үүсгэх', 'plus', 'primary')}`;
  } else {
    const action = summary.canUse
      ? button('use', 'Хийлээ', 'check', 'primary')
      : summary.dueDays <= 0 && state.stock < plan.dose
        ? button('stock', 'Нөөц нэмэх', 'plus', 'primary')
        : button('calendar', 'Хуанлид сануулах', 'calendar', 'soft');
    body = `<h3>${dueText(summary.dueDays)}</h3><p class="hh-plan-dose"><strong>${esc(plan.product)}</strong> · ${quantity(plan.dose,plan.unit)}</p>
      <p class="hh-plan-date">${icon('calendar',16)} ${dateOf(plan.nextDue)} · ${plan.intervalDays} хоног тутам</p>
      ${summary.dueDays <= 0 && state.stock < plan.dose ? '<p class="hh-stock-warning">Нэг удаагийн хэрэглээнд нөөц хүрэхгүй байна.</p>' : ''}
      <div class="hh-card-actions">${action}${full && (summary.canUse || summary.dueDays <= 0) ? button('calendar', 'Хуанлид сануулах', 'calendar') : ''}</div>`;
  }
  return `<section class="hh-card hh-plan-card"><div class="hh-card-top">${minititle('calendar','Хэрэглэх тов','hh-lilac')}${plan ? '<button type="button" class="hh-text-button" data-hh="plan">Засах</button>' : ''}</div>${body}</section>`;
}

function testCard(summary) {
  const last = summary.lastTest;
  return `<section class="hh-card hh-test-card">${minititle('scan','Хашааны хөрсөө шалгах')}
    <p>${last ? `Сүүлийн дүн <strong>${levels[last.status]}</strong> · ${dateOf(last.date)}` : 'Тестийн тууз, өнгөний картыг хамтад нь зураг авна.'}</p>
    ${button('scan','Тест шалгах','camera','soft')}</section>`;
}

function inventoryCard(state, summary) {
  const { plan } = state;
  let detail = 'Хуваарь үүсгэсний дараа үлдэгдлээ бүртгэнэ.';
  if (plan) detail = summary.stockDoses > 0
    ? `Одоогийн хуваариар ${summary.stockDoses} удаа хэрэглэх нөөцтэй.`
    : 'Дараагийн хэрэглээний нөөцөө бэлтгээрэй.';
  return `<section class="hh-card hh-stock-card">${minititle('layers','Миний нөөц','hh-sand')}
    ${plan ? `<p class="hh-quantity">${amounts.format(state.stock)} <small>${esc(plan.unit)}</small></p>` : ''}
    <p>${detail}</p>${button(plan ? 'stock' : 'plan', plan ? 'Нөөц нэмэх' : 'Хуваарь үүсгэх', 'plus','plain')}</section>`;
}

function calendarCaption() {
  return '<p class="hh-caption">Татсан файлыг утасныхаа хуанлид нээж, товлосон өдрийн 09:00 цагт дохио аваарай.</p>';
}

function homeView(state, summary) {
  return `<div class="hh-primary-grid">${conditionCard(summary)}${planCard(state,summary)}</div>
    <div class="hh-secondary-grid">${testCard(summary)}${inventoryCard(state,summary)}</div>
    ${recentActivity(state)}`;
}

function seasonalNote(today) {
  const month = Number(today.slice(5,7));
  const cold = month <= 3 || month >= 11;
  return `<aside class="hh-season">${icon('info',19)}<div><strong>${cold ? 'Хүйтний улиралд' : 'Хадгалалтын нөхцөл'}</strong><p>${cold
    ? 'Бэлдмэлийг хөлдөхөөс хамгаалах шаардлагатай эсэхийг савлагаан дээрээс шалгаарай.'
    : 'Бэлдмэлээ савлагаан дээр заасан хэм, гэрлийн нөхцөлд хадгалаарай.'}</p></div></aside>`;
}

function suppliesView(state, summary) {
  const vendor = state.events.find(e => e.type === 'stock' && e.supplier && (!state.plan || e.product === state.plan.product));
  const phone = vendor?.supplier.match(/(?:^|[^\d])(\d{8})(?:$|[^\d])/u)?.[1];
  return `<div class="hh-secondary-grid">${planCard(state,summary,true)}${inventoryCard(state,summary)}</div>
    ${state.plan ? `<div class="hh-stock-estimate">${icon('clock',19)}<p>Одоогийн үлдэгдэл ойролцоогоор <strong>${amounts.format(Math.round(summary.stockWeeks * 10) / 10)} долоо хоногт</strong> хүрнэ.</p></div>` : ''}
    <div class="hh-secondary-grid"><section class="hh-card">${minititle('pin','Бэлдмэл авах газар','hh-sand')}
    <p>${vendor ? `Сүүлд авсан газар <strong>${esc(vendor.supplier)}</strong>` : 'Нөөц нэмэхдээ дэлгүүрийн нэр, утсыг хадгалж болно.'}</p>
    <div class="hh-card-actions">${phone ? `<a class="hh-button hh-plain" href="tel:${phone}">Залгах · ${phone}</a>` : ''}
    <a class="hh-button hh-plain" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent('био бэлдмэлийн дэлгүүр Улаанбаатар')}" target="_blank" rel="noopener noreferrer">${icon('map',17)} Газрын зургаас хайх</a></div></section>
    <section class="hh-card">${minititle('bell','Утасны сануулга','hh-lilac')}${calendarCaption()}
    ${state.plan ? button('calendar','Товыг хуанлид нэмэх','calendar','plain') : button('plan','Хэрэглэх тов үүсгэх','plus','plain')}</section></div>
    ${seasonalNote(summary.today)}`;
}

function describeEvent(event) {
  switch (event.type) {
    case 'test': return `Тестийн дүн · ${levels[event.status]}`;
    case 'condition': return `Үнэр ${smells[event.smell].toLowerCase()} · Дүүрэлт ${fills[event.fill].toLowerCase()}`;
    case 'use': return `${esc(event.product)} · ${quantity(event.dose,event.unit)}`;
    case 'stock': return `${esc(event.product)} · ${quantity(event.amount,event.unit)}${event.supplier ? ' · '+esc(event.supplier) : ''}`;
    case 'plan': return `${esc(event.product)} · ${event.intervalDays} хоног тутам`;
    case 'emptying': return 'Бүртгэсэн соруулалтын өдөр';
    default: return '';
  }
}

function rows(events) {
  return `<ul class="hh-events">${events.map(event => `<li><span class="hh-event-icon">${icon(eventIcons[event.type] || 'clipboard',18)}</span>
    <div><strong>${eventNames[event.type] || 'Бүртгэл'}</strong><span>${describeEvent(event)}</span></div>
    <time datetime="${esc(event.date)}">${dateOf(event.date)}</time></li>`).join('')}</ul>`;
}

function recentActivity(state) {
  if (!state.events.length) return '';
  return `<section class="hh-card hh-recent"><div class="hh-card-top"><h2>Сүүлийн тэмдэглэл</h2><button class="hh-text-button" type="button" data-page="journal">Бүгдийг харах</button></div>${rows(state.events.slice(0,3))}</section>`;
}

function journalView(state, summary, filter, limit, hasReport) {
  const events = filter === 'all' ? state.events : state.events.filter(e => e.type === filter);
  const intervals = summary.emptyingIntervals;
  return `<div class="hh-metrics">${[
    ['check',summary.onTimeCount,'Товдоо хийсэн удаа'],
    ['scan',summary.testCount,'Хөрсний тест'],
    ['leaf',summary.greenDays,'Арчилгаа хийсэн өдөр'],
  ].map(([glyph,value,label])=>`<div class="hh-card"><span class="hh-symbol">${icon(glyph,18)}</span><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>
    <section class="hh-card hh-service"><div><h2>Соруулалтын бүртгэл</h2><p>${summary.lastEmptying
      ? `Сүүлд ${dateOf(summary.lastEmptying)}-нд соруулсан. Түүнээс хойш ${summary.daysSinceEmptying} хоног өнгөрсөн.`
      : 'Соруулсан өдрөө бүртгэж, соруулалт хоорондын бодит хугацааг харна.'}</p>
    ${intervals.length ? `<p>Сүүлийн хоёр соруулалтын зай <strong>${intervals[intervals.length-1]} хоног</strong>.</p>` : ''}</div>
    ${button('emptying','Огноо бүртгэх','calendar','plain')}</section>
    <section class="hh-card hh-log"><div class="hh-card-top"><h2>Өрхийн түүх</h2><label class="hh-log-filter"><span class="hh-visually-hidden">Тэмдэглэлийн төрөл</span><select data-hh-filter><option value="all">Бүгд</option>${Object.entries(eventNames).map(([key,label])=>`<option value="${key}" ${key===filter?'selected':''}>${label}</option>`).join('')}</select></label></div>
    ${events.length ? rows(events.slice(0,limit)) : '<p class="hh-empty">Одоогоор энэ хэсэгт тэмдэглэл алга.</p>'}
    ${events.length>limit ? button('more','Цааш харах','down','plain'):''}</section>
    ${hasReport ? `<div class="hh-report-action">${button('report','Багт өгөх тайлан','clipboard','plain')}</div>`:''}`;
}

function choiceField(name, title, choices, selected) {
  return `<fieldset class="hh-choices"><legend>${title}</legend><div>${Object.entries(choices).map(([value,label])=>`<label><input type="radio" name="${name}" value="${value}" ${selected===value?'checked':''} required><span>${label}</span></label>`).join('')}</div></fieldset>`;
}

function planForm(state, summary) {
  const p = state.plan;
  return `<p class="hh-form-hint">Хэмжээ, давтамжийг бүтээгдэхүүнийхээ шошгоноос харж оруулна уу.</p>
    ${field('Бэлдмэлийн нэр',`<input name="product" type="text" maxlength="80" value="${esc(p?.product || '')}" required>`)}
    <div class="hh-form-pair">${field('Нэг удаагийн хэмжээ',`<input name="dose" type="number" min="0.001" step="any" inputmode="decimal" value="${p?.dose ?? ''}" required>`)}
    ${field('Нэгж',`<select name="unit">${units.map(u=>`<option ${u===p?.unit?'selected':''}>${u}</option>`).join('')}</select>`)}</div>
    <div class="hh-form-pair">${field('Хэдэн хоног тутам',`<input type="number" name="intervalDays" min="1" step="1" inputmode="numeric" value="${p?.intervalDays ?? ''}" required>`)}
    ${field('Дараагийн тов',`<input type="date" name="nextDue" value="${p?.nextDue || summary.today}" required>`)}</div>
    ${field('Одоо байгаа нийт нөөц',`<input type="number" name="stock" min="0" step="any" inputmode="decimal" value="${state.stock}" required>`)}`;
}

export function mountHousehold(root, {onTest, onExit, onReport}) {
  let active = true, page = 'house', state, filter = 'all', limit = 20, openDialog, saving = false, feedback = '';
  let stamp = '', dateTimer;
  const host = document.createElement('div');
  host.className = 'hh';
  host.innerHTML = '<div class="hh-loading" role="status">Өрхийн бүртгэл нээгдэж байна…</div>';
  root.replaceChildren(host);
  function render(focus = false) {
    if (!active || !state) return;
    const summary = householdSummary(state);
    stamp = summary.today;
    const title = sections.find(item => item[0] === page)[2];
    const navigation = sections.map(([key,glyph,label])=>`<button type="button" data-page="${key}" ${page===key?'aria-current="page"':''}>${icon(glyph,18)}<span>${label}</span></button>`).join('');
    host.innerHTML = `<header class="hh-top"><div class="hh-top-inner"><button type="button" class="hh-brand" data-page="house"><img src="/assets/mark.svg" width="37" height="37" alt=""><span>ХөрсӨрх</span></button>
      <nav class="hh-nav" aria-label="Өрхийн цэс">${navigation}</nav>
      <button type="button" class="hh-switch" data-hh="exit">${icon('panel',17)}<span>Горим солих</span></button></div></header>
      <div class="hh-wrap"><div class="hh-heading"><h1 tabindex="-1">${title}</h1><span>${icon('calendar',16)}${esc(longDay.format(new Date()))}</span></div>
      ${!navigator.onLine?'<p class="hh-offline">Офлайн горим · Тэмдэглэл энэ төхөөрөмжид хадгалагдана.</p>':''}
      <div class="hh-main">${page === 'house' ? homeView(state,summary) : page === 'supplies' ? suppliesView(state,summary) : journalView(state,summary,filter,limit,Boolean(onReport))}</div>
      <footer class="hh-footer">${icon('panel',15)} Өрхийн тэмдэглэл энэ төхөөрөмжид хадгалагдана.</footer></div>
      <div class="hh-notice" role="status" aria-live="polite" ${feedback?'':'hidden'}>${esc(feedback)}</div>`;
    if(focus) host.querySelector('h1').focus({preventScroll:true});
  }

  async function refresh(force = false) {
    try {
      const next = await readHome();
      if(!active || (state && next.revision < state.revision)) return;
      if (force || !state || next.revision !== state.revision || todayKey() !== stamp) { state=next; render(); }
    } catch(error) {
      if (!active) return;
      if (state) tell(error.message);
      else host.innerHTML=`<section class="hh-card hh-load-error"><h1>Өрхийн бүртгэл нээгдсэнгүй</h1><p>${esc(error.message)}</p>${button('retry','Дахин нээх','activity','primary')}${button('exit','Горим солих','panel')}</section>`;
    }
  }
  let noticeTimer;
  function tell(message) {
    feedback=message;
    const status=host.querySelector('.hh-notice');
    if (status) { status.textContent=message; status.hidden=!message; }
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{feedback='';const n=host.querySelector('.hh-notice');if(n)n.hidden=true;},5500);
  }
  async function save(command, message) {
    if (!active) throw new Error('Өрхийн хэсгийг дахин нээнэ үү.');
    const next=await changeHome(command);
    if (active) {
      if (!state || next.revision >= state.revision) state=next;
      render();
      tell(message);
    }
  }
  function closeModal() {
    if (openDialog?.open) openDialog.close();
  }
  function formDialog(action) {
    const current = state;
    const sum = householdSummary(current);
    const plan = current.plan;
    const previous = sum.condition;
    let heading, content;
    if (action === 'condition') {
      heading='Өнөөдрийн ажиглалт';
      content=choiceField('smell','Үнэр хэр байна вэ?',smells,previous?.smell)+choiceField('fill','Дүүрэлт хэр байна вэ?',fills,previous?.fill);
    } else if (action === 'plan') {
      heading='Хэрэглэх хуваарь';content=planForm(current,sum);
    } else if (action === 'stock' && plan) {
      heading='Нөөц нэмэх';
      const supplier=current.events.find(e=>e.type==='stock'&&e.product===plan.product&&e.supplier)?.supplier || '';
      content=`<p class="hh-form-hint">${esc(plan.product)} · Одоо ${quantity(current.stock,plan.unit)} байна.</p>`+
        field(`Нэмэх хэмжээ (${esc(plan.unit)})`,'<input type="number" min="0.001" step="any" name="amount" inputmode="decimal" required>')+
        field('Авсан газар, утас (заавал биш)',`<input name="supplier" maxlength="120" value="${esc(supplier)}">`);
    } else if (action === 'emptying') {
      heading='Соруулсан өдрөө бүртгэх';
      content=field('Соруулсан огноо',`<input type="date" name="date" max="${sum.today}" value="${sum.today}" required>`);
    } else return;
    const id=crypto.randomUUID();
    const trigger=document.activeElement?.dataset.hh;
    const dialog=document.createElement('dialog');
    dialog.className='hh-dialog';
    dialog.setAttribute('aria-labelledby','hh-dialog-heading');
    dialog.innerHTML=`<form><div class="hh-dialog-head"><h2 id="hh-dialog-heading">${heading}</h2><button type="button" aria-label="Хаах" data-dialog-close>${icon('close',20)}</button></div>
      <div class="hh-dialog-body">${content}<p class="hh-form-error" role="alert" hidden></p></div>
      <div class="hh-dialog-foot"><button type="button" class="hh-button hh-plain" data-dialog-close>Болих</button><button type="submit" class="hh-button hh-primary">Хадгалах</button></div></form>`;
    document.body.append(dialog);openDialog=dialog;
    const form=dialog.querySelector('form'), fields=form.elements, err=dialog.querySelector('.hh-form-error');
    let locked=false;
    dialog.querySelectorAll('[data-dialog-close]').forEach(b=>b.onclick=()=>{if(!locked)dialog.close();});
    dialog.addEventListener('cancel',e=>{if(locked)e.preventDefault();});
    dialog.addEventListener('close',()=>{
      dialog.remove(); if(openDialog===dialog)openDialog=null;
      if(active && trigger) host.querySelector(`[data-hh="${trigger}"]`)?.focus({preventScroll:true});
    },{once:true});
    if(action === 'plan' && plan) {
      const resetQuantity=()=>{if(fields.unit.value !== plan.unit || fields.product.value.trim() !== plan.product) fields.stock.value='';};
      fields.unit.addEventListener('change',resetQuantity);
      fields.product.addEventListener('change',resetQuantity);
    }
    form.onsubmit=async e=>{
      e.preventDefault();
      if (locked) return;
      let cmd={type:action,id};
      if(action==='plan')Object.assign(cmd,{product:fields.product.value.trim(),dose:fields.dose.valueAsNumber,unit:fields.unit.value,intervalDays:fields.intervalDays.valueAsNumber,nextDue:fields.nextDue.value,stock:fields.stock.valueAsNumber,expectedRevision:current.revision});
      if(action==='stock')Object.assign(cmd,{planId:plan.id,amount:fields.amount.valueAsNumber,supplier:fields.supplier.value.trim()});
      if(action==='emptying')cmd.date=fields.date.value;
      if(action==='condition')Object.assign(cmd,{smell:fields.smell.value,fill:fields.fill.value});
      locked=true;form.inert=true;err.hidden=true;
      try {await save(cmd,({condition:'Өнөөдрийн ажиглалтыг хадгаллаа.',plan:'Хэрэглэх хуваарийг хадгаллаа.',stock:'Нөөц нэмэгдлээ.',emptying:'Соруулсан өдрийг хадгаллаа.'})[action]);dialog.close();}
      catch(error){err.hidden=false;err.textContent=error.message;}
      finally{locked=false;form.inert=false;}
    };
    dialog.showModal();
  }

  async function onClick(event) {
    const control=event.target.closest('[data-hh],[data-page]');
    if(!control || !host.contains(control))return;
    const action=control.dataset.hh;
    if(action==='exit'){onExit();return;}
    if(action==='retry'){refresh(true);return;}
    if(!state)return;
    if(control.dataset.page){
      page=control.dataset.page;filter='all';limit=20;feedback='';render(true);window.scrollTo({top:0,behavior:'instant'});return;
    }
    try {
      if(action==='report') { await onReport?.(); }
      else if(action==='scan') {
        const id=crypto.randomUUID();
        const d=onTest({onSave:entry=>save({type:'test',...entry,id:entry.id || id},'Тестийн дүнг хадгаллаа.')});
        if (d instanceof HTMLDialogElement) {openDialog=d;d.addEventListener('close',()=>{if(openDialog===d)openDialog=null;},{once:true});}
      } else if(action==='use' && state.plan && !saving) {
        saving=true;control.disabled=true;
        try{await save({type:'use',id:crypto.randomUUID(),planId:state.plan.id,due:state.plan.nextDue},'Хэрэглээг тэмдэглэж, нөөц болон дараагийн товыг шинэчиллээ.');}
        finally{saving=false;control.disabled=false;}
      } else if(action==='calendar' && state.plan) {
        const p=state.plan;
        downloadCalendar([{id:p.id+'-'+p.nextDue,siteId:'home',due:p.nextDue,product:p.product,dose:p.dose,unit:p.unit,done:false}], [{id:'home',name:'Манай хашаа'}]);
        tell('Татсан файлыг утасныхаа хуанлид нээж товоо хадгална уу.');
      } else if(action==='more'){limit+=20;render();}
      else formDialog(action);
    } catch(error) {tell(error.message);await refresh();}
  }

  host.addEventListener('click',onClick);
  host.addEventListener('change',event=>{
    if(event.target.matches('[data-hh-filter]')){filter=event.target.value;limit=20;render();host.querySelector('[data-hh-filter]')?.focus();}
  });
  function visibility(){if(document.visibilityState==='visible')refresh();}
  function connectivity(){render();}
  const unsubscribe=subscribeHome(()=>refresh());
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);
  dateTimer=setInterval(()=>{if(active && document.visibilityState==='visible' && todayKey()!==stamp)refresh();},60000);
  refresh();
  return ()=>{
    active=false;clearInterval(dateTimer);clearTimeout(noticeTimer);unsubscribe?.();closeModal();
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('online',connectivity);window.removeEventListener('offline',connectivity);
    host.remove();
  };
}
