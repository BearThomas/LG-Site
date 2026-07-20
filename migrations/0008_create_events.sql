CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    desc TEXT NOT NULL,
    tag TEXT,
    date TEXT NOT NULL,
    link TEXT,
    status TEXT NOT NULL DEFAULT 'published',
    submitter_id TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_submitter ON events(submitter_id);
