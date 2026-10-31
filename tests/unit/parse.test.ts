import { describe, expect, it } from "vitest";
import { parseDecimal, parseMoney, parseOdo } from "../../shared/parse";

describe("пробіг", () => {
  it("прибирає пробіли, крапки, коми й одиниці", () => {
    expect(parseOdo("328 030")).toBe(328030);
    expect(parseOdo("328 030 км")).toBe(328030);
    expect(parseOdo("328.030")).toBe(328030);
    expect(parseOdo("328,030")).toBe(328030);
  });
  it("порожньо → null, сміття → NaN", () => {
    expect(parseOdo("")).toBeNull();
    expect(parseOdo("abc")).toBeNaN();
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
  it("порожньо → null, сміття → NaN", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("много")).toBeNaN();
  });
});
