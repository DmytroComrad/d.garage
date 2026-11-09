import { describe, expect, it } from "vitest";
import {
  EMPTY_INPUTS,
  NO_FILTER,
  filterFromInputs,
  filterRecords,
  isFiltered,
  monthEnd,
  periodRange,
  recordMonths,
  sortRecords,
  sortWishes,
  sortsByDate,
} from "../../shared/listview";
import { fromKm } from "../../shared/prefs";

const rec = (id: string, date: string, odo: number | null, sum: number) => ({ id, date, odo, sum });
const list = [
  rec("a", "2026-01-10", 100000, 500),
  rec("b", "2026-03-05", 101500, 12000),
  rec("c", "2026-03-20", null, 800),
  rec("d", "2026-06-01", 104000, 3000),
  rec("e", "2025-12-31", 99000, 12000),
];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("фільтр записів", () => {
  it("без меж нічого не відкидає", () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(ids(filterRecords(list, NO_FILTER))).toEqual(ids(list));
  });

  it("період включає обидві межі, а переплутані межі міняються місцями", () => {
    const march = { ...NO_FILTER, from: "2026-03-05", to: "2026-03-20" };
    expect(ids(filterRecords(list, march))).toEqual(["b", "c"]);
    expect(ids(filterRecords(list, { ...march, from: march.to, to: march.from }))).toEqual(["b", "c"]);
    expect(ids(filterRecords(list, { ...NO_FILTER, from: "2026-01-01" }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterRecords(list, { ...NO_FILTER, to: "2025-12-31" }))).toEqual(["e"]);
  });

  it("відрізок пробігу відкидає записи без пробігу", () => {
    expect(ids(filterRecords(list, { ...NO_FILTER, odoFrom: 100000, odoTo: 102000 }))).toEqual(["a", "b"]);
    expect(ids(filterRecords(list, { ...NO_FILTER, odoFrom: 102000, odoTo: 100000 }))).toEqual(["a", "b"]);
    expect(ids(filterRecords(list, { ...NO_FILTER, odoFrom: 103000 }))).toEqual(["d"]);
  });

  it("поля фільтра: порожнє чи сміття не звужує, пробіг — у кілометри", () => {
    expect(filterFromInputs(EMPTY_INPUTS, "km")).toEqual(NO_FILTER);
    expect(filterFromInputs({ from: "2026-02-31", to: "x", odoFrom: "abc", odoTo: "" }, "km")).toEqual(NO_FILTER);
    expect(filterFromInputs({ from: "2026-01-01", to: "2026-12-31", odoFrom: "100 000", odoTo: "102.000 км" }, "km")).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      odoFrom: 100000,
      odoTo: 102000,
    });
  });

  it("у милях проходять саме ті записи, чий пробіг на екрані потрапляє в межі", () => {
    const f = filterFromInputs({ ...EMPTY_INPUTS, odoFrom: "1000", odoTo: "1000" }, "mi");
    for (let km = 1600; km <= 1620; km++) {
      const inside = filterRecords([rec("x", "2026-01-01", km, 1)], f).length === 1;
      expect(inside, `${km} км`).toBe(fromKm(km, "mi") === 1000);
    }
  });
});

describe("сортування записів", () => {
  it("за датою: нові або старі зверху; лише тоді список ділиться на місяці", () => {
    expect(ids(sortRecords(list, "new"))).toEqual(["d", "c", "b", "a", "e"]);
    expect(ids(sortRecords(list, "old"))).toEqual(["e", "a", "b", "c", "d"]);
    expect(sortsByDate("new") && sortsByDate("old")).toBe(true);
    expect(sortsByDate("expensive") || sortsByDate("odoLow")).toBe(false);
  });

  it("за сумою: однакові суми лишаються в порядку «нові зверху»", () => {
    expect(ids(sortRecords(list, "expensive"))).toEqual(["b", "e", "d", "c", "a"]);
    expect(ids(sortRecords(list, "cheap"))).toEqual(["a", "c", "d", "b", "e"]);
  });

  it("за пробігом: записи без пробігу в кінці в обох напрямках", () => {
    expect(ids(sortRecords(list, "odoHigh"))).toEqual(["d", "b", "a", "e", "c"]);
    expect(ids(sortRecords(list, "odoLow"))).toEqual(["e", "a", "b", "d", "c"]);
  });

  it("не змінює вхідний список", () => {
    const copy = [...list];
    sortRecords(list, "cheap");
    expect(list).toEqual(copy);
  });
});

describe("готові періоди", () => {
  const today = "2026-03-15";
  it("місяць, минулий місяць, 30 і 90 днів, рік, минулий рік", () => {
    expect(periodRange("month", today)).toEqual({ from: "2026-03-01", to: today });
    expect(periodRange("prevMonth", today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("days30", today)).toEqual({ from: "2026-02-14", to: today });
    expect(periodRange("days90", today)).toEqual({ from: "2025-12-16", to: today });
    expect(periodRange("year", today)).toEqual({ from: "2026-01-01", to: today });
    expect(periodRange("prevYear", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("минулий місяць у січні — грудень минулого року; кінець лютого у високосний рік", () => {
    expect(periodRange("prevMonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });
  it("місяці з записами — від нових до старих, без повторів", () => {
    expect(recordMonths(list)).toEqual(["2026-06", "2026-03", "2026-01", "2025-12"]);
  });
});

describe("сортування хотілок", () => {
  const wish = (title: string, added: string, price: number | null, done = false, priceMax: number | null = null) => ({
    title,
    added,
    price,
    priceMax,
    done,
  });
  const wishes = [
    wish("Шини", "2026-01-01", 14000),
    wish("Ароматизатор", "2026-03-01", null),
    wish("Килимки", "2026-02-01", 900, false, 3000),
    wish("Відеореєстратор", "2026-02-15", 5000, true),
  ];
  const titles = (rows: { title: string }[]) => rows.map((w) => w.title);
  const uk = new Intl.Collator("uk-UA");

  it("звичний порядок не змінюється", () => {
    expect(sortWishes(wishes, "added")).toBe(wishes);
  });
  it("виконані завжди під невиконаними", () => {
    expect(titles(sortWishes(wishes, "newest"))).toEqual(["Ароматизатор", "Килимки", "Шини", "Відеореєстратор"]);
    expect(titles(sortWishes(wishes, "title", uk))).toEqual(["Ароматизатор", "Килимки", "Шини", "Відеореєстратор"]);
  });
  it("за ціною діапазон рахується за верхньою межею, без ціни — в кінці", () => {
    expect(titles(sortWishes(wishes, "expensive"))).toEqual(["Шини", "Килимки", "Ароматизатор", "Відеореєстратор"]);
    expect(titles(sortWishes(wishes, "cheap"))).toEqual(["Килимки", "Шини", "Ароматизатор", "Відеореєстратор"]);
  });
});
