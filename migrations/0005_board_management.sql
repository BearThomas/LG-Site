-- 0005_board_management.sql
-- Add join_type to boards table
-- 0: public join instantly, 1: require approval
ALTER TABLE boards ADD COLUMN join_type INTEGER DEFAULT 0;

-- Create board requests table for membership approvals
CREATE TABLE IF NOT EXISTS board_requests (
  board_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  status     INTEGER DEFAULT 0, -- 0: pending, 1: approved, 2: rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (board_id, user_id)
);
