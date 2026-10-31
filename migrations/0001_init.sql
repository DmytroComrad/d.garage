-- У базі лише текст і числа. Фото лежать на Google Диску користувача.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  email_key     TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  demo          INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_user ON sessions(user_id);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX password_resets_by_user ON password_resets(user_id);

CREATE TABLE cars (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id       TEXT NOT NULL,
  name     TEXT NOT NULL,
  name_key TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name_key)
) WITHOUT ROWID;

CREATE TABLE service_records (
  user_id TEXT NOT NULL,
  id      TEXT NOT NULL,
  car_id  TEXT NOT NULL,
  date    TEXT NOT NULL,
  odo     INTEGER,
  cat     TEXT NOT NULL,
  what    TEXT NOT NULL,
  place   TEXT NOT NULL DEFAULT '',
  sum     REAL NOT NULL,
  note    TEXT NOT NULL DEFAULT '',
  items   TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, car_id) REFERENCES cars(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX service_by_car ON service_records(user_id, car_id);

CREATE TABLE fuel_records (
  user_id TEXT NOT NULL,
  id      TEXT NOT NULL,
  car_id  TEXT NOT NULL,
  date    TEXT NOT NULL,
  odo     INTEGER NOT NULL,
  liters  REAL NOT NULL,
  sum     REAL NOT NULL,
  station TEXT NOT NULL DEFAULT '',
  full    INTEGER NOT NULL DEFAULT 1,
  note    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, car_id) REFERENCES cars(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX fuel_by_car ON fuel_records(user_id, car_id);

CREATE TABLE reminders (
  user_id   TEXT NOT NULL,
  id        TEXT NOT NULL,
  car_id    TEXT NOT NULL,
  title     TEXT NOT NULL DEFAULT '',
  due_odo   INTEGER,
  due_date  TEXT,
  done      INTEGER NOT NULL DEFAULT 0,
  done_date TEXT,
  notified  INTEGER NOT NULL DEFAULT 0,
  record_id TEXT,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, car_id) REFERENCES cars(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX reminders_by_car ON reminders(user_id, car_id);

CREATE TABLE photos (
  user_id    TEXT NOT NULL,
  id         TEXT NOT NULL,
  car_id     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  record_id  TEXT,
  drive_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  width      INTEGER,
  height     INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, car_id) REFERENCES cars(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX photos_by_record ON photos(user_id, record_id);

-- Токени Google зашифровані AES-GCM ключем із секрету Worker: витік бази їх не видає.
CREATE TABLE google_connections (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_email      TEXT,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc  TEXT,
  access_expires    INTEGER NOT NULL DEFAULT 0,
  root_folder_id    TEXT,
  gallery_folder_id TEXT,
  shots_folder_id   TEXT,
  sheet_id          TEXT,
  sheet_exported_at INTEGER,
  connected_at      INTEGER NOT NULL
);
