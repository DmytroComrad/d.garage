-- Мануали: корисні матеріали для машини — посилання, нотатки й файли (PDF, картинки, будь-що).
-- Файл лежить у сховищі R2 за ключем m/<user>/<id>, у базі лише його назва, тип і розмір.
CREATE TABLE manuals (
  user_id   TEXT NOT NULL,
  id        TEXT NOT NULL,
  car_id    TEXT NOT NULL,
  title     TEXT NOT NULL,
  url       TEXT,
  note      TEXT NOT NULL DEFAULT '',
  added     TEXT NOT NULL,
  file_name TEXT,
  file_mime TEXT,
  file_size INTEGER,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, car_id) REFERENCES cars(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX manuals_by_car ON manuals(user_id, car_id);

ALTER TABLE users ADD COLUMN manuals_count INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER manuals_ai AFTER INSERT ON manuals BEGIN
  UPDATE users SET rev = rev + 1, manuals_count = manuals_count + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER manuals_au AFTER UPDATE ON manuals BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER manuals_ad AFTER DELETE ON manuals BEGIN
  UPDATE users SET rev = rev + 1, manuals_count = manuals_count - 1 WHERE id = OLD.user_id;
END;
-- Файл видаленого мануала прибирає cron, як і фото.
CREATE TRIGGER manuals_gc AFTER DELETE ON manuals WHEN OLD.file_name IS NOT NULL BEGIN
  INSERT OR IGNORE INTO media_gc (key, created_at)
  VALUES ('m/' || OLD.user_id || '/' || OLD.id, CAST(strftime('%s', 'now') AS INTEGER));
END;

-- Посилання, за яким інші користувачі можуть переглянути мануали машини й скопіювати потрібні собі.
-- Шукаємо за хешем токена; сам токен зашифровано ключем TOKEN_KEY, щоб власник міг скопіювати посилання ще раз.
CREATE TABLE manual_shares (
  token_hash TEXT PRIMARY KEY,
  token_enc  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  car_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id, car_id) REFERENCES cars(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE UNIQUE INDEX manual_shares_by_car ON manual_shares(user_id, car_id);
