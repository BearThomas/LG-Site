function parseMap(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function onRequestGet(context) {
  const config = {
    appwriteEndpoint: String(context.env.APPWRITE_ENDPOINT || ""),
    appwriteProjectId: String(context.env.APPWRITE_PROJECT_ID || ""),
    databaseIds: parseMap(context.env.APPWRITE_DATABASE_IDS_JSON),
    collectionIds: parseMap(context.env.APPWRITE_COLLECTION_IDS_JSON),
    d1ApiBase: String(context.env.D1_API_BASE || "/api/d1"),
  };
  const body = `window.__LG_CONFIG__ = Object.freeze(${JSON.stringify(config)});`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
