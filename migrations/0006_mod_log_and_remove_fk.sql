-- 0006_mod_log_and_remove_fk.sql
-- Migration to create mod_log table and recreate comments without foreign key constraints.
BEGIN;

-- Create mod_log table
CREATE TABLE IF NOT EXISTS mod_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL, -- e.g., 'posts', 'comments', 'confessions'
  item_id TEXT NOT NULL,
  action TEXT NOT NULL, -- e.g., 'edit', 'delete'
  payload TEXT, -- JSON string of the changes (for edits)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recreate comments table without foreign key on post_id
ALTER TABLE comments RENAME TO comments_old;

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO comments (id, post_id, content, author_id, author_name, created_at, updated_at)
SELECT id, post_id, content, author_id, author_name, created_at, updated_at FROM comments_old;

DROP TABLE comments_old;

COMMIT;
