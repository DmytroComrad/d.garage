-- Контакти: корисні люди для машини (механік, продавець запчастин). Видно лише власнику.
-- share_hash — SHA-256 токена публічного посилання на один контакт. Сам токен ніде не зберігається:
-- витік бази посилань не видає, а вимкнене посилання (NULL) перестає відкриватися одразу.

CREATE TABLE contacts (
  user_id    TEXT NOT NULL,
  id         TEXT NOT NULL,
  car_id     TEXT NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  share_hash TEXT,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, car_id) REFERENCES cars(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX contacts_by_car ON contacts(user_id, car_id);
CREATE UNIQUE INDEX contacts_by_share ON contacts(share_hash);

ALTER TABLE users ADD COLUMN contacts_count INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
  UPDATE users SET rev = rev + 1, contacts_count = contacts_count + 1 WHERE id = NEW.user_id;
END;
-- Увімкнення й вимкнення посилання теж змінює rev: інші пристрої побачать, що контактом поділились.
CREATE TRIGGER contacts_au AFTER UPDATE ON contacts BEGIN
  UPDATE users SET rev = rev + 1 WHERE id = NEW.user_id;
END;
CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
  UPDATE users SET rev = rev + 1, contacts_count = contacts_count - 1 WHERE id = OLD.user_id;
END;
