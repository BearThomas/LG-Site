function parseMap(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function onRequestGet(context) {
  const vapidPublicKey = String(
    context.env.VAPID_PUBLIC_KEY ||
    "BA1lrxEsu6DcYOwWIJwFc2XNF2hQPpxRH_Ryl6__kHVCxqBBtwS-6EYCXG9Hfic34t8iRhWPFkD_FlyFzs2qIsc"
  );

  const acceptHeader = context.request.headers.get("accept") || "";
  if (acceptHeader.includes("application/json")) {
    return new Response(JSON.stringify({ vapidPublicKey }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const config = {
    appwriteEndpoint: String(context.env.APPWRITE_ENDPOINT || ""),
    appwriteProjectId: String(context.env.APPWRITE_PROJECT_ID || ""),
    databaseIds: parseMap(context.env.APPWRITE_DATABASE_IDS_JSON),
    collectionIds: parseMap(context.env.APPWRITE_COLLECTION_IDS_JSON),
    d1ApiBase: String(context.env.D1_API_BASE || "/api/d1"),
    vapidPublicKey,
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
