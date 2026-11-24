import { dayKey, displayDate, todayKey } from "./data.js";
import { icon } from "./icons.js";
import { esc, pill } from "./ui.js";

const rank = new Map([["low", 0], ["medium", 1], ["high", 2]]);
const outcomes = {
  improved: "Буурсан",
  unchanged: "Хэвээр",
  worsened: "Өссөн",
};
const periods = [30, 90, 180, 0];
const collator = new Intl.Collator("mn", { numeric: true, sensitivity: "base" });

function kitKey(name) {
  return typeof name === "string"
    ? name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("mn")
    : "";
}

function later(a, b) {
  return a.time > b.time || (a.time === b.time && a.record.id > b.record.id);
}

/**
 * One vote per site. Within each kit, use the last reading of the first and
 * last qualifying local days. A one-day kit cannot displace an eligible pair.
 */
export function compareSites({ sites, records }, { days = 180, district = null, now = new Date() } = {}) {
  const start = days > 0 ? dayKey(1 - days, now) : null;
  const end = todayKey(now);
  const scoped = new Map(sites
    .filter(site => district === null || (site.district?.trim() || "") === district)
    .map(site => [site.id, site]));
  const observed = new Set();
  const kitsBySite = new Map();
  let withoutKit = 0, withoutStatus = 0;

  for (const record of records) {
    if (!scoped.has(record.siteId)) continue;
    const time = Date.parse(record.date);
    if (!Number.isFinite(time) || time > now.getTime()) continue;
    const day = todayKey(new Date(time));
    if (start && day < start) continue;
    observed.add(record.siteId);
    const kit = kitKey(record.kit);
    if (!kit) withoutKit++;
    if (!rank.has(record.status)) withoutStatus++;
    if (!kit || !rank.has(record.status)) continue;

    if (!kitsBySite.has(record.siteId)) kitsBySite.set(record.siteId, new Map());
    const kits = kitsBySite.get(record.siteId);
    const reading = { day, time, record };
    const span = kits.get(kit);
    if (!span) {
      kits.set(kit, { first: reading, last: reading });
      continue;
    }
    if (day < span.first.day || (day === span.first.day && later(reading, span.first))) {
      span.first = reading;
    }
    if (later(reading, span.last)) span.last = reading;
  }

  const rows = [];
  const counts = { improved: 0, unchanged: 0, worsened: 0 };
  for (const [siteId, kits] of kitsBySite) {
    let pair;
    for (const span of kits.values()) {
      if (span.first.day === span.last.day) continue;
      if (!pair || later(span.last, pair.last)) pair = span;
    }
    if (!pair) continue;
    const from = pair.first.record;
    const to = pair.last.record;
    const step = rank.get(to.status) - rank.get(from.status);
    const outcome = step < 0 ? "improved" : step > 0 ? "worsened" : "unchanged";
    counts[outcome]++;
    rows.push({ site: scoped.get(siteId), from, to, outcome });
  }
  rows.sort((a, b) => Date.parse(b.to.date) - Date.parse(a.to.date)
    || collator.compare(a.site.name, b.site.name)
    || collator.compare(a.site.id, b.site.id));

  return { start, end, rows, counts, registered: scoped.size, observed: observed.size, withoutKit, withoutStatus };
}

function percentage(numerator, denominator) {
  return denominator ? Math.round(100 * numerator / denominator) + "%" : "—";
}

function overview(result) {
  const total = result.rows.length;
  const { counts } = result;
  const segments = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([outcome, count]) => `<span class="an-${outcome}" style="flex-grow:${count}"></span>`)
    .join("");
  const breakdown = Object.entries(counts).map(([outcome, count]) =>
    `<li><span class="an-legend-dot an-${outcome}"></span>${outcomes[outcome]} <strong>${count}</strong></li>`).join("");
  return `<div class="an-overview">
    <section class="card an-distribution">
      <h2>Харьцуулсан цэгийн өөрчлөлт</h2>
      <p class="an-metric"><strong>${percentage(counts.improved, total)}</strong><span>нь буурсан ангилалтай</span></p>
      <div class="an-bar" aria-hidden="true">${segments}</div>
      <ul class="an-legend">${breakdown}</ul>
    </section>
    <section class="card an-coverage">
      <h2>Хэмжилтийн хамрах хүрээ</h2>
      <dl><div><dt>Бүртгэлтэй цэг</dt><dd>${result.registered}</dd></div>
      <div><dt>Уншилттай цэг</dt><dd>${result.observed}</dd></div>
      <div><dt>Харьцуулах боломжтой цэг</dt><dd>${total}</dd></div></dl>
    </section>
  </div>`;
}

function rowMarkup({ site, from, to, outcome }) {
  return `<tr>
    <td><button class="an-site" type="button" data-an-site="${esc(site.id)}">${esc(site.name)}</button>
    <small>${esc(site.district || "Дүүрэг оруулаагүй")}</small></td>
    <td class="an-kit">${esc(to.kit.trim())}</td>
    <td>${pill(from.status)}<time datetime="${esc(from.date)}">${displayDate(from.date)}</time></td>
    <td>${pill(to.status)}<time datetime="${esc(to.date)}">${displayDate(to.date)}</time></td>
    <td><span class="an-outcome an-tag-${outcome}">${outcomes[outcome]}</span></td>
  </tr>`;
}

function table(rows, total, limit) {
  if (!rows.length) {
    const title = total ? "Энэ өөрчлөлттэй цэг алга" : "Харьцуулах хэмжилт алга";
    const message = total ? "Өөрчлөлтийн шүүлтийг солиод үзнэ үү."
      : "Нэг цэг дээр ижил нэртэй иж бүрдлээр хоёр өөр өдөр хэмжиж, тодорхой ангилалтай уншилт хадгална уу.";
    return `<div class="an-empty">${icon("flask", 26)}<strong>${title}</strong><p>${message}</p></div>`;
  }
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Цэг тус бүрийн харьцуулалт">
    <table><thead><tr><th scope="col">Хяналтын цэг</th><th scope="col">Иж бүрдэл</th>
    <th scope="col">Эхний уншилт</th><th scope="col">Сүүлийн уншилт</th><th scope="col">Өөрчлөлт</th>
    </tr></thead><tbody>${rows.slice(0, limit).map(rowMarkup).join("")}</tbody></table>
    </div>${rows.length > limit ? '<div class="an-more"><button type="button" class="button outline" data-an-more>Дараагийн цэгүүдийг харах</button></div>' : ""}`;
}

export function mountAnalysis(container, { state, onSite }) {
  const districts = [...new Set(state.sites.map(s => s.district?.trim() || ""))].sort(collator.compare);
  const siteMap = new Map(state.sites.map(site => [site.id, site]));
  container.innerHTML = `<div class="analysis-view">
    <div class="page-head"><div><h1>Давтан хэмжилт</h1>
      <p>Нэг цэгийн эхний болон сүүлийн уншилтын ангиллыг харьцуулна.</p></div></div>
    <section class="an-controls" aria-label="Шинжилгээний шүүлт">
      <label>Хугацаа<select class="mini-select" data-an-period>${periods.map(days =>
        `<option value="${days}" ${days === 180 ? "selected" : ""}>${days ? "Сүүлийн " + days + " хоног" : "Бүх хугацаа"}</option>`).join("")}</select></label>
      <label>Дүүрэг<select class="mini-select" data-an-district><option value="-1">Бүх дүүрэг</option>
        ${districts.map((d, i) => `<option value="${i}">${esc(d || "Дүүрэг оруулаагүй")}</option>`).join("")}
      </select></label><p class="an-range" data-an-range></p>
    </section>
    <div data-an-overview></div>
    <section class="card an-table">
      <div class="card-head"><h2>Цэгийн харьцуулалт</h2>
        <select class="mini-select" data-an-change aria-label="Ангиллын өөрчлөлтөөр шүүх"><option value="">Бүх өөрчлөлт</option>
        ${Object.entries(outcomes).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></div>
      <div data-an-table></div>
      <details class="an-method"><summary>Харьцуулалтыг хэрхэн тооцсон бэ?</summary>
        <p>Сонгосон хугацаанд нэг цэгт ижил нэртэй иж бүрдлээр хийсэн, тодорхой ангилалтай уншилтуудыг харьцуулна. Улаанбаатарын цагаар эхний болон сүүлийн өдрийн хамгийн сүүлийн уншилтыг авна. Олон иж бүрдэл тохирвол хамгийн сүүлд давтан хэмжсэн иж бүрдлийг сонгож, цэг бүрийг нэг удаа тоолно.</p>
      </details>
      <p class="an-quality" data-an-quality></p>
    </section>
    <p class="sr-only" role="status" data-an-status></p>
  </div>`;
  const root = container.firstElementChild;
  const period = root.querySelector("[data-an-period]");
  const district = root.querySelector("[data-an-district]");
  const outcome = root.querySelector("[data-an-change]");
  const tableHost = root.querySelector("[data-an-table]");
  let report;
  let limit = 25;
  function drawTable() {
    const rows = outcome.value ? report.rows.filter(row => row.outcome === outcome.value) : report.rows;
    tableHost.innerHTML = table(rows, report.rows.length, limit);
    root.querySelector("[data-an-status]").textContent = `Хүснэгтэд ${Math.min(limit, rows.length)} цэг харуулж байна. Нийт ${rows.length} цэг.`;
  }
  function drawReport() {
    report = compareSites(state, { days: Number(period.value), district: districts[Number(district.value)] ?? null });
    root.querySelector("[data-an-range]").textContent = report.start
      ? displayDate(report.start) + " – " + displayDate(report.end)
      : displayDate(report.end) + " хүртэл";
    root.querySelector("[data-an-overview]").innerHTML = overview(report);
    const quality = root.querySelector("[data-an-quality]");
    const reasons = [];
    if (report.withoutKit) reasons.push(`Иж бүрдлийн нэргүй ${report.withoutKit} уншилт`);
    if (report.withoutStatus) reasons.push(`Тодорхой ангилалгүй ${report.withoutStatus} уншилт`);
    quality.hidden = !reasons.length;
    quality.textContent = reasons.join(" · ") + (reasons.length ? ". Эдгээр уншилт харьцуулалтад ороогүй." : "");
    drawTable();
  }
  function onChange(event) {
    limit = 25;
    if (event.target === outcome) drawTable();
    else drawReport();
  }
  function onClick(event) {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;
    if (button.hasAttribute("data-an-more")) {
      limit += 25;
      drawTable();
      tableHost.querySelectorAll("[data-an-site]")[limit - 25]?.focus();
    }
    if (button.hasAttribute("data-an-site")) onSite(siteMap.get(button.dataset.anSite));
  }
  root.addEventListener("change", onChange);
  root.addEventListener("click", onClick);
  drawReport();
  return () => {
    root.removeEventListener("change", onChange);
    root.removeEventListener("click", onClick);
  };
}
