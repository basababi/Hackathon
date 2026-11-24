import { icon } from "./icons.js";
import { monthlySeries } from "./data.js";

export function sparkline(values, color) {
  if (!values.some((v) => v > 0)) return "";
  const min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  const xy = values.map((v, i) => [
    2 + (i * 78) / Math.max(1, values.length - 1),
    28 - ((v - min) * 20) / span,
  ]);
  const points = xy.map((p) => p.join(",")).join(" ");
  return `<svg class="spark" aria-hidden="true" viewBox="0 0 82 36" style="color:${color}"><polygon points="2,35 ${points} 80,35" fill="currentColor" opacity=".08"/><polyline points="${points}" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round" stroke-width="1.9"/></svg>`;
}
const label = (m) => Number(m.slice(5)) + " сар";
function linePath(points) {
  let path = "";
  let prev;
  for (const point of points) {
    if (!point) {
      prev = null;
      continue;
    }
    const [x, y] = point;
    if (prev) {
      const mid = (prev[0] + x) / 2;
      path += ` C${mid},${prev[1]} ${mid},${y} ${x},${y}`;
    } else path += ` M${x},${y}`;
    prev = point;
  }
  return path.trim();
}
export function trendCard(records, months) {
  const series = monthlySeries(records, months);
  const current = series.at(-1),
    first = series[0];
  const delta =
    current.percent === null || first.percent === null
      ? null
      : current.percent - first.percent;
  const w = 350,
    h = 155,
    start = 36,
    end = 333,
    base = 124;
  const x = (i) => start + (i * (end - start)) / (months - 1);
  const y = (v) => base - v * 1.08;
  const points = series.map((s, i) =>
    s.percent === null ? null : [x(i), y(s.percent)],
  );
  const areas = [];
  let run = [];
  for (const p of [...points, null]) {
    if (p) run.push(p);
    else if (run.length) {
      areas.push(linePath(run) + ` V${base} H${run[0][0]}Z`);
      run = [];
    }
  }
  const data = series
    .map((s, i) => {
      const tip = `${s.month.replace("-", ".")}: ${s.high} / ${s.total} цэг (${s.percent}%)`;
      return s.percent === null
        ? ""
        : `<g class="chart-target" tabindex="0" role="img" aria-label="${tip}" data-tip="${tip}"><circle cx="${x(i)}" cy="${y(s.percent)}" r="12" fill="transparent"/><circle class="chart-dot" cx="${x(i)}" cy="${y(s.percent)}" r="3.3" fill="white" stroke="#19856a" stroke-width="2"/></g>`;
    })
    .join("");
  return `<section class="card trend-card"><div class="card-head"><div><h2>Бохирдлын хандлага</h2><p>Өндөр ангилалтай цэгийн эзлэх хувь</p></div>
    <select id="months" class="mini-select" aria-label="Хандлагын хугацаа">${[3, 6, 12].map((m) => `<option value="${m}" ${m === months ? "selected" : ""}>${m} сар</option>`).join("")}</select></div>
    <div class="trend-number"><strong>${current.percent ?? "—"}${current.percent !== null ? "<small>%</small>" : ""}</strong>${delta === null ? "" : `<span class="delta ${delta > 0 ? "up" : ""}" title="Эхний болон сүүлийн сарын зөрүү">${delta < 0 ? "↘" : delta > 0 ? "↗" : "="} ${Math.abs(delta)} н.х.</span>`}</div>
    <div class="plot"><svg viewBox="0 0 ${w} ${h}" aria-label="Өндөр ангилалтай цэгийн хувь, сараар"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5eb592" stop-opacity=".30"/><stop offset="100%" stop-color="#5eb592" stop-opacity=".025"/></linearGradient></defs>
    ${[0, 25, 50, 75, 100].map((v) => `<text x="24" y="${y(v) + 3.5}" text-anchor="end">${v}%</text><path d="M${start} ${y(v)}H${end}" fill="none" stroke="#dce4dd" stroke-dasharray="3 4"/>`).join("")}
    <path d="${areas.join(" ")}" fill="url(#area)"/><path d="${linePath(points)}" fill="none" stroke="#23866c" stroke-width="2.6" stroke-linecap="round"/>${data}
    ${series.map((s, i) => (months === 12 && i % 2 === 0 ? "" : `<text x="${x(i)}" y="147" text-anchor="middle">${label(s.month)}</text>`)).join("")}</svg></div>
    <div class="chart-foot" id="chart-note">${icon("info", 15)}<span>${current.total ? `Энэ сард ${current.total} цэгээс ${current.high} нь өндөр ангилалтай.` : "Энэ сард уншилт бүртгэгдээгүй."}</span><a class="text-link" href="#analysis">Тайлан үзэх</a></div></section>`;
}
