-- 0003_add_system_tables.sql
-- Tombstone table: soft-delete records from cold backup archives
-- When a post/comment/confession is archived to JSON but needs deletion,
-- write its ID here. The frontend filters these out.
-- The weekly backup-d1.js will strip these from JSON files then clear this table.
CREATE TABLE IF NOT EXISTS tombstones (
  collection TEXT NOT NULL,   -- 'posts' | 'comments' | 'confessions'
  item_id    TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection, item_id)
);

-- Data meta table: version token for cold backup cache busting
-- cold_data_version is updated by backup-d1.js after each archive cycle.
-- Frontend compares this with localStorage to decide whether to re-fetch the cold JSON.
CREATE TABLE IF NOT EXISTS data_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO data_meta (key, value) VALUES ('cold_data_version', '0');
