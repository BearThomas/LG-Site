-- LG-Site D1 compatibility store.
-- This keeps the original Appwrite document shape while moving high-frequency data to D1.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS appwrite_documents (
  database_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  permissions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(permissions_json)),
  owner_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_file TEXT,
  source_snapshot_at TEXT,
  PRIMARY KEY (database_id, collection_id, id)
);

CREATE INDEX IF NOT EXISTS idx_appwrite_documents_collection_created
  ON appwrite_documents (database_id, collection_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_appwrite_documents_collection_updated
  ON appwrite_documents (database_id, collection_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_appwrite_documents_owner
  ON appwrite_documents (database_id, collection_id, owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lg_migration_runs (
  id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  source_label TEXT NOT NULL,
  document_count INTEGER NOT NULL,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json))
);
