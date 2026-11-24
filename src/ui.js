import { icon } from "./icons.js";
import { statusNames, methodNames, displayDate, todayKey } from "./data.js";
import { fieldDateTime } from "./schedule.js";

export function measurementTime(date) {
  return date.length === 10 ? "" : fieldDateTime(new Date(date)).slice(11);
}

export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
export const pill = (status) =>
  `<span class="pill ${Object.hasOwn(statusNames, status) ? status : "unread"}"><i></i>${esc(statusNames[status] || statusNames.unread)}</span>`;
export const empty = (text) =>
  `<div class="empty">${icon("layers", 24)}<p>${esc(text)}</p></div>`;
export function modal(title, html, glyph = "info") {
  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog";
  dialog.setAttribute("aria-label", title);
  dialog.innerHTML = `<div class="dialog-inner"><div class="dialog-heading"><span class="dialog-icon">${icon(glyph, 22)}</span><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Хаах">${icon("close")}</button></div>${html}</div>`;
  document.body.append(dialog);
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  return dialog;
}
let noticeTimer;
export function notify(message) {
  const el = document.querySelector("#toast");
  el.innerHTML = icon("info", 18) + "<span>" + esc(message) + "</span>";
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    el.hidden = true;
  }, 4400);
}
export function dueLabel(value) {
  const n = Math.round((Date.parse(value) - Date.parse(todayKey())) / 86400000);
  if (n === 0) return "Өнөөдөр";
  if (n === 1) return "Маргааш";
  if (n < 0) return Math.abs(n) + " хоног хэтэрсэн";
  return n + " хоногийн дараа";
}
export function exportCsv(rows, sites) {
  const safe = (cell) => {
    let v = String(cell ?? "");
    if (typeof cell === "string" && /^(?:\s*[=+@-]|[\t\r\n])/.test(v))
      v = "'" + v;
    return '"' + v.replaceAll('"', '""') + '"';
  };
  const table = [
    [
      "Бүртгэл",
      "Огноо",
      "Цаг (Улаанбаатар)",
      "Цэг",
      "Дүүрэг",
      "Өргөрөг",
      "Уртраг",
      "Ангилал",
      "Арга",
      "Иж бүрдэл",
      "Тэмдэглэл",
    ],
    ...rows.map((r) => {
      const site = sites.find((s) => s.id === r.siteId);
      return [
        r.id,
        displayDate(r.date),
        measurementTime(r.date),
        site?.name,
        site?.district,
        site?.lat,
        site?.lng,
        statusNames[r.status],
        methodNames[r.method] || r.method,
        r.kit,
        r.note,
      ];
    }),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF", table.map((row) => row.map(safe).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "TerraSense-" + todayKey() + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
