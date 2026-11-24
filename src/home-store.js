import { todayKey } from "./data.js";
import { calendarDay, nextDueDay } from "./schedule.js";
import { validTimestamp } from "./schema.js";

const dbName = "terrasense-household-v1";
const units = new Set(["ширхэг", "мл", "л", "г", "кг"]);
const levels = new Set(["low", "medium", "high", "unread"]);
const methods = new Set(["camera", "upload", "manual"]);
const dayMs = 86400000;
const scale = 1000000;
let openPromise;
let channel;
const subscribers = new Set();

export const emptyHome = () => ({
  householdId: crypto.randomUUID(),
  revision: 0,
  plan: null,
  stock: 0,
  events: [],
});

function error(code, message) {
  return Object.assign(new Error(message), { code });
}

function cleanText(value, limit, required = true) {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.trim().length > limit ||
    (required && !value.trim())
  ) {
    throw error("INPUT", "Талбарын утга болон уртыг шалгана уу.");
  }
  return value.trim();
}

// Quantities are calculated as whole micro-units so decimal doses can be exhausted exactly.
function micros(value, allowZero = false) {
  const scaled = Math.round(value * scale);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (!allowZero && value === 0) ||
    !Number.isSafeInteger(scaled) ||
    scaled / scale !== value
  ) {
    throw error(
      "QUANTITY",
      "Хэмжээг зөв тоогоор, таслалаас хойш зургаа хүртэл оронтой оруулна уу.",
    );
  }
  return scaled;
}

function quantityFromMicros(amount) {
  const value = amount / scale;
  if (!Number.isSafeInteger(amount) || Math.round(value * scale) !== amount) {
    throw error("QUANTITY", "Үлдэгдлийн хэмжээ хэт их байна.");
  }
  return value;
}

function observedDate(input, now) {
  if (input === undefined)
    return { date: todayKey(now), measuredAt: now.toISOString() };
  if (calendarDay(input) && input <= todayKey(now)) return { date: input };
  if (validTimestamp(input) && Date.parse(input) <= now.getTime()) {
    const measured = new Date(input);
    return { date: todayKey(measured), measuredAt: measured.toISOString() };
  }
  throw error("DATE", "Өнөөдөр эсвэл өнгөрсөн өдрийн бодит огноог оруулна уу.");
}

function requiredPlan(state, command) {
  if (!state.plan || command.planId !== state.plan.id) {
    throw error(
      "CONFLICT",
      "Хуваарь өөрчлөгджээ. Сүүлчийн мэдээллийг нээгээд дахин оролдоно уу.",
    );
  }
  return state.plan;
}

const commandFields = {
  plan: ["product", "dose", "unit", "intervalDays", "nextDue", "stock"],
  use: ["planId", "due"],
  stock: ["planId", "amount", "supplier"],
  condition: ["smell", "fill"],
  test: ["status", "method", "note", "kit"],
  emptying: ["date"],
};

function retryMatches(event, command, now) {
  if (event.type !== command.type) return false;
  for (const key of commandFields[event.type]) {
    if (command[key] === undefined) continue;
    const value =
      typeof command[key] === "string" ? command[key].trim() : command[key];
    if (event[key] !== value) return false;
  }
  if (event.type === "test" && command.date !== undefined) {
    const measured = observedDate(command.date, now);
    return (
      event.date === measured.date && event.measuredAt === measured.measuredAt
    );
  }
  return true;
}

function serviceDayDifference(later, earlier) {
  return (
    (Date.parse(later + "T00:00:00Z") - Date.parse(earlier + "T00:00:00Z")) /
    dayMs
  );
}

export function applyHomeCommand(state, command, now = new Date()) {
  if (
    !command ||
    !Object.hasOwn(commandFields, command.type) ||
    typeof command.id !== "string" ||
    !/^[\w.:-]{1,128}$/.test(command.id)
  ) {
    throw error("INPUT", "Бүртгэлийн үйлдлийг дахин сонгоно уу.");
  }
  const previous = state.events.find((event) => event.id === command.id);
  if (previous) {
    if (retryMatches(previous, command, now)) return state;
    throw error(
      "CONFLICT",
      "Ижил дугаартай өөр үйлдэл өмнө нь хадгалагдсан байна.",
    );
  }
  const today = todayKey(now);
  const entry = {
    id: command.id,
    type: command.type,
    date: today,
    recordedAt: now.toISOString(),
  };
  let { plan, stock } = state;
  switch (command.type) {
    case "plan": {
      if (
        (command.expectedRevision !== undefined &&
          command.expectedRevision !== state.revision) ||
        (command.expectedPlanId !== undefined &&
          command.expectedPlanId !== (plan?.id ?? null)) ||
        (plan && command.expectedRevision === undefined)
      ) {
        throw error(
          "CONFLICT",
          "Өрхийн бүртгэл шинэчлэгджээ. Хуваарийн одоогийн мэдээллийг дахин нээнэ үү.",
        );
      }
      const product = cleanText(command.product, 160);
      const { dose, unit, intervalDays, nextDue } = command;
      micros(dose);
      if (!units.has(unit))
        throw error("UNIT", "Бүтээгдэхүүний хэмжих нэгжийг сонгоно уу.");
      if (!calendarDay(nextDue) || !nextDueDay(nextDue, intervalDays)) {
        throw error(
          "SCHEDULE",
          "Дараагийн өдөр болон давтамжийг бүхэл хоногоор оруулна уу.",
        );
      }
      const sameProduct = plan?.product === product && plan.unit === unit;
      if (command.stock === undefined && plan && !sameProduct) {
        throw error(
          "STOCK",
          "Шинэ бүтээгдэхүүний үлдэгдлийг сонгосон нэгжээр оруулна уу.",
        );
      }
      stock =
        command.stock === undefined ? (sameProduct ? stock : 0) : command.stock;
      micros(stock, true);
      plan = { id: command.id, product, dose, unit, intervalDays, nextDue };
      Object.assign(entry, plan, { stock });
      break;
    }
    case "stock": {
      requiredPlan(state, command);
      const sum = micros(stock, true) + micros(command.amount);
      stock = quantityFromMicros(sum);
      Object.assign(entry, {
        planId: plan.id,
        product: plan.product,
        unit: plan.unit,
        amount: command.amount,
        supplier: cleanText(command.supplier, 160, false),
      });
      break;
    }
    case "use": {
      requiredPlan(state, command);
      if (command.due !== plan.nextDue) {
        throw error(
          "CONFLICT",
          "Энэ тов шинэчлэгдсэн байна. Сүүлийн хуваариа шалгана уу.",
        );
      }
      if (today < plan.nextDue)
        throw error("EARLY", "Хэрэглэх өдөр хараахан болоогүй байна.");
      const remaining = micros(stock, true) - micros(plan.dose);
      if (remaining < 0)
        throw error(
          "STOCK",
          "Бэлдмэлийн үлдэгдэл хүрэхгүй байна. Нөөцөө шинэчилнэ үү.",
        );
      const nextDue = nextDueDay(today, plan.intervalDays);
      if (!nextDue)
        throw error(
          "SCHEDULE",
          "Дараагийн товын огноог тооцоолох боломжгүй байна.",
        );
      Object.assign(entry, {
        planId: plan.id,
        product: plan.product,
        unit: plan.unit,
        dose: plan.dose,
        due: plan.nextDue,
      });
      stock = quantityFromMicros(remaining);
      plan = { ...plan, nextDue };
      break;
    }
    case "condition": {
      const { smell, fill } = command;
      if (
        !["low", "medium", "strong"].includes(smell) ||
        !["low", "medium", "high"].includes(fill)
      ) {
        throw error("INPUT", "Үнэр болон дүүрэлтийн төлвийг сонгоно уу.");
      }
      Object.assign(entry, { smell, fill });
      break;
    }
    case "test": {
      if (!levels.has(command.status) || !methods.has(command.method)) {
        throw error("INPUT", "Тестийн үр дүн болон уншсан аргыг шалгана уу.");
      }
      Object.assign(entry, observedDate(command.date, now), {
        status: command.status,
        method: command.method,
        note: cleanText(command.note, 1600, false),
        kit: cleanText(command.kit, 100, false),
      });
      break;
    }
    case "emptying": {
      if (!calendarDay(command.date) || command.date > today) {
        throw error("DATE", "Соруулсан бодит огноогоо оруулна уу.");
      }
      if (
        state.events.some(
          (event) => event.type === "emptying" && event.date === command.date,
        )
      ) {
        throw error(
          "DUPLICATE",
          "Энэ өдрийн соруулалтыг өмнө нь бүртгэсэн байна.",
        );
      }
      entry.date = command.date;
      break;
    }
  }
  return {
    ...state,
    revision: state.revision + 1,
    plan,
    stock,
    events: [entry, ...state.events],
  };
}

export function householdSummary(state, now = new Date()) {
  const today = todayKey(now);
  const condition = state.events.find((e) => e.type === "condition") ?? null;
  const allTests = state.events.filter((e) => e.type === "test");
  const lastTest = allTests.reduce((latest, event) => {
    if (!latest || latest.date < event.date) return event;
    if (
      event.date === latest.date &&
      event.measuredAt &&
      latest.measuredAt &&
      Date.parse(event.measuredAt) > Date.parse(latest.measuredAt)
    )
      return event;
    return latest;
  }, null);
  const uses = state.events.filter((e) => e.type === "use");
  const emptyings = state.events
    .filter((e) => e.type === "emptying")
    .map((e) => e.date)
    .sort()
    .reverse();
  const lastEmptying = emptyings[0] || null;
  const emptyingIntervals = emptyings
    .slice(1)
    .map((day, i) => serviceDayDifference(emptyings[i], day));
  const { plan, stock } = state;
  const dueDays = plan ? serviceDayDifference(plan.nextDue, today) : null;
  const stockDoses = plan
    ? Math.floor(micros(stock, true) / micros(plan.dose))
    : null;
  let status = "unknown";
  if (condition || lastTest?.status === "low") status = "low";
  if (lastTest?.status === "unread" && status === "low") status = "unknown";
  if (
    condition?.fill === "medium" ||
    ["medium", "strong"].includes(condition?.smell) ||
    lastTest?.status === "medium" ||
    (dueDays !== null && dueDays <= 1)
  )
    status = "medium";
  if (condition?.fill === "high" || lastTest?.status === "high")
    status = "high";
  const careDays = new Set(
    [...uses, ...allTests.filter((e) => e.status !== "unread")].map(
      (e) => e.date,
    ),
  );
  return {
    today,
    condition,
    lastTest,
    status,
    dueDays,
    stockDoses,
    greenDays: careDays.size,
    stockWeeks: plan
      ? Math.round(((stockDoses * plan.intervalDays) / 7) * 10) / 10
      : null,
    canUse: !!plan && dueDays <= 0 && stockDoses > 0,
    useCount: uses.length,
    testCount: allTests.length,
    onTimeCount: uses.filter((e) => e.date === e.due).length,
    lastEmptying,
    emptyingIntervals,
    daysSinceEmptying: lastEmptying
      ? serviceDayDifference(today, lastEmptying)
      : null,
  };
}

function openDatabase() {
  if (!openPromise) {
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("household");
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          openPromise = undefined;
        };
        db.onclose = () => {
          openPromise = undefined;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(() => {
      openPromise = undefined;
      throw error(
        "STORAGE",
        "Өрхийн бүртгэлийг нээж чадсангүй. Хөтчийн хадгалалтын тохиргоог шалгана уу.",
      );
    });
  }
  return openPromise;
}

async function transaction(command) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    // The first reader initializes a durable random household ID, even if two tabs open together.
    const tx = db.transaction("household", "readwrite");
    const store = tx.objectStore("household");
    const request = store.get("current");
    let result,
      problem,
      changed = false;
    request.onsuccess = () => {
      try {
        const initial = request.result;
        const state = !initial
          ? emptyHome()
          : initial.householdId
            ? initial
            : { ...initial, householdId: crypto.randomUUID() };
        result = command ? applyHomeCommand(state, command) : state;
        changed = result !== state;
        if (changed || state !== initial) store.put(result, "current");
      } catch (cause) {
        problem = cause;
        tx.abort();
      }
    };
    tx.onabort = () =>
      reject(
        problem ??
          error(
            "STORAGE",
            "Өрхийн бүртгэлийг хадгалж чадсангүй. Хөтчийн сул зайг шалгана уу.",
          ),
      );
    tx.oncomplete = () => {
      if (changed) {
        try {
          getChannel()?.postMessage(result.revision);
        } catch {
          /* Save is already committed. */
        }
      }
      resolve(result);
    };
  });
}

function getChannel() {
  if (
    !channel &&
    typeof BroadcastChannel === "function" &&
    typeof window !== "undefined"
  ) {
    try {
      channel = new BroadcastChannel("terrasense-household-updates");
      channel.onmessage = () => {
        for (const listener of subscribers) listener();
      };
    } catch {
      /* Persistence also works with cross-tab messaging disabled. */
    }
  }
  return channel;
}

export function subscribeHome(listener) {
  getChannel();
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export const readHome = () => transaction();
export async function changeHome(command) {
  if (!command) throw error("INPUT", "Бүртгэлийн үйлдлийг дахин сонгоно уу.");
  return transaction(structuredClone(command));
}
