import { afterEach, describe, expect, it } from "vitest";
import { buildBackup, mergeBackup } from "../../shared/backup";
import {
  convert,
  rateOn,
  readCurrency,
  recordIn,
  totalIn,
  wishIn,
  type FxRates,
} from "../../shared/currency";
import { fmtMoney, fmtMoney0, fmtMoneyRange, fmtTotal } from "../../shared/format";
import { MESSAGES } from "../../shared/i18n";
import { emptyData } from "../../shared/ops";
import {
  DEFAULT_PREFS,
  LANG_CURRENCIES,
  applyPrefs,
  currencyPrefs,
  mainCurrency,
  nextPrefs,
  pickMain,
  pickSecond,
  readPrefs,
  showCurrencyHint,
  type Prefs,
} from "../../shared/prefs";
import { opSchema } from "../../shared/schema";
import { buildSheets, sheetValues, sheetsToBackup } from "../../shared/sheet";
import type { FuelRecord, GarageData, ServiceRecord, Wish } from "../../shared/types";
import { carView } from "../../src/lib/view";
import { CAR } from "./fixtures";

/** Пробіли в числах — нерозривні: порівнюємо як звичайні. */
const sp = (s: string) => s.replace(/[  ]/g, " ");
const prefsOf = (patch: Partial<Prefs>): Prefs => ({ ...DEFAULT_PREFS, ...patch });

afterEach(() => applyPrefs(DEFAULT_PREFS));

// П'ятниця й понеділок відомі, вихідних немає: так буває, поки курс на вихідні ще не підтягнули.
const rates: FxRates = {
  "2026-01-09": { USD: 40, EUR: 44 },
  "2026-01-12": { USD: 41, EUR: 45 },
  "2026-03-02": { USD: 42 },
};

describe("курс на дату", () => {
  it("гривня завжди 1, точна дата — свій курс", () => {
    expect(rateOn("UAH", "1999-01-01", {})).toBe(1);
    expect(rateOn("USD", "2026-01-12", rates)).toBe(41);
  });

  it("без курсу на дату — найближча попередня відома", () => {
    expect(rateOn("USD", "2026-01-10", rates)).toBe(40);
    expect(rateOn("USD", "2026-01-11", rates)).toBe(40);
    // Сьогодні до публікації нового курсу.
    expect(rateOn("USD", "2026-05-01", rates)).toBe(42);
  });

  it("якщо попередньої немає — найближча наступна", () => {
    expect(rateOn("USD", "2025-12-31", rates)).toBe(40);
  });

  it("кожна валюта шукає свої дати: курсу євро на 2 березня немає", () => {
    expect(rateOn("EUR", "2026-03-02", rates)).toBe(45);
  });

  it("курсу валюти немає взагалі — null", () => {
    expect(rateOn("USD", "2026-01-10", {})).toBeNull();
    expect(rateOn("EUR", "2026-01-10", { "2026-01-10": { USD: 40 } })).toBeNull();
  });

  it("сміття замість курсу не рахується", () => {
    const bad = { "2026-01-10": { USD: 0 }, "2026-01-11": { USD: Number.NaN }, "2026-01-12": { USD: 41 } } as FxRates;
    expect(rateOn("USD", "2026-01-10", bad)).toBe(41);
  });
});

describe("перерахунок", () => {
  it("через гривню, за курсом на дату запису, до копійки", () => {
    expect(convert(100, "USD", "UAH", "2026-01-09", rates)).toBe(4000);
    expect(convert(4100, "UAH", "USD", "2026-01-12", rates)).toBe(100);
    // 100 € × 44 / 40 = 110 $.
    expect(convert(100, "EUR", "USD", "2026-01-09", rates)).toBe(110);
    expect(convert(10, "UAH", "USD", "2026-01-12", rates)).toBe(0.24);
  });

  it("та сама валюта — без змін і без курсів", () => {
    expect(convert(123.456, "EUR", "EUR", "2026-01-09", {})).toBe(123.456);
  });

  it("сума зафіксована: новіший курс не змінює старих записів", () => {
    const before = convert(50, "USD", "UAH", "2026-01-09", rates);
    const later: FxRates = { ...rates, "2026-06-01": { USD: 50, EUR: 55 } };
    expect(convert(50, "USD", "UAH", "2026-01-09", later)).toBe(before);
  });

  it("без курсу — null, а не вигадане число", () => {
    expect(convert(100, "USD", "UAH", "2026-01-09", {})).toBeNull();
  });

  it("підсумок: перераховане разом, без курсу — окремо по валютах", () => {
    const total = totalIn(
      [
        { sum: 100, currency: "USD", date: "2026-01-09" },
        { sum: 500, currency: "UAH", date: "2026-01-10" },
        { sum: 10, currency: "EUR", date: "2026-01-12" },
      ],
      "UAH",
      rates,
    );
    expect(total).toEqual({ sum: 4950, rest: {} });
    const noRates = totalIn(
      [
        { sum: 100, currency: "USD", date: "2026-01-09" },
        { sum: 500, currency: "UAH", date: "2026-01-10" },
        { sum: 0.1, currency: "USD", date: "2026-01-09" },
        { sum: 0.2, currency: "USD", date: "2026-01-09" },
      ],
      "UAH",
      {},
    );
    expect(noRates).toEqual({ sum: 500, rest: { USD: 100.3 } });
  });

  it("запис і його позиції перераховуються разом", () => {
    const rec = { sum: 100, currency: "USD" as const, date: "2026-01-09", items: [{ sum: 60 }, { sum: 40 }] };
    expect(recordIn(rec, "UAH", rates)).toMatchObject({ sum: 4000, currency: "UAH", items: [{ sum: 2400 }, { sum: 1600 }] });
    expect(recordIn(rec, "USD", rates)).toBe(rec);
    expect(recordIn(rec, "UAH", {})).toMatchObject({ sum: 0, items: [{ sum: 0 }, { sum: 0 }] });
  });

  it("хотілка — за курсом на день, коли її додали", () => {
    const wish = { price: 100, priceMax: 150, currency: "EUR" as const, added: "2026-01-12" };
    expect(wishIn(wish, "UAH", rates)).toMatchObject({ price: 4500, priceMax: 6750, currency: "UAH" });
    expect(wishIn({ ...wish, priceMax: null }, "UAH", rates)?.priceMax).toBeNull();
    expect(wishIn(wish, "UAH", {})).toBeNull();
  });

  it("валюта з таблиці: код, знак або гривня", () => {
    expect(readCurrency("usd")).toBe("USD");
    expect(readCurrency("€")).toBe("EUR");
    expect(readCurrency("")).toBe("UAH");
    expect(readCurrency(undefined)).toBe("UAH");
    expect(readCurrency("GBP")).toBe("UAH");
  });
});

describe("формат грошей", () => {
  it("число, нерозривний пробіл і знак: гривневі тексти не змінились", () => {
    applyPrefs(prefsOf({ lang: "ru" }));
    expect(sp(fmtMoney(1234.5))).toBe("1 234,50 ₴");
    expect(sp(fmtMoney0(1234.5, "EUR"))).toBe("1 235 €");
    expect(sp(fmtMoneyRange(4000, 6000, "USD"))).toBe("4 000–6 000 $");
  });

  it("без валюти — основна з налаштувань", () => {
    applyPrefs(prefsOf({ lang: "en" }));
    expect(sp(fmtMoney(1234.5))).toBe("1,234.50 $");
    applyPrefs(prefsOf({ lang: "en", currency: { main: "EUR", second: null } }));
    expect(sp(fmtMoney0(10))).toBe("10 €");
  });

  it("підсумок показує неперераховане поруч", () => {
    applyPrefs(prefsOf({ lang: "ru" }));
    expect(sp(fmtTotal({ sum: 1500, rest: {} }))).toBe("1 500 ₴");
    expect(sp(fmtTotal({ sum: 1500, rest: { USD: 50, EUR: 20 } }))).toBe("1 500 ₴ + 50 $ + 20 €");
    expect(sp(fmtTotal({ sum: 0, rest: { EUR: 20 } }))).toBe("20 €");
    expect(sp(fmtTotal({ sum: 0, rest: {} }))).toBe("0 ₴");
    expect(sp(fmtTotal({ sum: 99.5, rest: {} }, fmtMoney, "USD"))).toBe("99,50 $");
  });
});

describe("валюти в налаштуваннях", () => {
  it("за мовою: англійська — долар без другої, українська й російська — гривня й долар", () => {
    expect(LANG_CURRENCIES).toEqual({
      en: { main: "USD", second: null },
      uk: { main: "UAH", second: "USD" },
      ru: { main: "UAH", second: "USD" },
    });
    expect(currencyPrefs(prefsOf({ lang: "uk" }))).toEqual({ main: "UAH", second: "USD" });
    expect(mainCurrency(prefsOf({ lang: "en" }))).toBe("USD");
  });

  it("поки людина не вибрала сама, валюти йдуть за мовою", () => {
    const uk = prefsOf({ lang: "uk" });
    const en = nextPrefs(uk, { lang: "en" });
    expect(currencyPrefs(en)).toEqual({ main: "USD", second: null });
  });

  it("вибрані валюти лишаються, хоч би яка була мова", () => {
    const picked = pickMain(prefsOf({ lang: "uk" }), "EUR");
    expect(currencyPrefs(picked)).toEqual({ main: "EUR", second: "USD" });
    expect(currencyPrefs(nextPrefs(picked, { lang: "en" }))).toEqual({ main: "EUR", second: "USD" });
  });

  it("основною стала додаткова — вони міняються місцями", () => {
    const ru = prefsOf({ lang: "ru" });
    expect(pickMain(ru, "USD").currency).toEqual({ main: "USD", second: "UAH" });
    expect(pickMain(prefsOf({ lang: "en" }), "USD").currency).toEqual({ main: "USD", second: null });
  });

  it("додаткова не може збігатися з основною", () => {
    const ru = prefsOf({ lang: "ru" });
    expect(pickSecond(ru, "EUR").currency).toEqual({ main: "UAH", second: "EUR" });
    expect(pickSecond(ru, "UAH").currency).toEqual({ main: "UAH", second: null });
    expect(pickSecond(ru, null).currency).toEqual({ main: "UAH", second: null });
  });

  it("з localStorage: сміття відкидається, однакові валюти — без додаткової", () => {
    expect(readPrefs({ currency: { main: "GBP", second: "USD" } }).currency).toBeNull();
    expect(readPrefs({ currency: "USD" }).currency).toBeNull();
    expect(readPrefs({ currency: { main: "EUR", second: "EUR" } }).currency).toEqual({ main: "EUR", second: null });
    expect(readPrefs({ currency: { main: "EUR", second: "UAH" }, currencyHintOff: true })).toMatchObject({
      currency: { main: "EUR", second: "UAH" },
      currencyHintOff: true,
    });
  });

  it("підказка про другу валюту: лише англійською, до власного вибору й до відмови", () => {
    const en = prefsOf({ lang: "en" });
    expect(showCurrencyHint(en)).toBe(true);
    expect(showCurrencyHint(prefsOf({ lang: "uk" }))).toBe(false);
    expect(showCurrencyHint(pickSecond(en, null))).toBe(false);
    expect(showCurrencyHint(pickSecond(en, "EUR"))).toBe(false);

    const off = nextPrefs(en, { currencyHintOff: true });
    expect(showCurrencyHint(off)).toBe(false);
    // Відмова діє, доки не зміниться мова.
    expect(showCurrencyHint(nextPrefs(off, { unit: "mi" }))).toBe(false);
    const back = nextPrefs(nextPrefs(off, { lang: "uk" }), { lang: "en" });
    expect(showCurrencyHint(back)).toBe(true);
  });
});

const svc = (id: string, date: string, sum: number, currency: ServiceRecord["currency"], cat = "Ремонт"): ServiceRecord => ({
  id,
  car: CAR,
  date,
  odo: 1000,
  cat,
  what: id,
  where: "",
  sum,
  currency,
  note: "",
  items: [],
});
const fl = (id: string, date: string, odo: number, sum: number, currency: FuelRecord["currency"]): FuelRecord => ({
  id,
  car: CAR,
  date,
  odo,
  liters: 40,
  sum,
  currency,
  station: "АЗС",
  full: true,
  note: "",
  grade: null,
});
const wishOf = (over: Partial<Wish>): Wish => ({
  id: "w1",
  car: CAR,
  title: "Шини",
  price: 100,
  priceMax: null,
  currency: "EUR",
  links: [],
  note: "",
  added: "2026-01-12",
  done: false,
  doneDate: null,
  recordId: null,
  ...over,
});

describe("підсумки на екрані — в основній валюті", () => {
  const data: GarageData = {
    ...emptyData(),
    cars: [{ id: CAR, name: "Тест" }],
    service: [svc("s1", "2026-01-09", 100, "EUR"), svc("s2", "2026-01-12", 4100, "UAH")],
    fuel: [fl("f1", "2026-01-09", 1000, 2000, "UAH"), fl("f2", "2026-01-12", 1500, 50, "USD")],
    wishes: [wishOf({})],
  };
  const today = "2026-01-15";

  it("кожен запис — за курсом на свою дату, разом із додатковою валютою", () => {
    const view = carView(data, CAR, today, prefsOf({ lang: "ru", currency: { main: "USD", second: "UAH" } }), rates);
    // 100 € × 44 / 40 = 110 $; 4100 ₴ / 41 = 100 $; 2000 ₴ / 40 = 50 $; 50 $.
    expect(view.totals.service).toEqual({ sum: 210, rest: {} });
    expect(view.totals.fuel).toEqual({ sum: 100, rest: {} });
    expect(view.totals.all.sum).toBe(310);
    expect(view.summary.total).toBe(310);
    expect(view.fuelTotals.spent).toBe(100);
    // У гривні: 4400 + 4100 + 2000 + 2050.
    expect(view.second).toEqual({ currency: "UAH", total: { sum: 12550, rest: {} } });
    // Самі записи лишаються у своїх валютах.
    expect(view.service.map((r) => r.currency)).toEqual(["EUR", "UAH"]);
    expect(view.serviceMain.map((r) => r.sum)).toEqual([110, 100]);
    expect(view.money.sumOf(data.service[0])).toBe(110);
    // Хотілка: 100 € × 45 / 41 на день, коли її додали.
    expect(view.money.wish(data.wishes[0])?.price).toBe(109.76);
  });

  it("без курсів гривня рахується, а решта видно окремо", () => {
    const view = carView(data, CAR, today, prefsOf({ lang: "ru" }), {});
    expect(view.totals.all).toEqual({ sum: 6100, rest: { USD: 50, EUR: 100 } });
    // Додаткова за замовчуванням для російської — долар: без курсів у ньому лише доларова заправка.
    expect(view.second).toEqual({ currency: "USD", total: { sum: 50, rest: { UAH: 6100, EUR: 100 } } });
  });

  it("без додаткової валюти — без другого рядка", () => {
    const view = carView(data, CAR, today, prefsOf({ lang: "en" }), rates);
    expect(view.money.main).toBe("USD");
    expect(view.second).toBeNull();
  });

  it("той самий вигляд, доки не змінились дані, курси чи валюти", () => {
    const p = prefsOf({ lang: "ru" });
    expect(carView(data, CAR, today, p, rates)).toBe(carView(data, CAR, today, p, rates));
    expect(carView(data, CAR, today, p, rates)).not.toBe(carView(data, CAR, today, pickMain(p, "EUR"), rates));
    expect(carView(data, CAR, today, p, rates)).not.toBe(carView(data, CAR, today, p, { ...rates }));
  });
});

describe("валюта в даних", () => {
  it("сервер приймає лише три коди, а без поля — гривня", () => {
    const base = { id: "s1", car: CAR, date: "2026-01-09", odo: null, cat: "Ремонт", what: "x", where: "", sum: 1, note: "" };
    const parse = (data: object) => opSchema.safeParse({ type: "service.put", data });
    const old = parse(base);
    expect(old.success && old.data.type === "service.put" && old.data.data.currency).toBe("UAH");
    expect(parse({ ...base, currency: "EUR" }).success).toBe(true);
    expect(parse({ ...base, currency: "GBP" }).success).toBe(false);
    expect(parse({ ...base, currency: "usd" }).success).toBe(false);
  });

  const data = {
    ...emptyData(),
    cars: [{ id: CAR, name: "Тест" }],
    service: [svc("s1", "2026-01-09", 100, "EUR"), svc("s2", "2026-01-09", 100, "UAH")],
    fuel: [fl("f1", "2026-01-09", 1000, 50, "USD")],
    wishes: [wishOf({})],
  };

  it("бекап зберігає валюту й читає її назад", () => {
    let n = 0;
    const res = mergeBackup(emptyData(), JSON.parse(JSON.stringify(buildBackup(data))), () => `n${++n}`);
    expect(res.service.map((r) => [r.sum, r.currency])).toEqual([
      [100, "EUR"],
      [100, "UAH"],
    ]);
    expect(res.fuel[0].currency).toBe("USD");
    expect(res.wishes[0].currency).toBe("EUR");
    // Ті самі 100 у різних валютах — не дублікати; повторне відновлення нічого не додає.
    expect(res.added).toBe(4);
    expect(mergeBackup(data, buildBackup(data), () => "x").added).toBe(0);
  });

  it("старий бекап без валюти — гривні", () => {
    const backup = JSON.parse(JSON.stringify(buildBackup(data)));
    for (const list of [backup.service, backup.fuel, backup.wishes]) for (const r of list) delete r.currency;
    const res = mergeBackup(emptyData(), backup, () => crypto.randomUUID());
    expect([...res.service, ...res.fuel, ...res.wishes].every((r) => r.currency === "UAH")).toBe(true);
  });

  it("таблиця: валюта в стовпці, читається назад будь-якою мовою", () => {
    for (const lang of ["en", "uk", "ru"] as const) {
      const tabs = Object.fromEntries(buildSheets(data, "2026-01-15", lang).map((s) => [s.title, sheetValues(s)]));
      const res = mergeBackup(emptyData(), sheetsToBackup(tabs)!, () => crypto.randomUUID());
      expect(res.service.map((r) => r.currency).sort(), lang).toEqual(["EUR", "UAH"]);
      expect(res.fuel[0].currency, lang).toBe("USD");
      expect(res.wishes[0].currency, lang).toBe("EUR");
    }
  });

  it("зведення таблиці — в основній валюті, з її знаком у назві стовпця", () => {
    const sheets = buildSheets(data, "2026-01-15", "ru", { currency: "USD", rates });
    const summary = sheets[0];
    const col = summary.columns.findIndex((c) => c.title === "Вложено всего, $");
    // 110 $ + 2,5 $ + 50 $.
    expect(summary.rows[0][col]).toBe(162.5);
    expect(summary.columns.some((c) => c.title === "Обслуживание, $")).toBe(true);
  });

  it("стара таблиця з «Сумма, ₴» і без стовпця валюти читається як гривні", () => {
    const m = MESSAGES.ru.sheet;
    const tabs = {
      [m.tabs.service]: [
        ["Машина", "Дата", "Пробег, км", "Категория", "Что сделано / куплено", "Где", "Сумма, ₴", "Заметка", "ID"],
        ["Тест", "2026-01-09", 1000, "Ремонт", "Масло", "", 1500, "", "s9"],
      ],
      [m.tabs.fuel]: [
        ["Машина", "Дата", "Пробег, км", "Литры", "Сумма, ₴", "Цена литра, ₴", "Полный бак", "ID"],
        ["Тест", "2026-01-10", 1100, 40, 2000, 50, "да", "f9"],
      ],
    };
    const res = mergeBackup(emptyData(), sheetsToBackup(tabs)!, () => crypto.randomUUID());
    expect(res.service[0]).toMatchObject({ sum: 1500, currency: "UAH" });
    expect(res.fuel[0]).toMatchObject({ sum: 2000, currency: "UAH" });
  });
});
