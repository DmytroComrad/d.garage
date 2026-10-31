import { describe, expect, it } from "vitest";
import { addMonths, reminderStatus, reminderText, remindersToNotify } from "../../shared/reminders";
import type { Reminder } from "../../shared/types";

const rem = (over: Partial<Reminder> = {}): Reminder => ({
  id: "r1",
  car: "c1",
  title: "Замена масла",
  dueOdo: 100000,
  dueDate: null,
  done: false,
  doneDate: null,
  notified: 0,
  recordId: null,
  ...over,
});
const today = "2026-09-15";
const norm = (s: string) => s.replace(/ /g, " ");

describe("статус нагадування", () => {
  it("за 1000 км і раніше рівень 0, потім 1", () => {
    expect(reminderStatus(rem(), 98999, today).level).toBe(0);
    expect(reminderStatus(rem(), 99000, today).level).toBe(1);
    expect(reminderStatus(rem(), 99499, today).level).toBe(1);
  });
  it("за 500 км рівень 2, на терміні й після рівень 3", () => {
    expect(reminderStatus(rem(), 99500, today).level).toBe(2);
    expect(reminderStatus(rem(), 100000, today).level).toBe(3);
    expect(reminderStatus(rem(), 100200, today).level).toBe(3);
  });
  it("текст сповіщення: «Через n км — замена масла»", () => {
    const status = reminderStatus(rem(), 99520, today);
    expect(norm(reminderText(status, "Замена масла"))).toBe("Через 480 км — замена масла");
  });
  it("прострочене показує, на скільки", () => {
    expect(norm(reminderStatus(rem(), 100120, today).when)).toBe("Просрочено на 120 км");
  });
  it("за датою: 30 і 7 днів", () => {
    const dated = rem({ dueOdo: null, dueDate: "2026-09-30" });
    expect(reminderStatus(dated, null, "2026-08-16").level).toBe(0);
    expect(reminderStatus(dated, null, "2026-08-31").level).toBe(1);
    expect(reminderStatus(dated, null, "2026-09-23").level).toBe(2);
    expect(reminderStatus(dated, null, "2026-09-30").level).toBe(3);
    expect(norm(reminderStatus(dated, null, "2026-09-27").when)).toBe("Через 3 дня");
  });
  it("і пробіг, і дата: береться терміновіше", () => {
    const both = rem({ dueDate: "2026-09-16" });
    const status = reminderStatus(both, 90000, today);
    expect(status.level).toBe(2);
    expect(norm(status.when)).toBe("Через 10 000 км или через 1 день");
  });
  it("без поточного пробігу за кілометрами не рахує", () => {
    expect(reminderStatus(rem(), null, today).level).toBe(0);
  });
});

describe("коли показувати вікно", () => {
  it("кожен поріг спрацьовує один раз", () => {
    const list = [rem()];
    expect(remindersToNotify(list, "c1", 99100, today, { afterSave: true })).toHaveLength(1);
    expect(remindersToNotify([rem({ notified: 1 })], "c1", 99100, today, { afterSave: true })).toHaveLength(0);
    expect(remindersToNotify([rem({ notified: 1 })], "c1", 99600, today, { afterSave: true })).toHaveLength(1);
    expect(remindersToNotify([rem({ notified: 2 })], "c1", 99600, today, { afterSave: true })).toHaveLength(0);
  });
  it("прострочене нагадує при кожному новому записі, але не при кожному відкритті", () => {
    const overdue = [rem({ notified: 3 })];
    expect(remindersToNotify(overdue, "c1", 100100, today, { afterSave: true })).toHaveLength(1);
    expect(remindersToNotify(overdue, "c1", 100100, today, { afterSave: false })).toHaveLength(0);
  });
  it("виконані та чужі машини не показуються", () => {
    expect(remindersToNotify([rem({ done: true })], "c1", 99600, today, { afterSave: true })).toHaveLength(0);
    expect(remindersToNotify([rem({ car: "c2" })], "c1", 99600, today, { afterSave: true })).toHaveLength(0);
  });
});

describe("дата через N місяців", () => {
  it("не вилазить за межі місяця", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-09-15", 12)).toBe("2027-09-15");
  });
});
