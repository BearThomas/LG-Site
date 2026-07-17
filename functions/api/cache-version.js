// functions/api/cache-version.js
// GET /api/cache-version
// Returns the current cold backup version token + list of tombstoned item IDs.
// Frontend uses this to decide whether to re-fetch cold backup JSON from disk,
// saving D1 read quota on every page load after the first.
import { json, errorResponse, methodNotAllowed } from '../_lib/http.js';

function requireDb(env) {
  const db = env.DB;
  if (!db) throw new Error('D1 binding DB not found');
  return db;
}

export async function onRequestGet({ env }) {
  try {
    const db = requireDb(env);

    const [versionRow, tombstoneRows] = await Promise.all([
      db.prepare(`SELECT value FROM data_meta WHERE key = 'cold_data_version'`).first(),
      db.prepare(`SELECT collection, item_id FROM tombstones ORDER BY deleted_at DESC`).all()
    ]);

    const version = versionRow?.value ?? '0';
    const tombstones = (tombstoneRows?.results || []).map(r => ({
      collection: r.collection,
      id: r.item_id
    }));

    return json({
      version,
      tombstones,
      // Convenience maps for fast frontend lookup
      tombstoneIds: {
        posts: tombstones.filter(t => t.collection === 'posts').map(t => t.id),
        comments: tombstones.filter(t => t.collection === 'comments').map(t => t.id),
        confessions: tombstones.filter(t => t.collection === 'confessions').map(t => t.id)
      }
    }, 200, {
      // Cache for 60 seconds in browser; CDN should not cache (tombstones must be fresh)
      'Cache-Control': 'private, max-age=60'
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/cache-version', message: error.message }));
    return errorResponse(error, '获取缓存版本失败');
  }
}

export function onRequestPost() { return methodNotAllowed(['GET']); }
export function onRequestPatch() { return methodNotAllowed(['GET']); }
export function onRequestDelete() { return methodNotAllowed(['GET']); }
