-- Ціна хотілки може бути діапазоном «від-до»: price — нижня межа, price_max — верхня. Порожньо — одна ціна.
ALTER TABLE wishes ADD COLUMN price_max REAL;
