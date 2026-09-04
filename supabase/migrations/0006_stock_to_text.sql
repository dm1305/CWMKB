-- 0006_stock_to_text.sql
-- 230/1513 real stock values are "120+" style, not plain integers.
-- Preserve them as-is rather than fabricating false precision.
--
-- APPLIED to jhixcmtbigyjqhjtiaik on 2026-09-04.
alter table wines alter column stock type text using stock::text;
