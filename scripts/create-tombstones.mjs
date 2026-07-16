// scripts/create-tombstones.mjs
// Run with: npx -y wrangler@latest d1 execute <DATABASE_NAME> --file=./scripts/create-tombstones.mjs
// This script creates the `tombstones` table if it does not exist.

export async function run(env) {
  const db = env.DB;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS tombstones (
      collection TEXT NOT NULL,
      item_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (collection, item_id)
    )
  `).run();
  console.log('tombstones table ensured');
}
