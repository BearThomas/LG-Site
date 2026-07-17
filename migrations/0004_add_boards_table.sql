-- 0004_add_boards_table.sql
-- Create boards table for user-created boards
CREATE TABLE IF NOT EXISTS boards (
  id           TEXT PRIMARY KEY,              -- lowercase alphanumeric ID (e.g., 'code-club')
  name         TEXT NOT NULL,                 -- Display name (e.g., '程序猿')
  description  TEXT DEFAULT '',               -- Short description
  owner_id     TEXT NOT NULL,                 -- Creator's user ID
  post_count   INTEGER DEFAULT 0,             -- Cache post count
  member_count INTEGER DEFAULT 0,             -- Cache member count
  status       INTEGER DEFAULT 0,             -- 0: active, 1: disabled
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_boards_owner ON boards(owner_id);
