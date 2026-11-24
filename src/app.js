import { icon } from "./icons.js";
import {
  makeSeed,
  statusNames,
  methodNames,
  displayDate,
  latestBySite,
  todayKey,
  dayKey,
  monthlySeries,
} from "./data.js";
import { sparkline, trendCard } from "./charts.js";
import {
  esc,
  pill,
  empty,
  modal,
  notify,
  dueLabel,
  exportCsv,
  measurementTime,
} from "./ui.js";
import {
  loadState,
  saveState,
  connectShared,
  disconnectShared,
  switchLocal,
  isShared,
  isDemo,
} from "./store.js";
import { openTest, openReminder, openReminderDetail } from "./workflows.js";
import { mountMap } from "./map.js";
import { downloadCalendar } from "./calendar.js";
import { compareSites, mountAnalysis } from "./analysis.js";
import { setReminderDone } from "./schedule.js";
import { openBackup } from "./backup.js";

const pages = {
  dashboard: ["Хяналтын самбар", "grid"],
  map: ["GIS газрын зураг", "map"],
  tests: ["Био-тестийн бүртгэл", "flask"],
  analysis: ["Давтан хэмжилт", "chart"],
  reminders: ["Сануулга", "bell"],
};
const seed = makeSeed();
const updates =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("terrasense-workspace-updates")
    : null;
let changedRevision = 0,
  refreshing = false;
let state,
  cleanupView,
  months = 6,
  reminderTab = "pending",
  reminderScope = "all",
  mapQuery = "",
  testSearch = "",
  testStatus = "",
  mapStatus = "",
  testLimit = 25;
const main = document.querySelector("#main");
const route = () =>
  Object.hasOwn(pages, location.hash.slice(1))
    ? location.hash.slice(1)
    : "dashboard";
const siteOf = (id) => state.sites.find((s) => s.id === id);
const ordered = () =>
  [...state.records].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
const modeName = () =>
  isShared() ? "Багийн орчин" : isDemo() ? "Демо орчин" : "Миний бүртгэл";
const pending = () =>
  state.reminders
    .filter((r) => !r.done)
    .sort((a, b) => a.due.localeCompare(b.due));
function dueReminders(scope) {
  const today = todayKey(),
    end = dayKey(6);
  return pending().filter((r) => {
    if (scope === "due") return r.due <= today;
    if (scope === "week") return r.due >= today && r.due <= end;
    return true;
  });
}
function selectWorkspace(next) {
  state = next;
  changedRevision = 0;
  testSearch = testStatus = mapStatus = mapQuery = "";
  testLimit = 25;
  reminderScope = "all";
  reminderTab = "pending";
}
function updateConnectionNotice() {
  const notice = document.querySelector("#connection-state");
  const offline = !navigator.onLine;
  notice.hidden = !offline && !changedRevision;
  if (notice.hidden) return;
  const text = offline
    ? isShared()
      ? "Багийн санд хадгалахын тулд интернэтэд холбогдоно уу."
      : "Офлайн горим. Бүртгэл энэ төхөөрөмжид хадгалагдана."
    : "Өөр цонхонд бүртгэл шинэчлэгдсэн байна.";
  notice.innerHTML =
    icon(offline ? "globe" : "activity", 16) +
    "<span>" +
    text +
    "</span>" +
    (changedRevision && (!offline || !isShared())
      ? '<button type="button" data-action="refresh">Шинэчлэх</button>'
      : "");
}
function announceChange() {
  updates?.postMessage({ workspace: modeName() });
}
async function refreshWorkspace() {
  if (refreshing) return;
  refreshing = true;
  const revision = changedRevision;
  try {
    state = await loadState(seed);
    if (changedRevision === revision) changedRevision = 0;
    render();
    notify("Бүртгэл шинэчлэгдлээ.");
  } catch (error) {
    notify(error.message);
  } finally {
    refreshing = false;
  }
}
updates?.addEventListener("message", (event) => {
  if (state && event.data?.workspace === modeName()) {
    changedRevision++;
    updateConnectionNotice();
  }
});
window.addEventListener("online", updateConnectionNotice);
window.addEventListener("offline", updateConnectionNotice);
const options = () =>
  Object.entries(statusNames)
    .map(([key, label]) => `<option value="${key}">${label}</option>`)
    .join("");
const statusOptions = (val) =>
  `<option value="">Бүх ангилал</option>${options()}`.replace(
    'value="' + val + '"',
    'value="' + val + '" selected',
  );
const action = (name, label, glyph, cls = "button primary") =>
  `<button class="${cls}" data-action="${name}">${icon(glyph, 18)}<span>${label}</span></button>`;

function renderFrame() {
  const page = route(),
    num = pending().length;
  document.title = pages[page][0] + " · TerraSense";
  document.querySelector("#sidebar").innerHTML =
    `<a href="#dashboard" class="brand" aria-label="TerraSense нүүр"><img src="/assets/mark.svg" alt="" width="39" height="39"><span>Terra<span>Sense</span></span></a>
    <div class="side-overline">АЖЛЫН ТАЛБАР</div><nav aria-label="Үндсэн цэс">${Object.entries(
      pages,
    )
      .map(
        ([key, [name, glyph]]) =>
          `<a href="#${key}" class="nav-item ${page === key ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${key === "tests" ? "Био-тестүүд" : name}</span>${key === "reminders" && num ? `<b class="nav-count">${num}</b>` : ""}</a>`,
      )
      .join("")}</nav>
    <div class="side-bottom"><button class="nav-item" data-action="help">${icon("help")}<span>Ашиглах заавар</span></button><button class="nav-item" data-action="settings">${icon("settings")}<span>Тохиргоо</span></button>
    <div class="workspace-info"><span class="city-icon">${icon("globe", 21)}</span><div><strong>Улаанбаатар</strong><small>Монгол Улс</small></div></div></div>`;
  document.querySelector("#topbar").innerHTML =
    `<button class="icon-btn mobile-menu" data-action="menu" aria-label="Үндсэн цэс нээх" aria-controls="sidebar" aria-expanded="false">${icon("menu")}</button><div class="crumb">${icon("panel", 17)}<span>Ажлын талбар</span>${icon("chevron", 12)}<strong>${pages[page][0]}</strong></div><a class="mobile-brand" href="#dashboard"><img src="/assets/mark.svg" alt="" width="25" height="25">TerraSense</a>
    <div class="top-right"><button class="mode" data-action="settings" aria-label="Ажлын орчин солих"><i></i>${modeName()}</button><span class="top-date">${icon("calendar", 16)}${displayDate(todayKey())}</span><button class="icon-btn bell-round" data-action="notifications" aria-label="Сануулга харах">${icon("bell", 19)}${pending().some((r) => r.due <= todayKey()) ? "<i></i>" : ""}</button><button class="avatar" data-action="settings" aria-label="Ажлын орчны тохиргоо">ТС</button></div>`;
}
function stats() {
  const { sites, records } = state,
    latest = latestBySite(records),
    reminders = pending();
  const series = monthlySeries(records, 6);
  let registered = 0;
  const counted = new Set();
  const volume = [],
    coverage = [];
  for (const s of series) {
    const list = records.filter(
      (r) => todayKey(new Date(r.date)).slice(0, 7) === s.month,
    );
    registered += list.length;
    volume.push(registered);
    list.forEach((r) => counted.add(r.siteId));
    coverage.push(counted.size);
  }
  const rows = [
    [
      "Хяналтын цэг",
      sites.length,
      "pin",
      "sage",
      new Set(sites.map((s) => s.district).filter(Boolean)).size +
        " дүүрэгт бүртгэлтэй",
      coverage,
      "#5a9774",
    ],
    [
      "Нийт био-тест",
      records.length,
      "flask",
      "blue",
      "Энэ сард " +
        records.filter(
          (r) =>
            todayKey(new Date(r.date)).slice(0, 7) === todayKey().slice(0, 7),
        ).length +
        " тест",
      volume,
      "#6e9bba",
    ],
    [
      "Өндөр бохирдолтой цэг",
      [...latest.values()].filter((r) => r.status === "high").length,
      "alert",
      "amber",
      "Сүүлийн уншилтаар",
      series.map((s) => s.high),
      "#cf9b4c",
    ],
    [
      "Идэвхтэй сануулга",
      reminders.length,
      "calendar",
      "violet",
      "Ойрын 7 хоногт " +
        reminders.filter((r) => r.due >= todayKey() && r.due <= dayKey(6))
          .length +
        " товтой",
      Array.from(
        { length: 7 },
        (_, i) => reminders.filter((r) => r.due >= dayKey(i)).length,
      ),
      "#9a88be",
    ],
  ];
  return (
    '<div class="stats">' +
    rows
      .map(
        ([name, value, glyph, color, caption, values, ink]) =>
          `<div class="stat card"><div class="stat-label"><span class="stat-icon ${color}">${icon(glyph, 19)}</span><span>${name}</span></div><div class="stat-value"><strong>${value}</strong>${sparkline(values, ink)}</div><small>${esc(caption)}</small></div>`,
      )
      .join("") +
    "</div>"
  );
}
function legend() {
  const latest = latestBySite(state.records);
  const hasUnknown = state.sites.some(
    (s) => (latest.get(s.id)?.status || "unread") === "unread",
  );
  return `<div class="map-legend"><span>Бохирдлын түвшин</span>${["low", "medium", "high", ...(hasUnknown ? ["unread"] : [])].map((v) => `<b><i class="dot ${v}"></i>${statusNames[v]}</b>`).join("")}</div>`;
}
function testTable(list, compact = false) {
  if (!list.length) return empty("Тохирох био-тестийн бүртгэл олдсонгүй.");
  return `<div class="table-wrap"><table><thead><tr><th>Хяналтын цэг</th>${compact ? "" : "<th>Унших арга</th>"}<th>Огноо</th><th>Ангилал</th><th><span class="sr-only">Дэлгэрэнгүй</span></th></tr></thead><tbody>${list
    .map((r) => {
      const s = siteOf(r.siteId);
      return `<tr data-record="${esc(r.id)}"><td><strong>${esc(s?.name)}</strong><small>${esc(s?.district || s?.id)}</small></td>${compact ? "" : `<td>${esc(methodNames[r.method] || r.method)}</td>`}<td class="date-cell">${displayDate(r.date)}</td><td>${pill(r.status)}</td><td><button class="row-open" aria-label="${esc(s?.name)} цэгийн тестийг харах">${icon("chevron", 15)}</button></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function reminderRows(list, compact = false) {
  if (!list.length) return empty("Энэ жагсаалтад сануулга алга.");
  return `<div class="reminder-list ${compact ? "compact" : ""}">${list
    .map((r) => {
      const due = r.due.split("-");
      return `<button class="reminder-row" data-reminder="${esc(r.id)}"><span class="date-block"><small>${Number(due[1])} САР</small><b>${Number(due[2])}</b></span><span class="reminder-name"><strong>${esc(siteOf(r.siteId)?.name)}</strong><small>${esc(r.product)} · ${esc(r.dose)} ${esc(r.unit)}</small></span><span class="due ${r.done ? "complete" : r.due <= todayKey() ? "today" : ""}">${r.done ? "Дууссан" : dueLabel(r.due)}</span></button>`;
    })
    .join("")}</div>`;
}
function dashboard() {
  const due = dueReminders("due").length;
  const secondary = due
    ? action(
        "priority",
        "Өнөөдрийн ажил · " + due,
        "calendar",
        "button hero-secondary",
      )
    : '<a href="#map" class="button hero-secondary">' +
      icon("map", 18) +
      "Газрын зураг нээх</a>";
  return `<section class="hero"><div class="hero-content"><div class="hero-tag"><i></i> ХӨРСНИЙ МОНИТОРИНГ</div><h1>Хяналтын самбар</h1><p>Гэр хорооллын хөрсний төлөв, био-тест, арчилгааны нэгдсэн хяналт.</p><div class="hero-actions">${action("test", "Шинэ био-тест", "scan", "button lime")}${secondary}</div></div></section>
    ${stats()}<div class="insights"><section class="card map-card"><div class="card-head"><div><h2>Хөрсний бохирдлын зураг</h2><p>${icon("pin", 13)} Улаанбаатар хот</p></div><a class="card-tool" href="#map" aria-label="GIS газрын зургийг дэлгэрүүлж харах">${icon("expand", 16)}</a></div><div id="map-canvas" class="map-canvas"></div>${legend()}</section>${trendCard(state.records, months)}</div>
    <div class="lower-grid"><section class="card"><div class="card-head"><div><h2>Сүүлийн био-тестүүд</h2></div><a class="text-link" href="#tests">Бүгдийг харах</a></div>${testTable(ordered().slice(0, 4), true)}</section>
    <section class="card"><div class="card-head"><div><h2>Ойрын сануулга</h2></div><a class="text-link" href="#reminders">Бүгдийг харах</a></div>${reminderRows(pending().slice(0, 3), true)}</section></div>`;
}
function pageHead(title, sub, buttons = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="page-actions">${buttons}</div></div>`;
}
function filteredSites() {
  const latest = latestBySite(state.records);
  const query = mapQuery.trim().toLocaleLowerCase("mn");
  return state.sites.filter(
    (s) =>
      (!mapStatus || (latest.get(s.id)?.status || "unread") === mapStatus) &&
      (!query ||
        [s.name, s.district, s.id].some((value) =>
          value?.toLocaleLowerCase("mn").includes(query),
        )),
  );
}
function mapPage() {
  const latest = latestBySite(state.records);
  const points = filteredSites();
  return (
    pageHead(
      "GIS газрын зураг",
      "Хяналтын цэгийг сонгож, тухайн байршлын давтан уншилтыг харна уу.",
      action("test", "Шинэ био-тест", "scan"),
    ) +
    `<section class="card full-map"><div class="card-head map-filter-head"><h2>Хяналтын цэгүүд <em>${points.length}</em></h2><form id="site-filter" class="map-filters">
    <label class="searchbox">${icon("search", 16)}<input id="site-search" name="query" type="search" value="${esc(mapQuery)}" placeholder="Цэг, дүүргээр хайх" aria-label="Газрын зураг дээр хайх"></label>
    <select id="map-status" class="mini-select" aria-label="Газрын зургийн ангилал">${statusOptions(mapStatus)}</select><button class="button outline" type="submit">Хайх</button></form></div>
    <div id="map-canvas" class="map-canvas expanded"></div>${legend()}</section><section class="card site-section"><div class="card-head"><h2>Цэгийн жагсаалт</h2></div><div class="site-list">${points.length ? points.map((s) => `<button data-site="${esc(s.id)}" class="site-item"><span class="site-pin">${icon("pin", 19)}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.district || s.id)}</small></span>${pill(latest.get(s.id)?.status || "unread")}</button>`).join("") : empty("Хайлтад тохирох цэг олдсонгүй.")}</div></section>`
  );
}
function filteredTests() {
  const q = testSearch.trim().toLocaleLowerCase();
  return ordered().filter((r) => {
    const s = siteOf(r.siteId);
    return (
      (!testStatus || r.status === testStatus) &&
      (!q ||
        [s?.name, s?.district, r.id].some((value) =>
          String(value || "")
            .toLocaleLowerCase()
            .includes(q),
        ))
    );
  });
}
function testsPage() {
  return (
    pageHead(
      "Био-тестийн бүртгэл",
      "Талбайд хийсэн уншилт, ангилал, тэмдэглэл.",
      action("csv", "CSV татах", "download", "button outline") +
        action("test", "Шинэ био-тест", "scan"),
    ) +
    `<section class="card"><div class="list-bar"><label class="searchbox">${icon("search", 17)}<input type="search" id="test-search" placeholder="Цэг, дүүрэг, дугаараар хайх" aria-label="Био-тест хайх" value="${esc(testSearch)}"></label><select id="test-status" class="mini-select" aria-label="Тестийн ангилал">${statusOptions(testStatus)}</select></div><div id="test-list"></div></section>`
  );
}
function updateTests() {
  const rows = filteredTests();
  document.querySelector("#test-list").innerHTML =
    testTable(rows.slice(0, testLimit)) +
    `<div class="table-footer"><small>${rows.length} бүртгэлээс ${Math.min(rows.length, testLimit)}-г харуулж байна</small>${rows.length > testLimit ? action("more", "Цааш үзэх", "down", "button outline") : ""}</div>`;
}
function remindersPage() {
  const done = state.reminders
    .filter((r) => r.done)
    .sort((a, b) => b.due.localeCompare(a.due));
  return (
    pageHead(
      "Сануулга",
      "Био-бэлдмэл хэрэглэх огноо, хэмжээ, гүйцэтгэл.",
      action("calendar", "Хуанлид нэмэх", "calendar", "button outline") +
        action("reminder", "Сануулга нэмэх", "plus"),
    ) +
    `<section class="card"><div class="list-bar tabs" role="group" aria-label="Сануулгын төлөв">${[
      ["pending", "Хүлээгдэж буй", pending().length],
      ["done", "Дууссан", done.length],
    ]
      .map(
        ([v, n, c]) =>
          `<button data-tab="${v}" aria-pressed="${reminderTab === v}" class="${reminderTab === v ? "selected" : ""}">${n} <b>${c}</b></button>`,
      )
      .join("")}${
      reminderTab === "pending"
        ? `<select id="reminder-scope" class="mini-select" aria-label="Сануулгын хугацаа">${Object.entries(
            {
              all: "Бүх хугацаа",
              due: "Өнөөдөр ба хоцорсон",
              week: "Ойрын 7 хоног",
            },
          )
            .map(
              ([key, label]) =>
                `<option value="${key}" ${reminderScope === key ? "selected" : ""}>${label}</option>`,
            )
            .join("")}</select>`
        : ""
    }</div>${reminderRows(reminderTab === "pending" ? dueReminders(reminderScope) : done)}</section>`
  );
}
function render() {
  cleanupView?.();
  cleanupView = null;
  renderFrame();
  updateConnectionNotice();
  const page = route();
  main.innerHTML = {
    dashboard,
    map: mapPage,
    tests: testsPage,
    reminders: remindersPage,
    analysis: () => "",
  }[page]();
  if (page === "analysis")
    cleanupView = mountAnalysis(main, { state, onSite: siteDialog });
  if (page === "tests") updateTests();
  if (page === "dashboard" || page === "map") {
    const sites = page === "map" ? filteredSites() : state.sites;
    cleanupView = mountMap(document.querySelector("#map-canvas"), {
      sites,
      records: state.records,
      onSite: siteDialog,
      expanded: page === "map",
    });
  }
}
async function persist(next, message) {
  try {
    state = await saveState(next);
  } catch (error) {
    if (error.code === "CONFLICT") {
      state = await loadState(seed);
      render();
    }
    throw error;
  }
  render();
  announceChange();
  notify(message);
}
function newTest(siteId) {
  openTest({
    sites: state.sites,
    siteId,
    kitNames: [
      ...new Set(
        ordered()
          .map((r) => r.kit?.trim())
          .filter(Boolean),
      ),
    ],
    onSave: async ({ newSite, ...record }) => {
      await persist(
        {
          ...state,
          sites: newSite ? [...state.sites, newSite] : state.sites,
          records: [...state.records, record],
        },
        "Био-тестийг хадгаллаа.",
      );
    },
  });
}
function newReminder(siteId) {
  if (!state.sites.length) {
    notify("Эхлээд био-тест бүртгэж хяналтын цэг үүсгэнэ үү.");
    return;
  }
  openReminder({
    sites: state.sites,
    siteId,
    onSave: (r) =>
      persist(
        { ...state, reminders: [...state.reminders, r] },
        "Сануулгыг хадгаллаа.",
      ),
  });
}
function reminderDetail(id) {
  const r = state.reminders.find((item) => item.id === id);
  openReminderDetail({
    reminder: r,
    reminders: state.reminders,
    site: siteOf(r.siteId),
    onToggle: () =>
      persist(
        {
          ...state,
          reminders: setReminderDone(state.reminders, id, !r.done),
        },
        "Сануулгын төлөв шинэчлэгдлээ.",
      ),
    onDelete: () =>
      persist(
        {
          ...state,
          reminders: state.reminders.filter((item) => item.id !== id),
        },
        "Сануулгыг устгалаа.",
      ),
  });
}
function recordDialog(id) {
  const r = state.records.find((item) => item.id === id),
    s = siteOf(r.siteId);
  modal(
    "Био-тестийн дэлгэрэнгүй",
    `<div class="detail-title"><h3>${esc(s?.name)}</h3>${pill(r.status)}</div><dl class="detail-dl"><dt>Бүртгэлийн дугаар</dt><dd>${esc(r.id)}</dd><dt>Хэмжсэн огноо, цаг</dt><dd>${displayDate(r.date)} ${measurementTime(r.date)}${r.date.length > 10 ? " (УБ)" : ""}</dd><dt>Унших арга</dt><dd>${esc(methodNames[r.method] || r.method)}</dd>${r.kit ? `<dt>Тестийн иж бүрдэл</dt><dd>${esc(r.kit)}</dd>` : ""}<dt>Байршил</dt><dd>${s ? esc(s.lat.toFixed(5) + ", " + s.lng.toFixed(5)) : "—"}</dd></dl>${r.note ? `<h4>Тэмдэглэл</h4><p class="note">${esc(r.note)}</p>` : ""}`,
    "flask",
  );
}
function siteDialog(site) {
  const records = ordered().filter((r) => r.siteId === site.id);
  const [pair] = compareSites({ sites: [site], records }, { days: 0 }).rows;
  const nextReminder = pending().find((r) => r.siteId === site.id);
  let comparison = "";
  if (pair) {
    const title = {
      improved: "Бохирдлын ангилал буурсан",
      worsened: "Бохирдлын ангилал өссөн",
      unchanged: "Бохирдлын ангилал хэвээр",
    }[pair.outcome];
    comparison = `<div class="comparison"><h4>${title}</h4><small>${esc(pair.to.kit)}</small><div><span>Анхны уншилт · ${displayDate(pair.from.date)}</span>${pill(pair.from.status)}</div><div><span>Сүүлийн уншилт · ${displayDate(pair.to.date)}</span>${pill(pair.to.status)}</div></div>`;
  }
  const dialog = modal(
    site.name,
    `<p class="sub">${esc(site.district || "Хяналтын цэг")} · ${esc(site.lat.toFixed(5))}°, ${esc(site.lng.toFixed(5))}°</p>
    <div class="site-actions"><button id="site-test" class="button primary">${icon("scan", 16)}Био-тест бүртгэх</button><button id="site-reminder" class="button outline">${icon("calendar", 16)}Сануулга нэмэх</button></div>
    ${nextReminder ? `<button class="site-next" id="site-next">${icon("clock", 17)}<span>Дараагийн тов · ${displayDate(nextReminder.due)}<small>${esc(nextReminder.product)} · ${esc(nextReminder.dose)} ${esc(nextReminder.unit)}</small></span>${icon("chevron", 14)}</button>` : ""}
    ${comparison}<h4>Био-тестийн түүх · ${records.length}</h4><div class="site-history">${records.length ? records.map((r) => `<button data-entry="${esc(r.id)}"><span>${displayDate(r.date)}</span>${pill(r.status)}${icon("chevron", 14)}</button>`).join("") : empty("Уншилт хараахан бүртгэгдээгүй.")}</div>`,
    "pin",
  );
  dialog.querySelector("#site-test").onclick = () => {
    dialog.close();
    newTest(site.id);
  };
  dialog.querySelector("#site-reminder").onclick = () => {
    dialog.close();
    newReminder(site.id);
  };
  if (nextReminder)
    dialog.querySelector("#site-next").onclick = () => {
      dialog.close();
      reminderDetail(nextReminder.id);
    };
  dialog.querySelectorAll("[data-entry]").forEach(
    (b) =>
      (b.onclick = () => {
        dialog.close();
        recordDialog(b.dataset.entry);
      }),
  );
}
function help() {
  modal(
    "Ашиглах заавар",
    `<div class="help-body"><h3>Био-тестийг хэрхэн унших вэ?</h3><p>Хяналтын цэгээ сонгоод тестийн тууз болон үйлдвэрлэгчийн өнгөний лавлахыг нэг гэрэлд зураг авна. Зураг дээрх сорьц, лавлах өнгүүдийг сонгож, дүнг шалгаад хадгална.</p><h3>Газрын зураг юуг харуулах вэ?</h3><p>Цэгийн өнгө тухайн байршлын хамгийн сүүлийн уншилтыг харуулна. Цэг дээр дарж өмнөх уншилтуудтай харьцуулна. График сар бүрийн уншигдсан цэгүүдээс өндөр ангилалтай байсан хувийг харуулдаг. н.х. нь нэгж хувь гэсэн утгатай.</p><h3>Био-бэлдмэлийн товыг хэрхэн сануулах вэ?</h3><p>Бүтээгдэхүүний зааварт заасан хэмжээ, нэгж, хэрэглэх огноог оруулна. Сануулгыг утасныхаа хуанлид импортолбол апп хаалттай үед ч тухайн хуанлиас мэдэгдэл авч болно.</p><h3>Өгөгдөл хаана хадгалагдах вэ?</h3><p>Демо орчин жишээ өгөгдлөөр эхэлнэ. Энэ орчинд нэмсэн бүртгэл тухайн хөтөчдөө хадгалагдана. Тохиргооноос “Миний бүртгэл”-ийг нээж өөрийн цэгүүдийг үүсгэнэ. Олон төхөөрөмжөөс хамтарч ажиллахад багийн санг холбоно.</p></div>`,
    "help",
  );
}
function settings() {
  const shared = isShared();
  const demo = isDemo();
  const dialog = modal(
    "Ажлын орчны тохиргоо",
    `<div class="settings-mode">${icon(shared ? "building" : "panel", 24)}<div><strong>${modeName()}</strong><p>${shared ? "Бүртгэлийг багийн гишүүд хамт ашиглана." : demo ? "Жишээ цэг, хэмжилт, товыг ашиглан системийг туршина." : "Талбайн бодит бүртгэл энэ хөтөчид хадгалагдана."}</p></div></div>
    ${shared ? "" : `<div class="local-switch"><h3>${demo ? "Талбайн бодит бүртгэл" : "Жишээ өгөгдөл"}</h3><p class="sub">${demo ? "Хувийн орчинд өөрийн хяналтын цэг, уншилт, сануулгыг бүртгэнэ." : "Демо орчинд жишээ цэгүүдийн өгөгдлийг үзнэ."}</p><button id="switch-local" class="button outline">${demo ? "Миний бүртгэлийг нээх" : "Демо орчин нээх"}</button></div>`}
    ${!shared && !demo ? `<div class="local-switch"><h3>Бүртгэлийн нөөц хуулбар</h3><p class="sub">Цэг, тест, сануулгаа нэг файлд хадгалж, өөр төхөөрөмжид сэргээнэ.</p><button id="open-backup" class="button outline">${icon("download", 16)}Нөөцлөх, сэргээх</button></div>` : ""}
    ${shared ? '<button class="button outline" id="team-refresh">Багийн бүртгэлийг шинэчлэх</button>' : ""}
    <form id="connection"><h3>${shared ? "Багийн холболт" : "Багийн сантай холбох"}</h3>${shared ? "" : `<label>Багийн нэвтрэх түлхүүр<input type="password" autocomplete="off" name="token" required></label><p class="sub">Түлхүүрийг төслийн администратороос авна уу.</p>`}<p class="connection-error" role="alert"></p><button class="button primary">${shared ? "Төхөөрөмжийн орчинд шилжих" : "Багийн орчинд нэвтрэх"}</button></form>`,
    "settings",
  );
  const backup = dialog.querySelector("#open-backup");
  if (backup)
    backup.onclick = () => {
      if (isShared() || isDemo()) return;
      dialog.close();
      openBackup({
        onRestore: (next) => {
          state = next;
          render();
          announceChange();
        },
      });
    };
  const refresh = dialog.querySelector("#team-refresh");
  if (refresh)
    refresh.onclick = () => {
      dialog.close();
      refreshWorkspace();
    };
  const local = dialog.querySelector("#switch-local");
  if (local)
    local.onclick = async () => {
      local.disabled = true;
      try {
        selectWorkspace(await switchLocal(!demo, seed));
        dialog.close();
        render();
        notify(modeName() + " нээгдлээ.");
      } catch (err) {
        dialog.querySelector(".connection-error").textContent = err.message;
        local.disabled = false;
      }
    };
  dialog.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      b = form.querySelector("button");
    b.disabled = true;
    try {
      selectWorkspace(
        shared
          ? await disconnectShared(seed)
          : await connectShared(form.elements.token.value),
      );
      dialog.close();
      render();
      notify("Ажлын орчин солигдлоо.");
    } catch (err) {
      dialog.querySelector(".connection-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
}
function mobileMenu(open) {
  const sidebar = document.querySelector("#sidebar"),
    wasOpen = document.body.classList.contains("menu-open");
  document.body.classList.toggle("menu-open", open);
  document.querySelector("#nav-backdrop").hidden = !open;
  document.querySelector(".shell").inert = open;
  sidebar.inert = !open && matchMedia("(max-width:960px)").matches;
  const toggle = document.querySelector(".mobile-menu");
  toggle?.setAttribute("aria-expanded", String(open));
  if (open) sidebar.querySelector(".active")?.focus();
  else if (wasOpen) toggle?.focus();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(
    "[data-action],[data-record],[data-reminder],[data-site],[data-tab]",
  );
  if (!b) return;
  if (b.dataset.record) recordDialog(b.dataset.record);
  else if (b.dataset.reminder) reminderDetail(b.dataset.reminder);
  else if (b.dataset.site) siteDialog(siteOf(b.dataset.site));
  else if (b.dataset.tab) {
    reminderTab = b.dataset.tab;
    render();
  } else {
    const actions = {
      test: newTest,
      reminder: newReminder,
      help,
      settings,
      refresh: refreshWorkspace,
      priority: () => {
        reminderScope = "due";
        reminderTab = "pending";
        location.hash = "reminders";
      },
      menu: () => mobileMenu(true),
      notifications: () => {
        reminderTab = "pending";
        reminderScope = "all";
        location.hash = "reminders";
        if (state) render();
      },
      csv: () => exportCsv(filteredTests(), state.sites),
      calendar: () => {
        const rows = pending();
        if (rows.length) downloadCalendar(rows, state.sites);
        else notify("Хуанлид нэмэх хүлээгдэж буй сануулга алга.");
      },
      more: () => {
        testLimit += 25;
        updateTests();
      },
    };
    if (b.dataset.action !== "menu") mobileMenu(false);
    actions[b.dataset.action]?.();
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "site-filter") return;
  e.preventDefault();
  mapQuery = e.target.elements.query.value;
  render();
  document.querySelector("#site-search")?.focus();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "test-search") {
    testSearch = e.target.value;
    testLimit = 25;
    updateTests();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "months") {
    months = Number(e.target.value);
    document.querySelector(".trend-card").outerHTML = trendCard(
      state.records,
      months,
    );
    document.querySelector("#months")?.focus();
  }
  if (e.target.id === "test-status") {
    testStatus = e.target.value;
    testLimit = 25;
    updateTests();
  }
  if (e.target.id === "map-status") {
    mapQuery = document.querySelector("#site-search").value;
    mapStatus = e.target.value;
    render();
    document.querySelector("#map-status")?.focus();
  }
  if (e.target.id === "reminder-scope") {
    reminderScope = e.target.value;
    render();
    document.querySelector("#reminder-scope")?.focus();
  }
});
function chartHint(e) {
  const point = e.target.closest(".chart-target");
  if (point) {
    const note = document.querySelector("#chart-note span");
    note.dataset.original ??= note.textContent;
    note.textContent = point.dataset.tip;
  }
}
function restoreChartHint(e) {
  if (
    !e.target.closest(".chart-target") ||
    e.relatedTarget?.closest?.(".chart-target")
  )
    return;
  const note = document.querySelector("#chart-note span");
  if (note?.dataset.original) note.textContent = note.dataset.original;
}
document.addEventListener("pointerover", chartHint);
document.addEventListener("focusin", chartHint);
document.addEventListener("pointerout", restoreChartHint);
document.addEventListener("focusout", restoreChartHint);
document.querySelector("#nav-backdrop").onclick = () => mobileMenu(false);
document.querySelector(".skip").onclick = (event) => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: "start" });
};
document.querySelector("#sidebar").onclick = (e) => {
  if (e.target.closest("a")) mobileMenu(false);
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") mobileMenu(false);
});
window.addEventListener("hashchange", () => {
  mobileMenu(false);
  if (state) render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});
async function start() {
  try {
    state = await loadState(seed);
    render();
  } catch (error) {
    main.innerHTML = `<div class="card boot-error"><h1>Ажлын орчныг нээж чадсангүй</h1><p>${esc(error.message)}</p><button class="button primary" id="retry">Дахин оролдох</button>${isShared() ? '<button class="button outline" id="local-mode">Төхөөрөмжийн орчин нээх</button>' : ""}</div>`;
    document.querySelector("#retry").onclick = start;
    const local = document.querySelector("#local-mode");
    if (local)
      local.onclick = async () => {
        await disconnectShared(seed);
        await start();
      };
  }
}
await start();
mobileMenu(false);
matchMedia("(max-width:960px)").addEventListener("change", () =>
  mobileMenu(false),
);
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
