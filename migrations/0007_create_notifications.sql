-- Add device_token to users table for push notifications
ALTER TABLE users ADD COLUMN device_token TEXT;

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    type TEXT NOT NULL,          -- 'comment', 'reply', 'system'
    title TEXT,
    content TEXT NOT NULL,
    target_id TEXT,             -- Post ID
    is_read INTEGER DEFAULT 0,  -- 0 = unread, 1 = read
    created_at TEXT NOT NULL
);

-- Index to accelerate querying unread notifications for a user
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient_id, is_read);
