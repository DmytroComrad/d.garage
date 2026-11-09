-- Валюти записів: код із shared/currency.ts. Усе, що було до валют, — у гривнях.
ALTER TABLE service_records ADD COLUMN currency TEXT NOT NULL DEFAULT 'UAH';
ALTER TABLE fuel_records ADD COLUMN currency TEXT NOT NULL DEFAULT 'UAH';
ALTER TABLE wishes ADD COLUMN currency TEXT NOT NULL DEFAULT 'UAH';

-- Офіційні курси НБУ: гривень за одиницю валюти на дату. Спільні для всіх: це публічні дані, а не дані людей.
-- Курс минулої дати не змінюється, тож рядок, раз записаний, не оновлюється.
-- Рядок з кодом UAH і курсом 1 — позначка «дату вже запитали, але НБУ курсів на неї не має».
CREATE TABLE fx_rates (
  date TEXT NOT NULL,
  code TEXT NOT NULL,
  rate REAL NOT NULL,
  PRIMARY KEY (date, code)
) WITHOUT ROWID;

-- Дати, курси яких /api/state не встиг дотягнути сам: їх добирає cron невеликими пачками.
CREATE TABLE fx_queue (
  date TEXT PRIMARY KEY
) WITHOUT ROWID;
