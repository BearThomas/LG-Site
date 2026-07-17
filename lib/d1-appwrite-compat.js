import { Account } from "appwrite";

const jwtCache = new WeakMap();

class D1AppwriteException extends Error {
  constructor(message, code = 500, type = "general_error", response = undefined) {
    super(message);
    this.name = "AppwriteException";
    this.code = code;
    this.type = type;
    this.response = response;
  }
}

function objectOrPositional(args, names) {
  if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) return args[0];
  return Object.fromEntries(names.map((name, index) => [name, args[index]]));
}

function apiBase() {
  return globalThis.__LG_CONFIG__?.d1ApiBase || "/api/d1";
}

async function parseResponse(response) {
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new D1AppwriteException(payload.message || "请求失败", payload.code || response.status, payload.type, payload);
  return payload;
}

export class D1Databases {
  constructor(client) {
    this.client = client;
    this.account = new Account(client);
  }

  async _jwt() {
    const cached = jwtCache.get(this.client);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.jwt;
    try {
      let result;
      try { result = await this.account.createJWT({ duration: 900 }); }
      catch { result = await this.account.createJWT(); }
      if (!result?.jwt) return "";
      jwtCache.set(this.client, { jwt: result.jwt, expiresAt: Date.now() + 12 * 60_000 });
      return result.jwt;
    } catch {
      jwtCache.set(this.client, { jwt: "", expiresAt: Date.now() + 20_000 });
      return "";
    }
  }

  async _request(action, args, { method = "POST" } = {}) {
    const jwt = await this._jwt();
    const headers = { "Accept": "application/json" };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    if (method === "GET") {
      const url = new URL(apiBase(), globalThis.location?.origin || "http://localhost");
      url.searchParams.set("action", action);
      for (const [key, value] of Object.entries(args)) {
        if (value === undefined) continue;
        url.searchParams.set(key, Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value));
      }
      return parseResponse(await fetch(url.toString(), { method, headers, credentials: "same-origin" }));
    }
    headers["Content-Type"] = "application/json";
    return parseResponse(await fetch(apiBase(), { method, headers, credentials: "same-origin", body: JSON.stringify({ action, args }) }));
  }

  listDocuments(...input) {
    const args = objectOrPositional(input, ["databaseId","collectionId","queries","transactionId"]);
    return this._request("listDocuments", args, { method: "GET" });
  }
  getDocument(...input) {
    const args = objectOrPositional(input, ["databaseId","collectionId","documentId","queries","transactionId"]);
    return this._request("getDocument", args, { method: "GET" });
  }
  createDocument(...input) {
    const args = objectOrPositional(input, ["databaseId","collectionId","documentId","data","permissions","transactionId"]);
    return this._request("createDocument", args);
  }
  updateDocument(...input) {
    const args = objectOrPositional(input, ["databaseId","collectionId","documentId","data","permissions","transactionId"]);
    return this._request("updateDocument", args, { method: "PATCH" });
  }
  deleteDocument(...input) {
    const args = objectOrPositional(input, ["databaseId","collectionId","documentId","transactionId"]);
    return this._request("deleteDocument", args, { method: "DELETE" });
  }
  incrementDocumentAttribute(...input) {
    const args = objectOrPositional(input, ["databaseId","collectionId","documentId","attribute","value","max","transactionId"]);
    return this._request("incrementDocumentAttribute", args, { method: "PATCH" });
  }
  decrementDocumentAttribute(...input) {
    const args = objectOrPositional(input, ["databaseId","collectionId","documentId","attribute","value","min","transactionId"]);
    return this._request("decrementDocumentAttribute", args, { method: "PATCH" });
  }
}

export { D1AppwriteException };
