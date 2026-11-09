-- Марка пального на заправці: код із shared/fuelGrades.ts (A95, DT, LPG…). Порожньо — не вказано.
ALTER TABLE fuel_records ADD COLUMN grade TEXT;
