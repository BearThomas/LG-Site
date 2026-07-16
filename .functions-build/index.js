var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _lib/http.js
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status, message, details = void 0) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
};
var BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...headers }
  });
}
__name(json, "json");
async function readJsonBody(request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new HttpError(413, "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927");
  }
  if (!request.body) throw new HttpError(400, "\u8BF7\u6C42 JSON \u683C\u5F0F\u4E0D\u6B63\u786E");
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value: value2 } = await reader.read();
      if (done) break;
      totalBytes += value2.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927");
      }
      chunks.push(value2);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("body must be an object");
    }
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "\u8BF7\u6C42 JSON \u683C\u5F0F\u4E0D\u6B63\u786E");
  } finally {
    reader.releaseLock();
  }
}
__name(readJsonBody, "readJsonBody");
function methodNotAllowed(allowed = ["POST"]) {
  return json(
    { error: "Method not allowed" },
    405,
    { Allow: allowed.join(", ") }
  );
}
__name(methodNotAllowed, "methodNotAllowed");
function errorResponse(error, fallback = "\u670D\u52A1\u5668\u6682\u65F6\u4E0D\u53EF\u7528") {
  const status = Number(error?.status || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const message = safeStatus >= 500 && !error?.expose ? fallback : error?.message || fallback;
  return json(
    {
      error: message,
      ...error?.details ? { details: error.details } : {}
    },
    safeStatus
  );
}
__name(errorResponse, "errorResponse");

// _lib/appwrite.js
async function parseResponse(response) {
  if (response.status === 204) return {};
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { message: `Appwrite \u8FD4\u56DE HTTP ${response.status}` };
  }
  try {
    return await response.json();
  } catch {
    return { message: `Appwrite \u8FD4\u56DE\u4E86\u65E0\u6548 JSON\uFF08HTTP ${response.status}\uFF09` };
  }
}
__name(parseResponse, "parseResponse");
async function appwriteRequest(config, path, options = {}) {
  const response = await fetch(`${config.endpoint}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": config.projectId,
      ...config.apiKey ? { "X-Appwrite-Key": config.apiKey } : {},
      ...options.headers || {}
    }
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    const error = new HttpError(
      response.status,
      data.message || data.error || `Appwrite \u8BF7\u6C42\u5931\u8D25\uFF08${response.status}\uFF09`,
      data.type ? { type: data.type, code: data.code } : void 0
    );
    error.appwrite = data;
    throw error;
  }
  return data;
}
__name(appwriteRequest, "appwriteRequest");
function createPasswordSession(config, studentId, password) {
  return appwriteRequest(
    { ...config, apiKey: "" },
    "/account/sessions/email",
    {
      method: "POST",
      body: JSON.stringify({ email: `${studentId}@campus.local`, password })
    }
  );
}
__name(createPasswordSession, "createPasswordSession");
function getAccountWithSession(config, sessionSecret) {
  return appwriteRequest(
    { ...config, apiKey: "" },
    "/account",
    {
      method: "GET",
      headers: { "X-Appwrite-Session": sessionSecret }
    }
  );
}
__name(getAccountWithSession, "getAccountWithSession");
async function deleteCurrentSession(config, sessionSecret) {
  if (!sessionSecret) return;
  await appwriteRequest(
    { ...config, apiKey: "" },
    "/account/sessions/current",
    {
      method: "DELETE",
      headers: { "X-Appwrite-Session": sessionSecret }
    }
  );
}
__name(deleteCurrentSession, "deleteCurrentSession");
function createAuthUser(config, studentId, password, name) {
  return appwriteRequest(config, "/users", {
    method: "POST",
    body: JSON.stringify({
      userId: studentId,
      email: `${studentId}@campus.local`,
      password,
      name
    })
  });
}
__name(createAuthUser, "createAuthUser");
function getAuthUser(config, userId) {
  return appwriteRequest(config, `/users/${encodeURIComponent(userId)}`, { method: "GET" });
}
__name(getAuthUser, "getAuthUser");
async function deleteAuthUser(config, userId) {
  try {
    await appwriteRequest(config, `/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", event: "appwrite_user_rollback_failed", userId, status: error.status }));
  }
}
__name(deleteAuthUser, "deleteAuthUser");
function updatePasswordWithSession(config, sessionSecret, password, oldPassword) {
  return appwriteRequest(
    { ...config, apiKey: "" },
    "/account/password",
    {
      method: "PATCH",
      headers: { "X-Appwrite-Session": sessionSecret },
      body: JSON.stringify({ password, oldPassword })
    }
  );
}
__name(updatePasswordWithSession, "updatePasswordWithSession");

// _lib/config.js
function clean(value) {
  return String(value ?? "").replace(/^['"]|['"]$/g, "").trim();
}
__name(clean, "clean");
function required(env, name) {
  const value = clean(env?.[name]);
  if (!value) {
    const error = new HttpError(500, `\u7F3A\u5C11\u73AF\u5883\u53D8\u91CF\uFF1A${name}`);
    error.expose = true;
    throw error;
  }
  return value;
}
__name(required, "required");
function getAppwriteConfig(env, { requireApiKey = false } = {}) {
  const config = {
    endpoint: required(env, "APPWRITE_ENDPOINT").replace(/\/$/, ""),
    projectId: required(env, "APPWRITE_PROJECT_ID"),
    apiKey: clean(env.APPWRITE_API_KEY)
  };
  if (requireApiKey && !config.apiKey) {
    const error = new HttpError(500, "\u7F3A\u5C11\u73AF\u5883\u53D8\u91CF\uFF1AAPPWRITE_API_KEY");
    error.expose = true;
    throw error;
  }
  return config;
}
__name(getAppwriteConfig, "getAppwriteConfig");
function getAuthTokenSecret(env) {
  const secret = required(env, "AUTH_TOKEN_SECRET");
  if (secret.length < 32) {
    const error = new HttpError(500, "AUTH_TOKEN_SECRET \u81F3\u5C11\u9700\u8981 32 \u4E2A\u5B57\u7B26");
    error.expose = true;
    throw error;
  }
  return secret;
}
__name(getAuthTokenSecret, "getAuthTokenSecret");
function getRuntimeConfig(env) {
  return {
    tokenTtlSeconds: clampNumber(env.AUTH_SESSION_TTL_SECONDS, 15 * 60, 24 * 60 * 60, 60 * 60),
    timezoneOffsetMinutes: clampNumber(env.APP_TIMEZONE_OFFSET_MINUTES, -12 * 60, 14 * 60, 8 * 60),
    postDailyLimit: clampNumber(env.POST_DAILY_LIMIT, 1, 1e3, 5),
    commentDailyLimit: clampNumber(env.COMMENT_DAILY_LIMIT, 1, 5e3, 100),
    confessionDailyLimit: clampNumber(env.CONFESSION_DAILY_LIMIT, 1, 1e3, 20)
  };
}
__name(getRuntimeConfig, "getRuntimeConfig");
function getRegistrationQuestions(env) {
  const raw = required(env, "CAMPUS_VERIFY_QUESTIONS");
  try {
    const questions = JSON.parse(raw);
    if (!Array.isArray(questions) || questions.length < 2) {
      throw new Error("\u81F3\u5C11\u9700\u8981\u4E24\u9053\u9898");
    }
    for (const question of questions) {
      if (!question?.id || !question?.question || !Array.isArray(question.answers) || !question.answers.length) {
        throw new Error("\u9898\u76EE\u5FC5\u987B\u5305\u542B id\u3001question \u548C answers");
      }
    }
    return questions;
  } catch (error) {
    const wrapped = new HttpError(500, `CAMPUS_VERIFY_QUESTIONS \u683C\u5F0F\u9519\u8BEF\uFF1A${error.message}`);
    wrapped.expose = true;
    throw wrapped;
  }
}
__name(getRegistrationQuestions, "getRegistrationQuestions");
function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
__name(clampNumber, "clampNumber");

// _lib/db.js
function requireDb(env) {
  if (!env?.DB) {
    const error = new HttpError(500, "Cloudflare D1 \u7ED1\u5B9A DB \u5C1A\u672A\u914D\u7F6E");
    error.expose = true;
    throw error;
  }
  return env.DB;
}
__name(requireDb, "requireDb");
function normalizeUserId(value) {
  return String(value || "").trim().replace(/^student_/, "");
}
__name(normalizeUserId, "normalizeUserId");
function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
__name(parseJsonArray, "parseJsonArray");
function extractClass(studentId) {
  const id = normalizeUserId(studentId);
  if (!/^\d{6,12}$/.test(id)) return "";
  return `${id.slice(0, 4)}\u5C4A${id.slice(4, 6)}\u73ED`;
}
__name(extractClass, "extractClass");
async function getUserRow(env, userId) {
  const id = normalizeUserId(userId);
  if (!id) return null;
  return requireDb(env).prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(id).first();
}
__name(getUserRow, "getUserRow");
async function ensureUserRow(env, identity, defaults = {}) {
  const db = requireDb(env);
  const appwriteId = String(identity?.$id || identity?.id || defaults.appwriteUserId || "").trim();
  const accountEmail = String(identity?.email || defaults.email || "").trim();
  const emailStudentId = accountEmail.toLowerCase().endsWith("@campus.local") ? accountEmail.slice(0, -"@campus.local".length) : "";
  const id = normalizeUserId(defaults.userId || emailStudentId || appwriteId);
  if (!id) throw new HttpError(400, "\u7528\u6237 ID \u65E0\u6548");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const parseDate = /* @__PURE__ */ __name((val, fallback) => {
    if (!val || String(val).trim() === "") return fallback;
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
  }, "parseDate");
  const rawCreatedAt = defaults.createdAt || identity?.$createdAt || identity?.registration || identity?.created_at;
  const rawUpdatedAt = defaults.updatedAt || identity?.$updatedAt || identity?.updated_at;
  const createdAt = parseDate(rawCreatedAt, now);
  const updatedAt = parseDate(rawUpdatedAt, now);
  const name = String(defaults.name || identity?.name || `\u540C\u5B66${id.slice(-4)}`).trim().slice(0, 128) || `\u540C\u5B66${id.slice(-4)}`;
  const email = String(defaults.email || identity?.email || `${id}@campus.local`).trim();
  const className = String(defaults.className || extractClass(id));
  const inferredClassBoard = /^\d{6,12}$/.test(id) ? `class_${id.slice(0, 4)}_${id.slice(4, 6)}` : "";
  const joinedBoards = JSON.stringify(
    defaults.joinedBoards || ["main", inferredClassBoard].filter(Boolean)
  );
  const ownedBoards = JSON.stringify(defaults.ownedBoards || []);
  await db.prepare(`
    INSERT INTO users (
      id, appwrite_user_id, name, avatar, email, role, permissions,
      joined_boards, owned_boards, class_name, muted_until, banned,
      token_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      appwrite_user_id = excluded.appwrite_user_id,
      name = CASE
        WHEN users.name = '' OR users.name = ('\u540C\u5B66' || substr(users.id, -4)) THEN excluded.name
        ELSE users.name
      END,
      email = CASE WHEN users.email = '' THEN excluded.email ELSE users.email END,
      class_name = CASE WHEN users.class_name = '' THEN excluded.class_name ELSE users.class_name END,
      joined_boards = CASE
        WHEN users.joined_boards IN ('[]', '["main"]') THEN excluded.joined_boards
        ELSE users.joined_boards
      END,
      updated_at = excluded.updated_at
  `).bind(
    id,
    appwriteId || id,
    name,
    defaults.avatar || null,
    email,
    defaults.role || "normal",
    Number(defaults.permissions ?? 31),
    joinedBoards,
    ownedBoards,
    className,
    defaults.mutedUntil || null,
    defaults.banned ? 1 : 0,
    createdAt,
    updatedAt
  ).run();
  return getUserRow(env, id);
}
__name(ensureUserRow, "ensureUserRow");
function isAdmin(profile) {
  return profile?.role === "admin";
}
__name(isAdmin, "isAdmin");
function toUserDocument(row, { includePrivate = false } = {}) {
  if (!row) return null;
  const document = {
    $id: row.id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    userId: row.id,
    name: row.name,
    avatar: row.avatar || "",
    role: row.role || "normal"
  };
  if (includePrivate) {
    Object.assign(document, {
      email: row.email || "",
      permissions: Number(row.permissions || 0),
      joinedBoards: parseJsonArray(row.joined_boards),
      ownedBoards: parseJsonArray(row.owned_boards),
      class: row.class_name || "",
      mutedUntil: row.muted_until || null,
      banned: Boolean(row.banned)
    });
  }
  return document;
}
__name(toUserDocument, "toUserDocument");
function toPostDocument(row) {
  if (!row) return null;
  return {
    $id: row.id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    boardId: row.board_id,
    title: row.title,
    content: row.content,
    authorId: `student_${normalizeUserId(row.author_id)}`,
    authorName: row.author_name,
    viewPermission: Number(row.view_permission || 1),
    targetGroups: parseJsonArray(row.target_groups),
    status: Number(row.status || 0),
    editedAt: row.edited_at || null,
    commentCount: Number(row.comment_count || 0),
    likes: Number(row.likes || 0),
    liked: Boolean(row.liked)
  };
}
__name(toPostDocument, "toPostDocument");
function toCommentDocument(row) {
  if (!row) return null;
  return {
    $id: row.id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    postId: row.post_id,
    content: row.content,
    authorId: normalizeUserId(row.author_id),
    authorName: row.author_name
  };
}
__name(toCommentDocument, "toCommentDocument");
function toConfessionDocument(row, viewer = null) {
  if (!row) return null;
  const maySeeAuthor = viewer && (isAdmin(viewer) || normalizeUserId(viewer.id) === normalizeUserId(row.author_id));
  return {
    $id: row.id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    content: row.content,
    authorId: maySeeAuthor ? normalizeUserId(row.author_id) : "",
    authorName: maySeeAuthor ? row.author_name : "\u533F\u540D",
    toName: row.to_name || null,
    status: Number(row.status || 0),
    likes: Number(row.likes || 0)
  };
}
__name(toConfessionDocument, "toConfessionDocument");
async function getPostRow(env, postId) {
  if (!postId) return null;
  return requireDb(env).prepare("SELECT * FROM posts WHERE id = ? LIMIT 1").bind(String(postId)).first();
}
__name(getPostRow, "getPostRow");
function canViewPost(post, viewer) {
  if (!post) return false;
  const permission = Number(post.view_permission || 1);
  if (permission === 1) return true;
  if (!viewer) return false;
  if (isAdmin(viewer)) return true;
  const viewerId = normalizeUserId(viewer.id);
  if (normalizeUserId(post.author_id) === viewerId) return true;
  if (permission === 8) return false;
  const joinedBoards = parseJsonArray(viewer.joined_boards);
  if (permission === 2) return joinedBoards.includes(post.board_id);
  if (permission === 4) {
    const targets = parseJsonArray(post.target_groups).map(String);
    return targets.includes(viewerId) || targets.some((target) => joinedBoards.includes(target));
  }
  return false;
}
__name(canViewPost, "canViewPost");
function localDayStartIso(offsetMinutes = 480, nowMs = Date.now()) {
  const shifted = new Date(nowMs + offsetMinutes * 6e4);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMinutes * 6e4).toISOString();
}
__name(localDayStartIso, "localDayStartIso");

// _lib/session-cookie.js
var COOKIE_NAME = "lg_appwrite_session";
function cookieMap(request) {
  const result = /* @__PURE__ */ new Map();
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const encoded = part.slice(separator + 1).trim();
    try {
      result.set(name, decodeURIComponent(encoded));
    } catch {
      result.set(name, encoded);
    }
  }
  return result;
}
__name(cookieMap, "cookieMap");
function secureAttribute(request) {
  try {
    return new URL(request.url).protocol === "https:" ? "; Secure" : "";
  } catch {
    return "; Secure";
  }
}
__name(secureAttribute, "secureAttribute");
function cookieTtl(env, expire = "") {
  const configured = Number(clean(env?.AUTH_REFRESH_TTL_SECONDS));
  const fallback = 30 * 24 * 60 * 60;
  const requested = Number.isFinite(configured) ? Math.min(365 * 24 * 60 * 60, Math.max(60 * 60, Math.trunc(configured))) : fallback;
  const expiresAt = Date.parse(String(expire || ""));
  if (!Number.isFinite(expiresAt)) return requested;
  const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1e3));
  return Math.min(requested, remaining);
}
__name(cookieTtl, "cookieTtl");
function readSessionCookie(request) {
  return String(cookieMap(request).get(COOKIE_NAME) || "").trim();
}
__name(readSessionCookie, "readSessionCookie");
function createSessionCookie(request, env, sessionSecret, expire = "") {
  const value = encodeURIComponent(String(sessionSecret || "").trim());
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookieTtl(env, expire)}${secureAttribute(request)}`;
}
__name(createSessionCookie, "createSessionCookie");
function clearSessionCookie(request) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute(request)}`;
}
__name(clearSessionCookie, "clearSessionCookie");

// _lib/tokens.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new HttpError(401, "\u767B\u5F55\u51ED\u8BC1\u683C\u5F0F\u65E0\u6548");
  }
}
__name(base64UrlToBytes, "base64UrlToBytes");
async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}
__name(importHmacKey, "importHmacKey");
async function signToken(secret, claims, ttlSeconds) {
  const now = Math.floor(Date.now() / 1e3);
  const payload = {
    ...claims,
    iat: now,
    exp: now + ttlSeconds
  };
  const payloadPart = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadPart));
  return `${payloadPart}.${bytesToBase64Url(new Uint8Array(signature))}`;
}
__name(signToken, "signToken");
async function verifyToken(secret, token, { purpose } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new HttpError(401, "\u767B\u5F55\u51ED\u8BC1\u683C\u5F0F\u65E0\u6548");
  }
  const [payloadPart, signaturePart] = parts;
  const key = await importHmacKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signaturePart),
    encoder.encode(payloadPart)
  );
  if (!valid) throw new HttpError(401, "\u767B\u5F55\u51ED\u8BC1\u65E0\u6548");
  let payload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlToBytes(payloadPart)));
  } catch {
    throw new HttpError(401, "\u767B\u5F55\u51ED\u8BC1\u5185\u5BB9\u65E0\u6548");
  }
  const now = Math.floor(Date.now() / 1e3);
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < now) {
    throw new HttpError(401, "\u767B\u5F55\u51ED\u8BC1\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
  }
  if (purpose && payload.purpose !== purpose) {
    throw new HttpError(401, "\u767B\u5F55\u51ED\u8BC1\u7528\u9014\u4E0D\u5339\u914D");
  }
  return payload;
}
__name(verifyToken, "verifyToken");
function secureShuffle(items) {
  const result = [...items];
  const random = new Uint32Array(Math.max(1, result.length));
  crypto.getRandomValues(random);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = random[index] % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
__name(secureShuffle, "secureShuffle");

// _lib/auth.js
function readBearer(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}
__name(readBearer, "readBearer");
function readCredentials(request, body = {}) {
  return {
    appToken: String(
      request.headers.get("x-lg-token") || readBearer(request) || body.appToken || ""
    ).trim(),
    sessionSecret: String(
      readSessionCookie(request) || request.headers.get("x-appwrite-session") || body.sessionSecret || body.token || ""
    ).trim(),
    claimedUserId: normalizeUserId(body.userId || body.studentId || "")
  };
}
__name(readCredentials, "readCredentials");
async function issueAppToken(env, profile) {
  const secret = getAuthTokenSecret(env);
  const runtime = getRuntimeConfig(env);
  return signToken(
    secret,
    {
      purpose: "lg-session",
      sub: profile.id,
      ver: Number(profile.token_version || 0)
    },
    runtime.tokenTtlSeconds
  );
}
__name(issueAppToken, "issueAppToken");
async function requireAuth(request, env, body = {}) {
  const credentials = readCredentials(request, body);
  let profile;
  let account = null;
  if (credentials.appToken) {
    try {
      const payload = await verifyToken(
        getAuthTokenSecret(env),
        credentials.appToken,
        { purpose: "lg-session" }
      );
      profile = await getUserRow(env, payload.sub);
      if (!profile) throw new HttpError(401, "\u8D26\u53F7\u8D44\u6599\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
      if (Number(profile.token_version || 0) !== Number(payload.ver || 0)) {
        throw new HttpError(401, "\u767B\u5F55\u51ED\u8BC1\u5DF2\u88AB\u6CE8\u9500\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
      }
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401 || !credentials.sessionSecret) {
        throw error;
      }
    }
  }
  if (!profile && credentials.sessionSecret) {
    const config = getAppwriteConfig(env);
    account = await getAccountWithSession(config, credentials.sessionSecret);
    profile = await ensureUserRow(env, account);
  }
  if (!profile) {
    throw new HttpError(401, "\u8BF7\u5148\u767B\u5F55");
  }
  if (credentials.claimedUserId && credentials.claimedUserId !== normalizeUserId(profile.id)) {
    throw new HttpError(403, "\u767B\u5F55\u8EAB\u4EFD\u4E0E\u8BF7\u6C42\u7528\u6237\u4E0D\u5339\u914D");
  }
  if (Number(profile.banned || 0) === 1) {
    throw new HttpError(403, "\u8BE5\u8D26\u53F7\u5DF2\u88AB\u5C01\u7981");
  }
  return { profile, account, credentials };
}
__name(requireAuth, "requireAuth");
async function optionalAuth(request, env) {
  const credentials = readCredentials(request);
  if (!credentials.appToken && !credentials.sessionSecret) return null;
  try {
    return await requireAuth(request, env);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return null;
    throw error;
  }
}
__name(optionalAuth, "optionalAuth");
function assertNotMuted(profile) {
  if (!profile?.muted_until) return;
  const muteEnd = new Date(profile.muted_until);
  if (!Number.isNaN(muteEnd.getTime()) && muteEnd.getTime() > Date.now()) {
    throw new HttpError(403, `\u8D26\u53F7\u5DF2\u88AB\u7981\u8A00\u81F3 ${muteEnd.toISOString()}`);
  }
}
__name(assertNotMuted, "assertNotMuted");

// api/auth-jwt.js
function validStudentId(value) {
  return /^\d{6,12}$/.test(String(value || ""));
}
__name(validStudentId, "validStudentId");
async function onRequestPost({ request, env }) {
  let config = null;
  let sessionSecret = "";
  try {
    const body = await readJsonBody(request);
    const studentId = String(body.studentId || "").trim();
    const password = String(body.password || "");
    if (!validStudentId(studentId)) throw new HttpError(400, "\u5B66\u53F7\u683C\u5F0F\u4E0D\u6B63\u786E");
    if (!password) throw new HttpError(400, "\u8BF7\u8F93\u5165\u5BC6\u7801");
    config = getAppwriteConfig(env, { requireApiKey: true });
    const session = await createPasswordSession(config, studentId, password);
    sessionSecret = String(session.secret || session.$id || session.token || "").trim();
    const account = await getAuthUser(config, studentId);
    const profile = await ensureUserRow(env, account, { userId: studentId });
    if (Number(profile.banned || 0) === 1) throw new HttpError(403, "\u8BE5\u8D26\u53F7\u5DF2\u88AB\u5C01\u7981");
    if (sessionSecret) {
      deleteCurrentSession(config, sessionSecret).catch(() => {
      });
    }
    sessionSecret = "";
    const publicProfile = toUserDocument(profile, { includePrivate: true });
    return json({
      success: true,
      userId: profile.id,
      studentId: profile.id,
      name: profile.name,
      avatar: profile.avatar || "",
      profile: publicProfile,
      appToken: await issueAppToken(env, profile)
    });
  } catch (error) {
    if (config && sessionSecret) {
      try {
        await deleteCurrentSession(config, sessionSecret);
      } catch (cleanupError) {
        console.warn(JSON.stringify({ level: "warn", route: "/api/auth-jwt", event: "failed_session_cleanup", status: cleanupError.status }));
      }
    }
    console.error(JSON.stringify({ level: "error", route: "/api/auth-jwt", message: error.message, status: error.status }));
    if (error.status === 401) error.message = "\u5B66\u53F7\u6216\u5BC6\u7801\u4E0D\u6B63\u786E";
    return errorResponse(error, "\u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  }
}
__name(onRequestPost, "onRequestPost");
function onRequestGet() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet, "onRequestGet");

// api/auth-logout.js
async function onRequestPost2({ request, env }) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const { profile, credentials } = await requireAuth(request, env, body);
    await requireDb(env).prepare("UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?").bind((/* @__PURE__ */ new Date()).toISOString(), profile.id).run();
    if (credentials.sessionSecret) {
      try {
        await deleteCurrentSession(getAppwriteConfig(env), credentials.sessionSecret);
      } catch (error) {
        console.warn(JSON.stringify({ level: "warn", route: "/api/auth-logout", event: "appwrite_session_delete_failed", status: error.status }));
      }
    }
    return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/auth-logout", message: error.message, status: error.status }));
    const response = errorResponse(error, "\u9000\u51FA\u767B\u5F55\u5931\u8D25");
    response.headers.append("Set-Cookie", clearSessionCookie(request));
    return response;
  }
}
__name(onRequestPost2, "onRequestPost");
function onRequestGet2() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet2, "onRequestGet");

// api/auth-me.js
async function onRequestGet3({ request, env }) {
  try {
    const { profile, credentials } = await requireAuth(request, env);
    return json({
      success: true,
      profile: toUserDocument(profile, { includePrivate: true }),
      appToken: await issueAppToken(env, profile)
    }, 200, credentials.sessionSecret ? {
      // Also migrates legacy clients that supplied the Appwrite session in a header.
      "Set-Cookie": createSessionCookie(request, env, credentials.sessionSecret)
    } : {});
  } catch (error) {
    return errorResponse(error, "\u8BFB\u53D6\u767B\u5F55\u72B6\u6001\u5931\u8D25");
  }
}
__name(onRequestGet3, "onRequestGet");
function onRequestPost3() {
  return methodNotAllowed(["GET"]);
}
__name(onRequestPost3, "onRequestPost");

// api/auth-register.js
function validStudentId2(studentId) {
  if (!/^\d{6,8}$/.test(studentId)) return false;
  const year = Number(studentId.slice(0, 4));
  const classNumber = Number(studentId.slice(4, 6));
  const studentNumber = Number(studentId.slice(6));
  const currentYear = (/* @__PURE__ */ new Date()).getUTCFullYear();
  return year >= 2020 && year <= currentYear && classNumber >= 1 && classNumber <= 99 && studentNumber >= 1 && studentNumber <= 99;
}
__name(validStudentId2, "validStudentId");
async function verifyRegistration(env, studentId, token) {
  const payload = await verifyToken(getAuthTokenSecret(env), token, { purpose: "campus-registration" });
  if (String(payload.sub) !== studentId) throw new HttpError(403, "\u6821\u56ED\u8EAB\u4EFD\u9A8C\u8BC1\u4E0E\u5F53\u524D\u5B66\u53F7\u4E0D\u5339\u914D");
}
__name(verifyRegistration, "verifyRegistration");
async function onRequestPost4({ request, env }) {
  let newlyCreatedAuthUser = false;
  let studentId = "";
  let transientSessionSecret = "";
  let appwriteConfig = null;
  try {
    const body = await readJsonBody(request);
    studentId = String(body.studentId || "").trim();
    const password = String(body.password || "");
    const displayName = String(body.name || `\u540C\u5B66${studentId.slice(-4)}`).trim().slice(0, 12);
    const verificationToken = String(body.verificationToken || "");
    if (!validStudentId2(studentId)) throw new HttpError(400, "\u5B66\u53F7\u683C\u5F0F\u4E0D\u6B63\u786E");
    if (password.length < 8 || password.length > 256) throw new HttpError(400, "\u5BC6\u7801\u957F\u5EA6\u9700\u8981\u5728 8 \u5230 256 \u4F4D\u4E4B\u95F4");
    if (!displayName) throw new HttpError(400, "\u6635\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
    await verifyRegistration(env, studentId, verificationToken);
    if (await getUserRow(env, studentId)) throw new HttpError(409, "\u8BE5\u5B66\u53F7\u5DF2\u6CE8\u518C");
    const config = getAppwriteConfig(env, { requireApiKey: true });
    appwriteConfig = config;
    let account;
    try {
      account = await createAuthUser(config, studentId, password, displayName);
      newlyCreatedAuthUser = true;
    } catch (error) {
      if (error.status !== 409) throw error;
      const session = await createPasswordSession(config, studentId, password);
      transientSessionSecret = String(session.secret || "").trim();
      if (!transientSessionSecret) throw new HttpError(409, "\u8BE5\u5B66\u53F7\u5DF2\u6709\u8D26\u53F7\uFF0C\u8BF7\u4F7F\u7528\u539F\u5BC6\u7801\u767B\u5F55");
      account = await getAccountWithSession(config, transientSessionSecret);
    }
    const classBoard = `class_${studentId.slice(0, 4)}_${studentId.slice(4, 6)}`;
    const profile = await ensureUserRow(env, account, {
      userId: studentId,
      name: displayName,
      email: `${studentId}@campus.local`,
      className: extractClass(studentId),
      joinedBoards: ["main", classBoard],
      permissions: 31
    });
    if (transientSessionSecret) {
      try {
        await deleteCurrentSession(config, transientSessionSecret);
      } catch (cleanupError) {
        console.warn(JSON.stringify({ level: "warn", route: "/api/auth-register", event: "transient_session_cleanup_failed", status: cleanupError.status }));
      }
      transientSessionSecret = "";
    }
    return json({
      success: true,
      message: "\u6CE8\u518C\u6210\u529F",
      userId: profile.id,
      class: profile.class_name
    }, 201);
  } catch (error) {
    if (transientSessionSecret && appwriteConfig) {
      try {
        await deleteCurrentSession(appwriteConfig, transientSessionSecret);
      } catch {
      }
    }
    if (newlyCreatedAuthUser && studentId) {
      try {
        await deleteAuthUser(getAppwriteConfig(env, { requireApiKey: true }), studentId);
      } catch {
      }
    }
    console.error(JSON.stringify({ level: "error", route: "/api/auth-register", message: error.message, status: error.status }));
    return errorResponse(error, "\u6CE8\u518C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  }
}
__name(onRequestPost4, "onRequestPost");
function onRequestGet4() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet4, "onRequestGet");

// api/create-comment.js
async function onRequestPost5({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    assertNotMuted(profile);
    const postId = String(body.postId || "").trim();
    const content = String(body.content || "").trim();
    if (!postId) throw new HttpError(400, "\u7F3A\u5C11\u5E16\u5B50 ID");
    if (content.length < 2) throw new HttpError(400, "\u5185\u5BB9\u592A\u77ED\uFF0C\u591A\u8BF4\u4E24\u4E2A\u5B57\u5427");
    if (content.length > 500) throw new HttpError(400, "\u8BC4\u8BBA\u4E0D\u80FD\u8D85\u8FC7 500 \u4E2A\u5B57\u7B26");
    const post = await getPostRow(env, postId);
    if (!post) throw new HttpError(404, "\u5E16\u5B50\u4E0D\u5B58\u5728");
    if (!canViewPost(post, profile)) throw new HttpError(403, "\u65E0\u6743\u8BC4\u8BBA\u8BE5\u5E16\u5B50");
    if ((Number(post.status || 0) & 2) !== 0) throw new HttpError(403, "\u8BE5\u5E16\u5B50\u5DF2\u9501\u5B9A\uFF0C\u4E0D\u80FD\u7EE7\u7EED\u8BC4\u8BBA");
    const runtime = getRuntimeConfig(env);
    const dayStart = localDayStartIso(runtime.timezoneOffsetMinutes);
    const countRow = await requireDb(env).prepare(`
      SELECT COUNT(*) AS total
      FROM comments
      WHERE author_id = ? AND created_at >= ?
    `).bind(normalizeUserId(profile.id), dayStart).first();
    if (Number(countRow?.total || 0) >= runtime.commentDailyLimit) {
      throw new HttpError(429, `\u4ECA\u65E5\u8BC4\u8BBA\u5DF2\u8FBE\u4E0A\u9650\uFF08${runtime.commentDailyLimit} \u6761\uFF09`);
    }
    const id = crypto.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const db = requireDb(env);
    await db.batch([
      db.prepare(`
        INSERT INTO comments (
          id, post_id, content, author_id, author_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, postId, content, normalizeUserId(profile.id), profile.name, now, now),
      db.prepare("UPDATE posts SET comment_count = comment_count + 1, updated_at = updated_at WHERE id = ?").bind(postId)
    ]);
    return json({ success: true, commentId: id }, 201);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/create-comment", message: error.message, status: error.status }));
    return errorResponse(error, "\u53D1\u8868\u8BC4\u8BBA\u5931\u8D25");
  }
}
__name(onRequestPost5, "onRequestPost");
function onRequestGet5() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet5, "onRequestGet");

// api/create-confession.js
async function onRequestPost6({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    assertNotMuted(profile);
    const content = String(body.content || "").trim();
    const toName = String(body.toName || "").trim().slice(0, 50) || null;
    if (content.length < 5) throw new HttpError(400, "\u8868\u767D\u5185\u5BB9\u81F3\u5C11\u9700\u8981 5 \u4E2A\u5B57\u7B26");
    if (content.length > 2e3) throw new HttpError(400, "\u8868\u767D\u5185\u5BB9\u4E0D\u80FD\u8D85\u8FC7 2000 \u4E2A\u5B57\u7B26");
    const runtime = getRuntimeConfig(env);
    const dayStart = localDayStartIso(runtime.timezoneOffsetMinutes);
    const countRow = await requireDb(env).prepare(`
      SELECT COUNT(*) AS total
      FROM confessions
      WHERE author_id = ? AND created_at >= ?
    `).bind(normalizeUserId(profile.id), dayStart).first();
    if (Number(countRow?.total || 0) >= runtime.confessionDailyLimit) {
      throw new HttpError(429, `\u4ECA\u65E5\u533F\u540D\u53D1\u5E03\u5DF2\u8FBE\u4E0A\u9650\uFF08${runtime.confessionDailyLimit} \u6761\uFF09`);
    }
    const id = crypto.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await requireDb(env).prepare(`
      INSERT INTO confessions (
        id, content, author_id, author_name, to_name,
        status, likes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
    `).bind(id, content, normalizeUserId(profile.id), profile.name, toName, now, now).run();
    return json({ success: true, confessionId: id }, 201);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/create-confession", message: error.message, status: error.status }));
    return errorResponse(error, "\u53D1\u5E03\u5931\u8D25");
  }
}
__name(onRequestPost6, "onRequestPost");
function onRequestGet6() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet6, "onRequestGet");

// api/create-post.js
async function onRequestPost7({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    assertNotMuted(profile);
    const boardId = String(body.boardId || "main").trim();
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    const viewPermission = Number(body.viewPermission || 1);
    const targetGroups = Array.isArray(body.targetUsers) ? body.targetUsers.map((value) => String(value).trim()).filter(Boolean).slice(0, 50) : [];
    if (!boardId || !title || !content) throw new HttpError(400, "\u677F\u5757\u3001\u6807\u9898\u548C\u6B63\u6587\u4E0D\u80FD\u4E3A\u7A7A");
    if (title.length > 100) throw new HttpError(400, "\u6807\u9898\u4E0D\u80FD\u8D85\u8FC7 100 \u4E2A\u5B57\u7B26");
    if (content.length > 2e4) throw new HttpError(400, "\u6B63\u6587\u4E0D\u80FD\u8D85\u8FC7 20000 \u4E2A\u5B57\u7B26");
    if (![1, 2, 4, 8].includes(viewPermission)) throw new HttpError(400, "\u67E5\u770B\u6743\u9650\u8BBE\u7F6E\u65E0\u6548");
    if (viewPermission === 4 && !targetGroups.length) throw new HttpError(400, "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u53EF\u89C1\u7528\u6237\u6216\u7FA4\u7EC4");
    const joinedBoards = parseJsonArray(profile.joined_boards);
    if (!isAdmin(profile) && boardId !== "main" && !joinedBoards.includes(boardId)) {
      throw new HttpError(403, "\u4F60\u5C1A\u672A\u52A0\u5165\u8BE5\u677F\u5757");
    }
    const runtime = getRuntimeConfig(env);
    const dayStart = localDayStartIso(runtime.timezoneOffsetMinutes);
    const countRow = await requireDb(env).prepare(`
      SELECT COUNT(*) AS total
      FROM posts
      WHERE author_id = ? AND created_at >= ?
    `).bind(normalizeUserId(profile.id), dayStart).first();
    if (Number(countRow?.total || 0) >= runtime.postDailyLimit) {
      throw new HttpError(429, `\u4ECA\u65E5\u53D1\u5E16\u5DF2\u8FBE\u4E0A\u9650\uFF08${runtime.postDailyLimit} \u6761\uFF09\uFF0C\u8BF7\u660E\u5929\u518D\u6765`);
    }
    const id = crypto.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await requireDb(env).prepare(`
      INSERT INTO posts (
        id, board_id, title, content, author_id, author_name,
        view_permission, target_groups, status, edited_at,
        comment_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)
    `).bind(
      id,
      boardId,
      title,
      content,
      normalizeUserId(profile.id),
      profile.name,
      viewPermission,
      JSON.stringify(targetGroups),
      now,
      now
    ).run();
    return json({ success: true, postId: id }, 201);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/create-post", message: error.message, status: error.status }));
    return errorResponse(error, "\u53D1\u5E16\u5931\u8D25");
  }
}
__name(onRequestPost7, "onRequestPost");
function onRequestGet7() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet7, "onRequestGet");

// api/data.js
var COLLECTIONS = /* @__PURE__ */ new Set(["users", "posts", "confessions"]);
function parseQueries(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new HttpError(400, "\u67E5\u8BE2\u53C2\u6570\u683C\u5F0F\u4E0D\u6B63\u786E");
  }
}
__name(parseQueries, "parseQueries");
function queryState(queries) {
  const state = { equals: /* @__PURE__ */ new Map(), limit: 25, offset: 0, order: null };
  for (const query of queries) {
    if (!query || typeof query !== "object") continue;
    if (query.method === "equal" && query.attribute) {
      state.equals.set(String(query.attribute), Array.isArray(query.values) ? query.values : []);
    } else if (query.method === "limit") {
      state.limit = Math.min(100, Math.max(1, Number(query.values?.[0] || 25)));
    } else if (query.method === "offset") {
      state.offset = Math.max(0, Number(query.values?.[0] || 0));
    } else if (query.method === "orderDesc" || query.method === "orderAsc") {
      state.order = { attribute: String(query.attribute || ""), direction: query.method === "orderAsc" ? "ASC" : "DESC" };
    }
  }
  return state;
}
__name(queryState, "queryState");
async function listUsers(env, state, viewer) {
  const db = requireDb(env);
  const conditions = [];
  const values = [];
  const equalId = state.equals.get("userId") || state.equals.get("$id");
  if (equalId?.length) {
    const ids = equalId.map(normalizeUserId).filter(Boolean);
    if (!ids.length) return { total: 0, documents: [] };
    conditions.push(`id IN (${ids.map(() => "?").join(", ")})`);
    values.push(...ids);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const countStatement = db.prepare(`SELECT COUNT(*) AS total FROM users ${where}`).bind(...values);
  const rowsStatement = db.prepare(`
    SELECT * FROM users
    ${where}
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).bind(...values, state.limit, state.offset);
  const [countResult, rowsResult] = await db.batch([countStatement, rowsStatement]);
  const total = Number(countResult.results?.[0]?.total || 0);
  const documents = (rowsResult.results || []).map((row) => toUserDocument(row, {
    includePrivate: Boolean(viewer && (isAdmin(viewer) || normalizeUserId(viewer.id) === normalizeUserId(row.id)))
  }));
  return { total, documents };
}
__name(listUsers, "listUsers");
function appendPostVisibility(conditions, values, viewer) {
  if (viewer && isAdmin(viewer)) return;
  if (!viewer) {
    conditions.push("view_permission = 1");
    return;
  }
  const visibility = ["view_permission = 1", "author_id = ?"];
  values.push(normalizeUserId(viewer.id));
  const boards = parseJsonArray(viewer.joined_boards).map(String).filter(Boolean);
  if (boards.length) {
    visibility.push(`(view_permission = 2 AND board_id IN (${boards.map(() => "?").join(", ")}))`);
    values.push(...boards);
  }
  const targets = [normalizeUserId(viewer.id), ...boards];
  if (targets.length) {
    visibility.push(`(
      view_permission = 4 AND EXISTS (
        SELECT 1 FROM json_each(posts.target_groups)
        WHERE CAST(json_each.value AS TEXT) IN (${targets.map(() => "?").join(", ")})
      )
    )`);
    values.push(...targets);
  }
  conditions.push(`(${visibility.join(" OR ")})`);
}
__name(appendPostVisibility, "appendPostVisibility");
async function listPosts(env, state, viewer) {
  const db = requireDb(env);
  const conditions = [];
  const values = [];
  const boardValues = state.equals.get("boardId");
  if (boardValues?.length) {
    conditions.push(`board_id IN (${boardValues.map(() => "?").join(", ")})`);
    values.push(...boardValues.map(String));
  }
  appendPostVisibility(conditions, values, viewer);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderColumn = state.order?.attribute === "title" ? "title" : "created_at";
  const orderDirection = state.order?.direction || "DESC";
  const countStatement = db.prepare(`SELECT COUNT(*) AS total FROM posts ${where}`).bind(...values);
  const viewerId = viewer ? normalizeUserId(viewer.id) : "";
  const rowsStatement = db.prepare(`
    SELECT posts.*,
      (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS likes,
      (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) AS liked
    FROM posts
    ${where}
    ORDER BY ${orderColumn} ${orderDirection}
    LIMIT ? OFFSET ?
  `).bind(viewerId, ...values, state.limit, state.offset);
  const [countResult, rowsResult] = await db.batch([countStatement, rowsStatement]);
  return {
    total: Number(countResult.results?.[0]?.total || 0),
    documents: (rowsResult.results || []).map(toPostDocument)
  };
}
__name(listPosts, "listPosts");
async function listConfessions(env, state, viewer) {
  const db = requireDb(env);
  const conditions = [];
  const values = [];
  const statuses = state.equals.get("status");
  if (!viewer || !isAdmin(viewer)) {
    conditions.push("status = 0");
  } else if (statuses?.length) {
    conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    values.push(...statuses.map((value) => Number(value)));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderColumn = state.order?.attribute === "likes" ? "likes" : "created_at";
  const orderDirection = state.order?.direction || "DESC";
  const countStatement = db.prepare(`SELECT COUNT(*) AS total FROM confessions ${where}`).bind(...values);
  const rowsStatement = db.prepare(`
    SELECT * FROM confessions
    ${where}
    ORDER BY ${orderColumn} ${orderDirection}
    LIMIT ? OFFSET ?
  `).bind(...values, state.limit, state.offset);
  const [countResult, rowsResult] = await db.batch([countStatement, rowsStatement]);
  return {
    total: Number(countResult.results?.[0]?.total || 0),
    documents: (rowsResult.results || []).map((row) => toConfessionDocument(row, viewer))
  };
}
__name(listConfessions, "listConfessions");
async function getDocument(env, collection, documentId, viewer) {
  if (collection === "users") {
    const row = await getUserRow(env, documentId);
    if (!row) throw new HttpError(404, "\u7528\u6237\u4E0D\u5B58\u5728");
    return toUserDocument(row, {
      includePrivate: Boolean(viewer && (isAdmin(viewer) || normalizeUserId(viewer.id) === normalizeUserId(row.id)))
    });
  }
  if (collection === "posts") {
    const db = requireDb(env);
    const viewerId = viewer ? normalizeUserId(viewer.id) : "";
    const row = await db.prepare(`
      SELECT posts.*,
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS likes,
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) AS liked
      FROM posts
      WHERE id = ? LIMIT 1
    `).bind(viewerId, documentId).first();
    if (!row) throw new HttpError(404, "\u5E16\u5B50\u4E0D\u5B58\u5728");
    if (!canViewPost(row, viewer)) throw new HttpError(403, "\u65E0\u6743\u67E5\u770B\u8BE5\u5E16\u5B50");
    return toPostDocument(row);
  }
  if (collection === "confessions") {
    const row = await requireDb(env).prepare("SELECT * FROM confessions WHERE id = ? LIMIT 1").bind(documentId).first();
    if (!row) throw new HttpError(404, "\u5185\u5BB9\u4E0D\u5B58\u5728");
    if (Number(row.status || 0) !== 0 && !(viewer && isAdmin(viewer))) {
      throw new HttpError(404, "\u5185\u5BB9\u4E0D\u5B58\u5728");
    }
    return toConfessionDocument(row, viewer);
  }
  throw new HttpError(400, "\u4E0D\u652F\u6301\u7684\u6570\u636E\u96C6\u5408");
}
__name(getDocument, "getDocument");
async function onRequestGet8({ request, env }) {
  try {
    const url = new URL(request.url);
    const collection = String(url.searchParams.get("collection") || "");
    if (!COLLECTIONS.has(collection)) throw new HttpError(400, "\u4E0D\u652F\u6301\u7684\u6570\u636E\u96C6\u5408");
    const auth = await optionalAuth(request, env);
    const viewer = auth?.profile || null;
    const documentId = url.searchParams.get("documentId");
    if (documentId) return json(await getDocument(env, collection, documentId, viewer));
    const state = queryState(parseQueries(url.searchParams.get("queries")));
    if (collection === "users") return json(await listUsers(env, state, viewer));
    if (collection === "posts") return json(await listPosts(env, state, viewer));
    return json(await listConfessions(env, state, viewer));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/data", method: "GET", message: error.message, status: error.status }));
    return errorResponse(error, "\u8BFB\u53D6\u6570\u636E\u5931\u8D25");
  }
}
__name(onRequestGet8, "onRequestGet");
async function onRequestPatch({ request, env }) {
  try {
    const body = await readJsonBody(request);
    if (body.collection !== "posts") throw new HttpError(400, "\u8BE5\u96C6\u5408\u4E0D\u652F\u6301\u7F16\u8F91");
    const { profile } = await requireAuth(request, env, body);
    const post = await getPostRow(env, body.documentId);
    if (!post) throw new HttpError(404, "\u5E16\u5B50\u4E0D\u5B58\u5728");
    if (!isAdmin(profile) && normalizeUserId(post.author_id) !== normalizeUserId(profile.id)) {
      throw new HttpError(403, "\u53EA\u80FD\u7F16\u8F91\u81EA\u5DF1\u7684\u5E16\u5B50");
    }
    const title = String(body.data?.title ?? post.title).trim();
    const content = String(body.data?.content ?? post.content).trim();
    if (!title || !content) throw new HttpError(400, "\u6807\u9898\u548C\u6B63\u6587\u4E0D\u80FD\u4E3A\u7A7A");
    if (title.length > 100) throw new HttpError(400, "\u6807\u9898\u4E0D\u80FD\u8D85\u8FC7 100 \u4E2A\u5B57\u7B26");
    if (content.length > 2e4) throw new HttpError(400, "\u6B63\u6587\u4E0D\u80FD\u8D85\u8FC7 20000 \u4E2A\u5B57\u7B26");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await requireDb(env).prepare(`
      UPDATE posts
      SET title = ?, content = ?, edited_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(title, content, now, now, post.id).run();
    return json(toPostDocument(await getPostRow(env, post.id)));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/data", method: "PATCH", message: error.message, status: error.status }));
    return errorResponse(error, "\u7F16\u8F91\u5E16\u5B50\u5931\u8D25");
  }
}
__name(onRequestPatch, "onRequestPatch");
async function onRequestDelete({ request, env }) {
  try {
    const body = await readJsonBody(request);
    if (body.collection !== "posts") throw new HttpError(400, "\u8BE5\u96C6\u5408\u4E0D\u652F\u6301\u5220\u9664");
    const { profile } = await requireAuth(request, env, body);
    const post = await getPostRow(env, body.documentId);
    if (!post) throw new HttpError(404, "\u5E16\u5B50\u4E0D\u5B58\u5728");
    if (!isAdmin(profile) && normalizeUserId(post.author_id) !== normalizeUserId(profile.id)) {
      throw new HttpError(403, "\u53EA\u80FD\u5220\u9664\u81EA\u5DF1\u7684\u5E16\u5B50");
    }
    await requireDb(env).prepare("DELETE FROM posts WHERE id = ?").bind(post.id).run();
    return json({ success: true });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/data", method: "DELETE", message: error.message, status: error.status }));
    return errorResponse(error, "\u5220\u9664\u5E16\u5B50\u5931\u8D25");
  }
}
__name(onRequestDelete, "onRequestDelete");
function onRequestPost8() {
  return methodNotAllowed(["GET", "PATCH", "DELETE"]);
}
__name(onRequestPost8, "onRequestPost");

// api/delete-comment.js
async function onRequestPost9({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const commentId = String(body.commentId || "").trim();
    if (!commentId) throw new HttpError(400, "\u7F3A\u5C11\u8BC4\u8BBA ID");
    const db = requireDb(env);
    const comment = await db.prepare("SELECT * FROM comments WHERE id = ? LIMIT 1").bind(commentId).first();
    if (!comment) throw new HttpError(404, "\u8BC4\u8BBA\u4E0D\u5B58\u5728");
    if (!isAdmin(profile) && normalizeUserId(comment.author_id) !== normalizeUserId(profile.id)) {
      throw new HttpError(403, "\u53EA\u80FD\u5220\u9664\u81EA\u5DF1\u7684\u8BC4\u8BBA");
    }
    await db.batch([
      db.prepare("DELETE FROM comments WHERE id = ?").bind(commentId),
      db.prepare(`
        UPDATE posts
        SET comment_count = CASE WHEN comment_count > 0 THEN comment_count - 1 ELSE 0 END
        WHERE id = ?
      `).bind(comment.post_id)
    ]);
    return json({ success: true });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/delete-comment", message: error.message, status: error.status }));
    return errorResponse(error, "\u5220\u9664\u8BC4\u8BBA\u5931\u8D25");
  }
}
__name(onRequestPost9, "onRequestPost");
function onRequestGet9() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet9, "onRequestGet");

// api/like.js
async function onRequestPost10({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const postId = String(body.postId || "").trim();
    if (!postId) throw new HttpError(400, "\u7F3A\u5C11\u5E16\u5B50 ID");
    const post = await getPostRow(env, postId);
    if (!post) throw new HttpError(404, "\u5E16\u5B50\u4E0D\u5B58\u5728");
    const db = requireDb(env);
    const userId = normalizeUserId(profile.id);
    const existing = await db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ? LIMIT 1").bind(postId, userId).first();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let liked = false;
    if (existing) {
      await db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?").bind(postId, userId).run();
    } else {
      const likeId = crypto.randomUUID();
      await db.prepare("INSERT INTO likes (id, post_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(likeId, postId, userId, now, now).run();
      liked = true;
    }
    const countRow = await db.prepare("SELECT COUNT(*) AS total FROM likes WHERE post_id = ?").bind(postId).first();
    const likesCount = Number(countRow?.total || 0);
    return json({ success: true, liked, likes: likesCount }, 200);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/like", message: error.message, status: error.status }));
    return errorResponse(error, "\u70B9\u8D5E\u64CD\u4F5C\u5931\u8D25");
  }
}
__name(onRequestPost10, "onRequestPost");
function onRequestGet10() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet10, "onRequestGet");

// api/list-comments.js
async function onRequestGet11({ request, env }) {
  try {
    const url = new URL(request.url);
    const postId = String(url.searchParams.get("postId") || "").trim();
    if (!postId) throw new HttpError(400, "\u7F3A\u5C11\u5E16\u5B50 ID");
    const auth = await optionalAuth(request, env);
    const post = await getPostRow(env, postId);
    if (!post) throw new HttpError(404, "\u5E16\u5B50\u4E0D\u5B58\u5728");
    if (!canViewPost(post, auth?.profile || null)) throw new HttpError(403, "\u65E0\u6743\u67E5\u770B\u8BE5\u5E16\u8BC4\u8BBA");
    const result = await requireDb(env).prepare(`
      SELECT * FROM comments
      WHERE post_id = ?
      ORDER BY created_at ASC
      LIMIT 500
    `).bind(postId).all();
    return json({
      total: Number(result.results?.length || 0),
      documents: (result.results || []).map(toCommentDocument)
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/list-comments", message: error.message, status: error.status }));
    return errorResponse(error, "\u8BC4\u8BBA\u5217\u8868\u52A0\u8F7D\u5931\u8D25");
  }
}
__name(onRequestGet11, "onRequestGet");
function onRequestPost11() {
  return methodNotAllowed(["GET"]);
}
__name(onRequestPost11, "onRequestPost");

// api/runtime-config.js
function parseMap(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
__name(parseMap, "parseMap");
async function onRequestGet12(context) {
  const config = {
    appwriteEndpoint: String(context.env.APPWRITE_ENDPOINT || ""),
    appwriteProjectId: String(context.env.APPWRITE_PROJECT_ID || ""),
    databaseIds: parseMap(context.env.APPWRITE_DATABASE_IDS_JSON),
    collectionIds: parseMap(context.env.APPWRITE_COLLECTION_IDS_JSON),
    d1ApiBase: String(context.env.D1_API_BASE || "/api/d1")
  };
  const body = `window.__LG_CONFIG__ = Object.freeze(${JSON.stringify(config)});`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
__name(onRequestGet12, "onRequestGet");

// api/update-password.js
async function onRequestPost12({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const credentials = readCredentials(request, body);
    const oldPassword = String(body.oldPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!credentials.sessionSecret) throw new HttpError(401, "\u4FEE\u6539\u5BC6\u7801\u524D\u8BF7\u91CD\u65B0\u767B\u5F55\uFF0C\u4EE5\u83B7\u53D6\u6709\u6548\u4F1A\u8BDD");
    if (!oldPassword || !newPassword) throw new HttpError(400, "\u8BF7\u5B8C\u6574\u586B\u5199\u5F53\u524D\u5BC6\u7801\u548C\u65B0\u5BC6\u7801");
    if (newPassword.length < 8 || newPassword.length > 256) {
      throw new HttpError(400, "\u65B0\u5BC6\u7801\u957F\u5EA6\u9700\u8981\u5728 8 \u5230 256 \u4F4D\u4E4B\u95F4");
    }
    await updatePasswordWithSession(
      getAppwriteConfig(env),
      credentials.sessionSecret,
      newPassword,
      oldPassword
    );
    await requireDb(env).prepare("UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?").bind((/* @__PURE__ */ new Date()).toISOString(), profile.id).run();
    try {
      await deleteCurrentSession(getAppwriteConfig(env), credentials.sessionSecret);
    } catch (error) {
      console.warn(JSON.stringify({ level: "warn", route: "/api/update-password", event: "session_delete_failed", status: error.status }));
    }
    return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/update-password", message: error.message, status: error.status }));
    if (error.status === 401) error.message = "\u5F53\u524D\u5BC6\u7801\u4E0D\u6B63\u786E\uFF0C\u6216\u767B\u5F55\u4F1A\u8BDD\u5DF2\u8FC7\u671F";
    return errorResponse(error, "\u4FEE\u6539\u5BC6\u7801\u5931\u8D25");
  }
}
__name(onRequestPost12, "onRequestPost");
function onRequestGet13() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet13, "onRequestGet");

// api/update-profile.js
function allowedAvatar(value) {
  if (!value) return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
__name(allowedAvatar, "allowedAvatar");
async function onRequestPost13({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const name = String(body.name || "").trim();
    const avatar = String(body.avatar || "").trim();
    if (!name) throw new HttpError(400, "\u540D\u5B57\u6216\u6635\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
    if (name.length > 12) throw new HttpError(400, "\u540D\u5B57\u6216\u6635\u79F0\u4E0D\u80FD\u8D85\u8FC7 12 \u4E2A\u5B57\u7B26");
    if (avatar.length > 2048 || !allowedAvatar(avatar)) {
      throw new HttpError(400, "\u5934\u50CF\u94FE\u63A5\u5FC5\u987B\u662F http(s) \u5730\u5740\u6216\u7AD9\u5185\u76F8\u5BF9\u8DEF\u5F84");
    }
    const id = normalizeUserId(profile.id);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const db = requireDb(env);
    await db.batch([
      db.prepare("UPDATE users SET name = ?, avatar = ?, updated_at = ? WHERE id = ?").bind(name, avatar || null, now, id),
      db.prepare("UPDATE posts SET author_name = ? WHERE author_id = ?").bind(name, id),
      db.prepare("UPDATE comments SET author_name = ? WHERE author_id = ?").bind(name, id),
      db.prepare("UPDATE confessions SET author_name = ? WHERE author_id = ?").bind(name, id)
    ]);
    return json({ success: true, name, avatar });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/update-profile", message: error.message, status: error.status }));
    return errorResponse(error, "\u4FDD\u5B58\u4E2A\u4EBA\u8D44\u6599\u5931\u8D25");
  }
}
__name(onRequestPost13, "onRequestPost");
function onRequestGet14() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet14, "onRequestGet");

// api/verify-question.js
function normalizeAnswer(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}
__name(normalizeAnswer, "normalizeAnswer");
async function onRequestPost14({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const questions = getRegistrationQuestions(env);
    if (body.action === "getQuestions") {
      return json({
        questions: secureShuffle(questions).slice(0, 2).map((question) => ({
          id: question.id,
          question: question.question,
          hint: question.hint || ""
        }))
      });
    }
    if (body.action !== "verify") throw new HttpError(400, "\u65E0\u6548\u64CD\u4F5C");
    const studentId = String(body.studentId || "").trim();
    if (!/^\d{6,8}$/.test(studentId)) throw new HttpError(400, "\u5B66\u53F7\u683C\u5F0F\u4E0D\u6B63\u786E");
    if (!Array.isArray(body.answers) || body.answers.length !== 2) {
      throw new HttpError(400, "\u8BF7\u5B8C\u6574\u56DE\u7B54\u4E24\u9053\u9898");
    }
    if (new Set(body.answers.map((answer) => String(answer.id))).size !== 2) {
      throw new HttpError(400, "\u8BF7\u9009\u62E9\u4E24\u9053\u4E0D\u540C\u7684\u9898\u76EE");
    }
    const results = body.answers.map((answer) => {
      const question = questions.find((item) => String(item.id) === String(answer.id));
      if (!question) throw new HttpError(400, "\u9898\u76EE\u4E0D\u5B58\u5728\u6216\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u83B7\u53D6");
      const submitted = normalizeAnswer(answer.answer);
      const correct = question.answers.some((candidate) => normalizeAnswer(candidate) === submitted);
      return { id: answer.id, correct };
    });
    const correctCount = results.filter((result) => result.correct).length;
    const passed = correctCount === results.length;
    const verificationToken = passed ? await signToken(
      getAuthTokenSecret(env),
      { purpose: "campus-registration", sub: studentId },
      10 * 60
    ) : "";
    return json({
      passed,
      correctCount,
      totalCount: results.length,
      results,
      verificationToken,
      message: passed ? "\u9A8C\u8BC1\u901A\u8FC7" : `\u7B54\u5BF9\u4E86 ${correctCount}/${results.length} \u9898\uFF0C\u8BF7\u91CD\u8BD5`
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", route: "/api/verify-question", message: error.message, status: error.status }));
    return errorResponse(error, "\u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  }
}
__name(onRequestPost14, "onRequestPost");
function onRequestGet15() {
  return methodNotAllowed(["POST"]);
}
__name(onRequestGet15, "onRequestGet");
function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
}
__name(onRequestOptions, "onRequestOptions");

// ../.wrangler/tmp/pages-q8qT0N/functionsRoutes-0.14082208424588671.mjs
var routes = [
  {
    routePath: "/api/auth-jwt",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/auth-jwt",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/auth-logout",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/auth-logout",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/auth-me",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/auth-me",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/auth-register",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/api/auth-register",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/create-comment",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/api/create-comment",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/create-confession",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/api/create-confession",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api/create-post",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet7]
  },
  {
    routePath: "/api/create-post",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost7]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet8]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost8]
  },
  {
    routePath: "/api/delete-comment",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet9]
  },
  {
    routePath: "/api/delete-comment",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost9]
  },
  {
    routePath: "/api/like",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet10]
  },
  {
    routePath: "/api/like",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost10]
  },
  {
    routePath: "/api/list-comments",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet11]
  },
  {
    routePath: "/api/list-comments",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost11]
  },
  {
    routePath: "/api/runtime-config",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet12]
  },
  {
    routePath: "/api/update-password",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet13]
  },
  {
    routePath: "/api/update-password",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost12]
  },
  {
    routePath: "/api/update-profile",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet14]
  },
  {
    routePath: "/api/update-profile",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost13]
  },
  {
    routePath: "/api/verify-question",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet15]
  },
  {
    routePath: "/api/verify-question",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/api/verify-question",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost14]
  }
];

// ../node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
