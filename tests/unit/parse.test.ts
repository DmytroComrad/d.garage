import { describe, expect, it } from "vitest";
import { wishesTotal } from "../../shared/calc";
import { fmtMoneyRange } from "../../shared/format";
import { isIsoDate, parseDecimal, parseMoney, parseOdo, parsePriceRange } from "../../shared/parse";

describe("пробіг", () => {
  it("прибирає пробіли, крапки, коми й одиниці", () => {
    expect(parseOdo("328 030")).toBe(328030);
    expect(parseOdo("328 030 км")).toBe(328030);
    expect(parseOdo("328.030")).toBe(328030);
    expect(parseOdo("328,030")).toBe(328030);
  });
  it("порожньо → null, сміття й завеликий пробіг → invalid", () => {
    expect(parseOdo("")).toBeNull();
    expect(parseOdo("abc")).toBe("invalid");
    expect(parseOdo("999999999999")).toBe("invalid");
  });
});

describe("дробові числа", () => {
  it("кома і крапка разом: десятковий той, що останній", () => {
    expect(parseDecimal("1,234.56")).toBe(1234.56);
    expect(parseDecimal("1.234,56")).toBe(1234.56);
  });
  it("один роздільник кілька разів: тисячі", () => {
    expect(parseDecimal("1,234,567")).toBe(1234567);
    expect(parseDecimal("1.234.567")).toBe(1234567);
  });
  it("для грошей рівно 3 цифри після роздільника: тисячі", () => {
    expect(parseMoney("4,305")).toBe(4305);
    expect(parseMoney("4.305")).toBe(4305);
  });
  it("для літрів 3 цифри після роздільника: десятковий", () => {
    expect(parseDecimal("37.740")).toBe(37.74);
  });
  it("в інших випадках десятковий", () => {
    expect(parseMoney("2939,95")).toBe(2939.95);
    expect(parseDecimal("37,74")).toBe(37.74);
    expect(parseMoney("4305,5")).toBe(4305.5);
  });
  it("прибирає пробіли та одиниці", () => {
    expect(parseMoney("4 305,00 ₴")).toBe(4305);
    expect(parseMoney("4 305 грн")).toBe(4305);
    expect(parseDecimal("30 л")).toBe(30);
  });
  it("порожньо → null, сміття → invalid", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("много")).toBe("invalid");
  });
});

describe("дати", () => {
  it("приймає лише справжні календарні дати", () => {
    expect(isIsoDate("2026-08-17")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-13-45")).toBe(false);
    expect(isIsoDate("17.08.2026")).toBe(false);
    expect(isIsoDate(20260817)).toBe(false);
  });
});

describe("ціна хотілки «від-до»", () => {
  it("одне число — одна ціна, порожньо — без ціни", () => {
    expect(parsePriceRange("14000")).toEqual({ price: 14000, priceMax: null });
    expect(parsePriceRange("14 000 ₴")).toEqual({ price: 14000, priceMax: null });
    expect(parsePriceRange("")).toEqual({ price: null, priceMax: null });
  });
  it("діапазон через дефіс, тире чи крапки, з пробілами й гривнями", () => {
    for (const raw of ["4000-6000", "4000 - 6000", "4 000–6 000 ₴", "4000—6000", "4000..6000", "4000…6000", "4.000-6.000"]) {
      expect(parsePriceRange(raw), raw).toEqual({ price: 4000, priceMax: 6000 });
    }
    expect(parsePriceRange("1499,90-2000")).toEqual({ price: 1499.9, priceMax: 2000 });
  });
  it("межі навпаки міняються місцями, однакові дають одну ціну", () => {
    expect(parsePriceRange("6000-4000")).toEqual({ price: 4000, priceMax: 6000 });
    expect(parsePriceRange("5000-5000")).toEqual({ price: 5000, priceMax: null });
  });
  it("незакінчений діапазон, три межі чи текст — помилка", () => {
    for (const raw of ["4000-", "-6000", "4000-5000-6000", "від 4000", "4000-abc"]) {
      expect(parsePriceRange(raw), raw).toBe("invalid");
    }
  });
  it("разом: від суми нижніх меж до суми верхніх, хотілки без ціни не рахуються", () => {
    const total = wishesTotal([
      { price: 4000, priceMax: 6000 },
      { price: 1000, priceMax: null },
      { price: null, priceMax: null },
    ]);
    expect(total).toEqual({ min: 5000, max: 7000 });
    expect(fmtMoneyRange(total.min, total.max, "UAH").replace(/\s/g, " ")).toBe("5,000–7,000 ₴");
    expect(fmtMoneyRange(1000, null, "UAH").replace(/\s/g, " ")).toBe("1,000 ₴");
  });
});
