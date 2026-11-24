// Optical quality checks apply to this photograph and its own reference card.
// Distances are in OKLab, not soil concentrations or calibrated risk thresholds.
const referenceKeys = ["low", "medium", "high"];
const messages = {
  overlap:
    "Сонгосон хэсгүүд давхцаж байна. Тест болон лавлах бүрийн төвийг тусад нь сонгоно уу.",
  references:
    "Лавлах өнгүүдийг ялгахад хангалтгүй байна. Гэрэлтүүлэг болон сонгосон цэгүүдээ шалгана уу.",
  texture:
    "Сонгосон хэсгийн өнгө жигд биш байна. Бичиг, ирмэг, гялбааг оруулалгүй дахин сонгоно уу.",
  outside:
    "Тестийн өнгө сонгосон лавлахуудаас хол байна. Иж бүрдлийн карт болон гэрлээ шалгана уу.",
  ambiguous:
    "Хоёр лавлах өнгө сорьцтой ойролцоо байна. Ижил гэрэлд дахин зураг авна уу.",
};
function oklab(rgb) {
  const [r, g, b] = rgb.map((byte) => {
    const v = byte / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const reject = (issue) => ({
  status: "unread",
  issue,
  message: messages[issue],
});

export function measurePatch(context, x, y) {
  const { width, height } = context.canvas;
  const radius = Math.max(1, Math.round(Math.min(width, height) * 0.004));
  const left = Math.max(0, x - radius),
    top = Math.max(0, y - radius);
  const right = Math.min(width, x + radius + 1),
    bottom = Math.min(height, y + radius + 1);
  const pixels = context.getImageData(
    left,
    top,
    right - left,
    bottom - top,
  ).data;
  const channels = [[], [], []],
    colors = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    rgb.forEach((v, c) => channels[c].push(v));
    colors.push(oklab(rgb));
  }
  const rgb = channels.map(
    (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)],
  );
  const center = oklab(rgb);
  const deviations = colors
    .map((color) => distance(center, color))
    .sort((a, b) => a - b);
  const spread = deviations[Math.floor((deviations.length - 1) * 0.9)];
  return { x, y, rgb, spread, left, right, top, bottom };
}

export function evaluateReading(samples) {
  const patches = [samples.test, ...referenceKeys.map((key) => samples[key])];
  for (let i = 0; i < patches.length; i++) {
    const a = patches[i];
    if (
      patches
        .slice(i + 1)
        .some(
          (b) =>
            a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top,
        )
    )
      return reject("overlap");
  }
  const target = oklab(samples.test.rgb);
  const refs = referenceKeys.map((key) => ({
    key,
    color: oklab(samples[key].rgb),
  }));
  const separation = Math.min(
    distance(refs[0].color, refs[1].color),
    distance(refs[1].color, refs[2].color),
    distance(refs[0].color, refs[2].color),
  );
  if (separation < 0.025) return reject("references");
  if (patches.some((p) => p.spread > separation * 0.35))
    return reject("texture");
  const ranked = refs
    .map((ref) => ({ ...ref, delta: distance(target, ref.color) }))
    .sort((a, b) => a.delta - b.delta);
  const [best, second] = ranked;
  const nearestGap = Math.min(
    ...ranked.slice(1).map((r) => distance(best.color, r.color)),
  );
  if (best.delta > nearestGap * 0.7) return reject("outside");
  if (second.delta - best.delta < nearestGap * 0.15) return reject("ambiguous");
  return { status: best.key, issue: null, message: "" };
}
