-- rev росте при будь-якій зміні даних користувача: це дає відповідь 304 без читання всіх рядків.
-- Лічильники замінюють COUNT(*) при кожному записі. Тригери не дають забути про це в коді.

ALTER TABLE users ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN cars_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN service_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN fuel_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN reminders_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN photos_count INTEGER NOT NULL DEFAULT 0;

UPDATE users SET
  cars_count = (SELECT COUNT(*) FROM cars WHERE cars.user_id = users.id),
  service_count = (SELECT COUNT(*) FROM service_records WHERE service_records.user_id = users.id),
  fuel_count = (SELECT COUNT(*) FROM fuel_records WHERE fuel_records.user_id = users.id),
  reminders_count = (SELECT COUNT(*) FROM reminders WHERE reminders.user_id = users.id),
  photos_count = (SELECT COUNT(*) FROM photos WHERE photos.user_id = users.id);

CREATE TRIGGER cars_ai AFTER INSERT ON cars BEGIN
  UPDATE users SET rev = rev + 1, cars_count = cars_count + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER cars_au AFTER UPDATE ON cars BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER cars_ad AFTER DELETE ON cars BEGIN
  UPDATE users SET rev = rev + 1, cars_count = cars_count - 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER service_ai AFTER INSERT ON service_records BEGIN
  UPDATE users SET rev = rev + 1, service_count = service_count + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER service_au AFTER UPDATE ON service_records BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER service_ad AFTER DELETE ON service_records BEGIN
  UPDATE users SET rev = rev + 1, service_count = service_count - 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER fuel_ai AFTER INSERT ON fuel_records BEGIN
  UPDATE users SET rev = rev + 1, fuel_count = fuel_count + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER fuel_au AFTER UPDATE ON fuel_records BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER fuel_ad AFTER DELETE ON fuel_records BEGIN
  UPDATE users SET rev = rev + 1, fuel_count = fuel_count - 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER reminders_ai AFTER INSERT ON reminders BEGIN
  UPDATE users SET rev = rev + 1, reminders_count = reminders_count + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER reminders_au AFTER UPDATE ON reminders BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER reminders_ad AFTER DELETE ON reminders BEGIN
  UPDATE users SET rev = rev + 1, reminders_count = reminders_count - 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER photos_ai AFTER INSERT ON photos BEGIN
  UPDATE users SET rev = rev + 1, photos_count = photos_count + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER photos_au AFTER UPDATE ON photos BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER photos_ad AFTER DELETE ON photos BEGIN
  UPDATE users SET rev = rev + 1, photos_count = photos_count - 1 WHERE id = OLD.user_id;
END;

-- Оновлення токена доступа раз на годину не змінює те, що бачить користувач, тому його тут немає.
CREATE TRIGGER google_ai AFTER INSERT ON google_connections BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER google_au AFTER UPDATE OF google_email, sheet_id, sheet_exported_at ON google_connections BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER google_ad AFTER DELETE ON google_connections BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER users_au AFTER UPDATE OF email, name, password_hash, google_sub, demo ON users BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.id;
END;
