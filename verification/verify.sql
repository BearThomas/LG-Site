SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL SELECT 'posts', COUNT(*) FROM posts
UNION ALL SELECT 'comments', COUNT(*) FROM comments
UNION ALL SELECT 'confessions', COUNT(*) FROM confessions;

SELECT
  p.id,
  p.comment_count AS stored_count,
  COUNT(c.id) AS actual_count
FROM posts p
LEFT JOIN comments c ON c.post_id = p.id
GROUP BY p.id
HAVING stored_count != actual_count;

PRAGMA foreign_key_check;
