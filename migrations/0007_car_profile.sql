-- Профіль машини: рік, VIN, номер, кузов, двигун, пальне й покупка. Усе необов'язкове.
-- Перейменування (car.put) ці стовпці не чіпає: їх змінює лише окрема операція car.profile.
ALTER TABLE cars ADD COLUMN year INTEGER;
ALTER TABLE cars ADD COLUMN vin TEXT;
ALTER TABLE cars ADD COLUMN plate TEXT;
-- Кузов і пальне — стабільні коди (sedan, lpg_petrol…), а не підписи: підпис обирає інтерфейс своєю мовою.
ALTER TABLE cars ADD COLUMN body TEXT;
ALTER TABLE cars ADD COLUMN engine REAL;
ALTER TABLE cars ADD COLUMN fuel_type TEXT;
ALTER TABLE cars ADD COLUMN purchase_date TEXT;
ALTER TABLE cars ADD COLUMN purchase_price REAL;
ALTER TABLE cars ADD COLUMN about TEXT;
