CREATE TABLE IF NOT EXISTS user_follows (
    follower_id TEXT NOT NULL,
    followed_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (follower_id, followed_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_followed ON user_follows(followed_id);

ALTER TABLE users ADD COLUMN following_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN followers_count INTEGER NOT NULL DEFAULT 0;
