(function (global) {
  const cache = new WeakMap();
  function unpack(args, names) {
    if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) return args[0];
    const out = {}; names.forEach((name, i) => out[name] = args[i]); return out;
  }
  class D1Databases {
    constructor(client) { this.client = client; this.account = new global.Appwrite.Account(client); }
    async jwt() {
      const current = cache.get(this.client);
      if (current && current.expiresAt > Date.now() + 60000) return current.jwt;
      try {
        let result;
        try { result = await this.account.createJWT({ duration: 900 }); } catch (_) { result = await this.account.createJWT(); }
        const jwt = result && result.jwt || ""; cache.set(this.client, { jwt, expiresAt: Date.now() + 720000 }); return jwt;
      } catch (_) { return ""; }
    }
    async call(action, args, method) {
      const jwt = await this.jwt(); const headers = { Accept: "application/json" }; if (jwt) headers.Authorization = "Bearer " + jwt;
      const base = global.__LG_CONFIG__ && global.__LG_CONFIG__.d1ApiBase || "/api/d1";
      let response;
      if (method === "GET") {
        const url = new URL(base, location.origin); url.searchParams.set("action", action);
        Object.keys(args).forEach((key) => args[key] !== undefined && url.searchParams.set(key, typeof args[key] === "object" ? JSON.stringify(args[key]) : String(args[key])));
        response = await fetch(url, { headers });
      } else {
        headers["Content-Type"] = "application/json"; response = await fetch(base, { method, headers, body: JSON.stringify({ action, args }) });
      }
      const body = await response.json().catch(() => ({})); if (!response.ok) { const e = new Error(body.message || "请求失败"); e.code = body.code || response.status; e.type = body.type; throw e; } return body;
    }
    listDocuments() { return this.call("listDocuments", unpack(arguments, ["databaseId","collectionId","queries","transactionId"]), "GET"); }
    getDocument() { return this.call("getDocument", unpack(arguments, ["databaseId","collectionId","documentId","queries","transactionId"]), "GET"); }
    createDocument() { return this.call("createDocument", unpack(arguments, ["databaseId","collectionId","documentId","data","permissions","transactionId"]), "POST"); }
    updateDocument() { return this.call("updateDocument", unpack(arguments, ["databaseId","collectionId","documentId","data","permissions","transactionId"]), "PATCH"); }
    deleteDocument() { return this.call("deleteDocument", unpack(arguments, ["databaseId","collectionId","documentId","transactionId"]), "DELETE"); }
  }
  global.D1Databases = D1Databases;
})(window);
