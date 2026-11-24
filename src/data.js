export const statusNames = {
  low: "Бага",
  medium: "Дунд",
  high: "Өндөр",
  unread: "Тодорхойгүй",
};
export const methodNames = {
  camera: "Камер",
  upload: "Зурган уншилт",
  manual: "Гар бүртгэл",
};
const localCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ulaanbaatar",
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayKey(date = new Date()) {
  const parts = localCalendar.formatToParts(date);
  const number = (unit) => parts.find(part => part.type === unit).value;
  return number("year").padStart(4, "0") + "-" + number("month") + "-" + number("day");
}

export function dayKey(offset = 0, now = new Date()) {
  const localDate = new Date(todayKey(now) + "T00:00:00Z");
  localDate.setUTCDate(localDate.getUTCDate() + offset);
  return localDate.toISOString().slice(0, 10);
}
export function displayDate(input) {
  const key = input.length === 10 ? input : todayKey(new Date(input));
  return key.replaceAll("-", ".");
}
export function latestBySite(records) {
  const result = new Map();
  for (const item of records) {
    if (
      !result.has(item.siteId) ||
      Date.parse(result.get(item.siteId).date) < Date.parse(item.date)
    ) {
      result.set(item.siteId, item);
    }
  }
  return result;
}
export function monthlySeries(records, count, now = new Date()) {
  const key = todayKey(now);
  const [year, month] = key.split("-").map(Number);
  const groups = new Map();
  for (let i = count - 1; i >= 0; i--) {
    const target = new Date(Date.UTC(year, month - 1 - i, 1))
      .toISOString()
      .slice(0, 7);
    groups.set(target, []);
  }
  for (const record of records)
    groups.get(todayKey(new Date(record.date)).slice(0, 7))?.push(record);
  return Array.from(groups, ([month, list]) => {
    const read = [...latestBySite(list).values()].filter(
      (r) => r.status !== "unread",
    );
    const high = read.filter((r) => r.status === "high").length;
    return {
      month,
      high,
      total: read.length,
      percent: read.length ? Math.round((100 * high) / read.length) : null,
    };
  });
}
export function makeSeed(now = new Date()) {
  const points = [
    ["Баянхошуу", "Сонгинохайрхан", 47.9625, 106.81],
    ["Хайлааст", "Чингэлтэй", 47.9686, 106.903],
    ["Дамбадаржаа", "Сүхбаатар", 47.9845, 106.9447],
    ["Дарь-Эх", "Баянзүрх", 47.9513, 106.9565],
    ["Дэнжийн мянга", "Чингэлтэй", 47.9468, 106.8944],
    ["Амгалан", "Баянзүрх", 47.9167, 107.0052],
    ["Толгойт", "Сонгинохайрхан", 47.9206, 106.7843],
    ["Долоон буудал", "Сүхбаатар", 47.9674, 106.9278],
    ["Ханын материал", "Сонгинохайрхан", 47.9405, 106.8245],
    ["Зурагт", "Баянгол", 47.9366, 106.8741],
    ["Шар хад", "Баянзүрх", 47.9455, 107.0188],
    ["Гандан", "Баянгол", 47.9249, 106.8818],
  ];
  const sites = points.map(([name, district, lat, lng], i) => ({
    id: "UB-" + String(i + 1).padStart(3, "0"),
    name,
    district,
    lat,
    lng,
  }));
  const records = [];
  const [year, month, day] = todayKey(now).split("-").map(Number);
  const highCounts = [9, 8, 6, 7, 4, 3];
  for (let m = 0; m < 6; m++) {
    const maxDay = m === 5 ? day : 26;
    sites.forEach((site, i) => {
      for (let sample = 0; sample < 2; sample++) {
        const dayNumber = Math.max(
          1,
          maxDay - ((i * 3 + (1 - sample) * 11) % maxDay),
        );
        const time = Math.min(
          now.getTime() - (i + 1) * 1000,
          Date.UTC(year, month - 6 + m, dayNumber, 3 + sample, 41 - i),
        );
        const rank = (i * 7 + 3) % 12;
        const status =
          rank < highCounts[m]
            ? "high"
            : rank % 3 === 0 || (rank % 3 === 1 && m >= 3)
              ? "low"
              : "medium";
        records.push({
          id: "BT-" + String(1000 + records.length + 1),
          siteId: site.id,
          date: new Date(time).toISOString(),
          status,
          method: sample ? "camera" : "manual",
          kit: "Демо лавлах карт",
          note: "Танилцуулгад зориулсан жишээ хэмжилт.",
        });
      }
    });
  }
  const reminders = [0, 1, 3, 6, 9].map((d, i) => ({
    id: "REM-" + (i + 1),
    siteId: sites[i].id,
    due: dayKey(d, now),
    product: "Био-бэлдмэл " + (i % 2 ? "Б" : "А"),
    dose: [100, 150, 200, 100, 150][i],
    unit: "мл",
    done: false,
  }));
  return { sites, records, reminders };
}
