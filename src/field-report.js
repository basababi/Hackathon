import {todayKey, displayDate} from "./data.js";
import {icon} from "./icons.js";

const districts = ["Багануур","Багахангай","Баянгол","Баянзүрх","Налайх","Сонгинохайрхан","Сүхбаатар","Хан-Уул","Чингэлтэй"];
const levels = {unknown:"Тест хийгээгүй",unread:"Тодорхойгүй",low:"Бага",medium:"Дунд",high:"Өндөр"};
const kind = "terrasense.household-summary.v1";
const expected = ["format","id","revision","exportedAt","district","tests","uses","level"];
const count = n => Number.isSafeInteger(n) && n >= 0;

export function validateReport(row) {
  if (!row || expected.some(key => !Object.hasOwn(row,key)) ||
      Object.keys(row).length !== expected.length || row.format !== kind ||
      !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(row.id) ||
      !count(row.revision) || !count(row.tests) || !count(row.uses) ||
      (row.district !== "" && !districts.includes(row.district)) ||
      !Object.hasOwn(levels,row.level) || (row.tests===0) !== (row.level==="unknown") ||
      typeof row.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.exportedAt) ||
      !Number.isFinite(Date.parse(row.exportedAt)) || new Date(row.exportedAt).toISOString() !== row.exportedAt) {
    throw new Error("ХөрсӨрхийн нэгтгэлийн файл сонгоно уу. Файлын хэлбэр эсвэл утга тохирохгүй байна.");
  }
  return row;
}
export function makeReport({id,revision,summary},district="",now=new Date()) {
  return validateReport({format:kind,id,revision,exportedAt:now.toISOString(),district,
    tests:summary.testCount,uses:summary.useCount,level:summary.lastTest?.status ?? "unknown"});
}
export function mergeReports(stored, incoming) {
  const byId = new Map(stored.map(row => [row.id,row]));
  for (const report of incoming) {
    validateReport(report);
    const prev = byId.get(report.id);
    if (!prev || report.revision>prev.revision ||
        (report.revision===prev.revision && report.exportedAt>prev.exportedAt)) byId.set(report.id,report);
  }
  return [...byId.values()];
}
function dialog(title,body) {
  const el=document.createElement("dialog");
  el.className="fr-dialog";
  el.setAttribute("aria-label",title);
  el.innerHTML=`<div class="fr-inner"><header><h2>${title}</h2><button type="button" class="fr-close" aria-label="Хаах">${icon("close",18)}</button></header>${body}<p class="fr-status" role="status"></p></div>`;
  el.querySelector(".fr-close").onclick=()=>el.close();
  el.addEventListener("close",()=>el.remove(),{once:true});
  document.body.append(el); el.showModal();
  return el;
}
function saveFile(value) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;
  link.download="HursUrh-"+todayKey()+"-"+value.id.slice(0,8)+".json";
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export async function openFamilyExport(load) {
  const el=dialog("Багт өгөх тайлан",`<p>Өгөгдлөө багт өгөх бол файл татаж өөрөө дамжуулна. Файлд өрхийг давхар тоолохоос сэргийлэх санамсаргүй дугаар орно.</p>
    <label>Дүүрэг <small>(заавал биш)</small><select name="district"><option value="">Оруулахгүй</option>${districts.map(d=>`<option>${d}</option>`).join("")}</select></label>
    <dl class="fr-preview"></dl><button class="fr-primary" disabled type="button">Тайлан татах</button>`);
  const message=el.querySelector('[role="status"]');
  try {
    const data=await load();
    const report=makeReport(data);
    el.querySelector("dl").innerHTML=`<dt>Хийсэн тест</dt><dd>${report.tests}</dd><dt>Тэмдэглэсэн хэрэглээ</dt><dd>${report.uses}</dd><dt>Сүүлийн тест</dt><dd>${levels[report.level]}</dd>`;
    const button=el.querySelector(".fr-primary");button.disabled=false;
    button.onclick=()=>{saveFile(makeReport(data,el.querySelector("select").value));message.textContent="Тайланг татахаар илгээлээ.";};
  } catch(error){message.textContent=error.message;}
}
async function summaries(incoming=[]) {
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open("terrasense-family-summaries",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("reports",{keyPath:"id"});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("reports",incoming.length?"readwrite":"readonly");
      const store=tx.objectStore("reports"), read=store.getAll();let result;
      read.onsuccess=()=>{
        const current=read.result,old=new Map(current.map(r=>[r.id,r]));
        result=mergeReports(current,incoming);
        for(const r of result)if(r!==old.get(r.id))store.put(r);
      };
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(new Error("Тайланг хадгалж чадсангүй. Хөтчийн хадгалах зайг шалгана уу."));
    });
  } finally {db.close();}
}
function summaryTable(rows) {
  if(!rows.length)return "<p class='fr-empty'>Эхний өрхийн тайлангаа сонгож нэгтгэнэ үү.</p>";
  const groups=new Map();
  for (const r of rows) {
    const d=r.district||"Дүүрэг оруулаагүй", group=groups.get(d)||{homes:0,tests:0,uses:0,high:0};
    group.homes++;group.tests+=r.tests;group.uses+=r.uses;if(r.level==="high")group.high++;
    groups.set(d,group);
  }
  return `<p><strong>Нийт ${rows.length} өрх</strong> · Сүүлийн файл ${displayDate(rows.map(r=>r.exportedAt).sort().at(-1))}</p>
    <div class="fr-scroll"><table><thead><tr><th>Дүүрэг</th><th>Өрх</th><th>Тест</th><th>Хэрэглээ</th><th>Өндөр¹</th></tr></thead><tbody>${[...groups].sort(([a],[b])=>a.localeCompare(b,"mn")).map(([d,g])=>`<tr><td>${d}</td><td>${g.homes}</td><td>${g.tests}</td><td>${g.uses}</td><td>${g.high}</td></tr>`).join("")}</tbody></table></div><small>¹ Сүүлийн тест нь өндөр ангилалтай өрхийн тоо.</small>`;
}
export async function openFamilyReports() {
  const el=dialog("Өрхийн тайлангийн нэгтгэл",`<p>Өрхөөс ирсэн тайлангийн файлыг сонгоно. Өрх бүрийн сүүлийн тайлан энэ хөтөчид хадгалагдана.</p>
    <button class="fr-primary" type="button" data-choose>Тайлан оруулах</button><input type="file" accept=".json,application/json" multiple hidden><div class="fr-table"></div>`);
  const status=el.querySelector('[role="status"]'), file=el.querySelector("input"), choose=el.querySelector("[data-choose]");
  const draw=rows=>{el.querySelector(".fr-table").innerHTML=summaryTable(rows);};
  choose.disabled=true;
  try{draw(await summaries());}catch{status.textContent="Төхөөрөмжийн хадгалах санг нээж чадсангүй.";return;}
  choose.disabled=false;choose.onclick=()=>file.click();
  file.onchange=async()=>{
    const selected=Array.from(file.files);file.value=""; if(!selected.length)return;
    choose.disabled=true;
    try {
      if(selected.length>100||selected.some(f=>f.size>16384))throw new Error("Нэг удаад 16 КиБ хүртэлх 100 тайлан сонгоно уу.");
      const reports=await Promise.all(selected.map(async f=>validateReport(JSON.parse(await f.text()))));
      draw(await summaries(reports));
      status.textContent="Тайлангуудыг нэгтгэлээ. Ижил өрхийн давхардсан файлыг нэг удаа тоолсон.";
    } catch(error){status.textContent=error instanceof SyntaxError?"JSON тайлангийн файлыг уншиж чадсангүй.":error.message;}
    finally{choose.disabled=false;}
  };
}
