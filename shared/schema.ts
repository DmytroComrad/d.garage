import { z } from "zod";
import { LIMITS } from "./constants";
import { isIsoDate } from "./parse";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const isoDate = z.string().refine(isIsoDate);
const money = z
  .number()
  .finite()
  .min(0)
  .max(LIMITS.maxSum)
  .transform((v) => Math.round(v * 100) / 100);
const odo = z.number().int().min(0).max(LIMITS.maxOdo);

export const carSchema = z.object({ id, name: z.string().trim().min(1).max(LIMITS.carNameLength) });

export const serviceItemSchema = z.object({
  id,
  kind: z.enum(["parts", "labor", "extra"]),
  name: z.string().trim().max(LIMITS.itemNameLength),
  sum: money,
});

export const serviceSchema = z.object({
  id,
  car: id,
  date: isoDate,
  odo: odo.nullable(),
  cat: z.string().trim().min(1).max(LIMITS.categoryLength),
  what: z.string().trim().min(1).max(LIMITS.whatLength),
  where: z.string().trim().max(LIMITS.placeLength),
  sum: money,
  note: z.string().trim().max(LIMITS.noteLength),
  items: z.array(serviceItemSchema).max(LIMITS.itemsPerRecord).default([]),
});

export const fuelSchema = z.object({
  id,
  car: id,
  date: isoDate,
  odo,
  liters: z.number().finite().positive().max(LIMITS.maxLiters),
  sum: money.refine((v) => v > 0),
  station: z.string().trim().max(LIMITS.placeLength),
  full: z.boolean(),
  note: z.string().trim().max(LIMITS.noteLength),
});

export const reminderSchema = z
  .object({
    id,
    car: id,
    title: z.string().trim().max(LIMITS.titleLength),
    dueOdo: odo.nullable(),
    dueDate: isoDate.nullable(),
    done: z.boolean(),
    doneDate: isoDate.nullable(),
    notified: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    recordId: id.nullable(),
  })
  .refine((r) => r.dueOdo != null || r.dueDate != null);

export const opSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("car.put"), data: carSchema }),
  z.object({ type: z.literal("car.del"), id }),
  z.object({ type: z.literal("service.put"), data: serviceSchema }),
  z.object({ type: z.literal("service.del"), id }),
  z.object({ type: z.literal("fuel.put"), data: fuelSchema }),
  z.object({ type: z.literal("fuel.del"), id }),
  z.object({ type: z.literal("reminder.put"), data: reminderSchema }),
  z.object({ type: z.literal("reminder.del"), id }),
  z.object({ type: z.literal("demo.set"), value: z.boolean() }),
  z.object({ type: z.literal("all.del") }),
]);

export const opsRequestSchema = z.object({
  ops: z.array(opSchema).min(1).max(LIMITS.opsPerRequest),
});

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(8).max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().max(LIMITS.personNameLength).default(""),
  turnstile: z.string().max(4096).nullish(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const forgotSchema = z.object({
  email: emailSchema,
  turnstile: z.string().max(4096).nullish(),
});

export const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  current: z.string().max(200).optional(),
  next: passwordSchema,
});

export const profileSchema = z.object({ name: z.string().trim().max(LIMITS.personNameLength) });
