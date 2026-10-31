import { describe, expect, it } from "vitest";
import { carSummary, fuelCalcs, fuelChipTone, fuelSummary, itemKindTotals, monthly, niceStep, sumMoney } from "../../shared/calc";
import { fmtConsumption, fmtDate, fmtKm, fmtMoney, fmtMoney0, plural } from "../../shared/format";
import type { ServiceRecord } from "../../shared/types";
import { CAR, fuel, partial, service } from "./fixtures";

const norm = (s: string) => s.replace(/ /g, " ");
const today = "2026-09-15";

describe("критерії приймання: демо-дані", () => {
  const calcs = fuelCalcs(fuel);
  const fs = fuelSummary(fuel);
  const cs = carSummary(service, fuel, today);

  it("витрата 31.08 = 7,8 л/100 на 431 км, у заправки 21.08 витрати немає", () => {
    expect(fmtConsumption(calcs.get("f2")?.consumption)).toBe("7,8 л/100");
    expect(calcs.get("f2")?.sinceLast).toBe(431);
    expect(calcs.get("f1")?.consumption).toBeNull();
    expect(calcs.get("f1")?.sinceLast).toBeNull();
  });

  it("ціна 77,90, середня 7,8, пальне на 1 км 6,11", () => {
    expect(fmtMoney(calcs.get("f1")?.price).startsWith("77,90")).toBe(true);
    expect(fs.avg?.toFixed(1)).toBe("7.8");
    expect(fs.perKm?.toFixed(2)).toBe("6.11");
  });

  it("вкладено 27 093 ₴, сервіс 21 520 ₴, пальне 5 572,97 ₴", () => {
    expect(norm(fmtMoney0(cs.total))).toBe("27 093 ₴");
    expect(norm(fmtMoney0(cs.serviceTotal))).toBe("21 520 ₴");
    expect(norm(fmtMoney(cs.fuelTotal))).toBe("5 572,97 ₴");
    expect(cs.total).toBe(27092.97);
  });

  it("пробіг 328 030, облік з 17.08.2026, проїхано 570 км, 1 км = 47,53 ₴", () => {
    expect(norm(fmtKm(cs.currentOdo))).toBe("328 030 км");
    expect(fmtDate(cs.since)).toBe("17.08.2026");
    expect(cs.driven).toBe(570);
    expect(cs.perKm?.toFixed(2)).toBe("47.53");
  });

  it("категорії: ТО 17 215 ₴ (80%), Ремонт 4 305 ₴ (20%)", () => {
    expect(cs.categories.map((c) => [c.name, c.sum, Math.round(c.share)])).toEqual([
      ["ТО / расходники", 17215, 80],
      ["Ремонт", 4305, 20],
    ]);
  });
});

describe("критерії приймання: неповний бак", () => {
  const all = [...fuel, ...partial];
  const calcs = fuelCalcs(all);

  it("друга заправка 8,8 (50 л / 570 км), середня 8,4 (83,8 л / 1001 км)", () => {
    expect(calcs.get("f4")?.consumption?.toFixed(1)).toBe("8.8");
    expect(fuelSummary(all).avg?.toFixed(1)).toBe("8.4");
  });

  it("неповна заправка не має власної витрати", () => {
    expect(calcs.get("f3")?.consumption).toBeNull();
  });
});

describe("розрахунки окремо для кожної машини", () => {
  it("зведення рахується лише за записами, які йому передали", () => {
    const other = { ...fuel[0], id: "x", car: "car2", odo: 100, liters: 999 };
    const only = [fuel[0], fuel[1], other].filter((f) => f.car === CAR);
    expect(fuelSummary(only).avg?.toFixed(1)).toBe("7.8");
  });
});

describe("зведення по місяцях", () => {
  it("від місяця першого запису до поточного", () => {
    const rows = monthly(service, fuel, today);
    expect(rows.map((r) => r.key)).toEqual(["2026-08", "2026-09"]);
    expect(rows[0].service).toBe(21520);
    expect(rows[0].fuel).toBe(5572.97);
    expect(rows[0].liters).toBe(71.54);
    expect(rows[1].total).toBe(0);
  });

  it("щонайбільше 12 місяців", () => {
    const old = [{ ...service[0], date: "2020-01-01" }];
    expect(monthly(old, [], today)).toHaveLength(12);
  });

  it("без записів лишається один місяць", () => {
    expect(monthly([], [], today)).toHaveLength(1);
  });
});

describe("допоміжне", () => {
  it("гроші сумуються без похибки плаваючої коми", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([2939.95, 2633.02])).toBe(5572.97);
  });

  it("крок осі: 1, 2, 2,5, 5 × 10ⁿ", () => {
    expect(niceStep(40000)).toBe(10000);
    expect(niceStep(21000)).toBe(10000);
    expect(niceStep(8000)).toBe(2000);
    expect(niceStep(9500)).toBe(2500);
    expect(niceStep(15000)).toBe(5000);
  });

  it("колір чипа витрати", () => {
    expect(fuelChipTone(7.5, 7.8)).toBe("good");
    expect(fuelChipTone(8.2, 7.8)).toBe("bad");
    expect(fuelChipTone(7.8, 7.8)).toBe("neutral");
    expect(fuelChipTone(7.8, null)).toBe("neutral");
  });

  it("множина записів", () => {
    const forms: [string, string, string] = ["запись", "записи", "записей"];
    expect(plural(1, forms)).toBe("запись");
    expect(plural(3, forms)).toBe("записи");
    expect(plural(11, forms)).toBe("записей");
    expect(plural(21, forms)).toBe("запись");
  });
});

describe("розбивка витрат", () => {
  const withItems: ServiceRecord = {
    ...service[0],
    sum: 9000,
    items: [
      { id: "a", kind: "parts", name: "Запчасти", sum: 5000 },
      { id: "b", kind: "labor", name: "Работа механика", sum: 3000 },
      { id: "c", kind: "extra", name: "Дополнительно", sum: 1000 },
    ],
  };

  it("суми за типами, а записи без розбивки окремо", () => {
    expect(itemKindTotals([withItems, service[1]])).toEqual([
      { kind: "parts", sum: 5000 },
      { kind: "labor", sum: 3000 },
      { kind: "extra", sum: 1000 },
      { kind: "none", sum: 8595 },
    ]);
  });
});
