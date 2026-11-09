-- Фото переїжджають з Google Диска користувача в наше сховище R2.
-- storage: 'drive' — файл ще лише на Диску, 'r2' — у сховищі, 'missing' — на Диску його вже немає.
ALTER TABLE photos ADD COLUMN storage TEXT NOT NULL DEFAULT 'drive';
CREATE INDEX photos_on_drive ON photos(user_id) WHERE storage = 'drive';

-- Черга на прибирання сховища. Фото зникає з бази різними шляхами (запис, машина, «видалити все», акаунт),
-- тож файли прибирає не кожен шлях окремо, а тригер ставить їх у чергу, яку розбирає cron.
CREATE TABLE media_gc (
  key        TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TRIGGER photos_gc AFTER DELETE ON photos WHEN OLD.storage = 'r2' BEGIN
  INSERT OR IGNORE INTO media_gc (key, created_at)
  VALUES ('p/' || OLD.user_id || '/' || OLD.id, CAST(strftime('%s', 'now') AS INTEGER));
END;
