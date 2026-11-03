-- Хотілки: плани на машину з приблизною ціною й посиланнями. Виконана може посилатись на запис обслуговування.

CREATE TABLE wishes (
  user_id   TEXT NOT NULL,
  id        TEXT NOT NULL,
  car_id    TEXT NOT NULL,
  title     TEXT NOT NULL,
  price     REAL,
  links     TEXT NOT NULL DEFAULT '[]',
  note      TEXT NOT NULL DEFAULT '',
  added     TEXT NOT NULL,
  done      INTEGER NOT NULL DEFAULT 0,
  done_date TEXT,
  record_id TEXT,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, car_id) REFERENCES cars(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX wishes_by_car ON wishes(user_id, car_id);
CREATE INDEX wishes_by_record ON wishes(user_id, record_id);

ALTER TABLE users ADD COLUMN wishes_count INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER wishes_ai AFTER INSERT ON wishes BEGIN
  UPDATE users SET rev = rev + 1, wishes_count = wishes_count + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER wishes_au AFTER UPDATE ON wishes BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER wishes_ad AFTER DELETE ON wishes BEGIN
  UPDATE users SET rev = rev + 1, wishes_count = wishes_count - 1 WHERE id = OLD.user_id;
END;

-- Мова, якою названо папки на Диску. Порожньо — старі назви («Гараж Амедро»): їх перейменуємо при першому ж завантаженні.
ALTER TABLE google_connections ADD COLUMN folders_lang TEXT;
