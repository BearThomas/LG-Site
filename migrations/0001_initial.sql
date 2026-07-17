PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  appwrite_user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar TEXT,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'normal',
  permissions INTEGER NOT NULL DEFAULT 31,
  joined_boards TEXT NOT NULL DEFAULT '["main"]',
  owned_boards TEXT NOT NULL DEFAULT '[]',
  class_name TEXT NOT NULL DEFAULT '',
  muted_until TEXT,
  banned INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL DEFAULT 'main',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  view_permission INTEGER NOT NULL DEFAULT 1,
  target_groups TEXT NOT NULL DEFAULT '[]',
  status INTEGER NOT NULL DEFAULT 0,
  edited_at TEXT,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS confessions (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  to_name TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS migration_orphans (
  collection_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  reason TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (collection_name, record_id)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_posts_board_created ON posts(board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visibility_created ON posts(view_permission, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_created ON comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_author_created ON comments(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_confessions_status_created ON confessions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_confessions_author_created ON confessions(author_id, created_at DESC);
