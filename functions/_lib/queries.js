const META = {
  "$id": "id",
  "$createdAt": "created_at",
  "$updatedAt": "updated_at",
  "$databaseId": "database_id",
  "$collectionId": "collection_id",
};

function jsonPath(attribute) {
  if (typeof attribute !== "string" || !attribute || attribute.length > 160) throw new Error("查询字段无效");
  const parts = attribute.split(".");
  if (!parts.every((part) => /^[A-Za-z0-9_$-]+$/.test(part))) throw new Error("查询字段无效");
  return `$.${parts.map((part) => `\"${part.replaceAll('"', '\\"')}\"`).join(".")}`;
}

function expression(attribute) {
  return META[attribute] || `json_extract(data_json, '${jsonPath(attribute)}')`;
}

function normalizeQuery(query) {
  if (typeof query === "string") {
    try { return JSON.parse(query); } catch { throw new Error("无法解析 Appwrite Query"); }
  }
  if (query && typeof query === "object") return query;
  throw new Error("Query 必须是字符串或对象");
}

function valuesOf(query) {
  if (Array.isArray(query.values)) return query.values;
  if (query.value !== undefined) return [query.value];
  return [];
}

export function buildListQuery(rawQueries = []) {
  const where = [];
  const params = [];
  const order = [];
  let limit = 25;
  let offset = 0;

  for (const raw of Array.isArray(rawQueries) ? rawQueries : []) {
    const query = normalizeQuery(raw);
    const method = query.method;
    const attribute = query.attribute;
    const values = valuesOf(query);

    if (method === "limit") { limit = Number(values[0] ?? query.limit ?? 25); continue; }
    if (method === "offset") { offset = Number(values[0] ?? query.offset ?? 0); continue; }
    if (method === "orderAsc" || method === "orderDesc") {
      order.push(`${expression(attribute)} ${method === "orderAsc" ? "ASC" : "DESC"}`); continue;
    }
    if (method === "select" || method === "cursorAfter" || method === "cursorBefore") continue;
    if (!attribute) continue;
    const expr = expression(attribute);

    if (method === "equal" || method === "notEqual") {
      const clean = values.flat();
      if (!clean.length) { where.push(method === "equal" ? "0" : "1"); continue; }
      where.push(`${expr} ${method === "equal" ? "IN" : "NOT IN"} (${clean.map(() => "?").join(",")})`);
      params.push(...clean); continue;
    }
    if (["lessThan","lessThanEqual","greaterThan","greaterThanEqual"].includes(method)) {
      const op = { lessThan: "<", lessThanEqual: "<=", greaterThan: ">", greaterThanEqual: ">=" }[method];
      where.push(`${expr} ${op} ?`); params.push(values[0]); continue;
    }
    if (method === "between") {
      where.push(`${expr} BETWEEN ? AND ?`); params.push(values[0], values[1]); continue;
    }
    if (method === "isNull" || method === "isNotNull") {
      where.push(`${expr} IS ${method === "isNull" ? "" : "NOT "}NULL`); continue;
    }
    if (["startsWith","endsWith","search"].includes(method)) {
      const value = String(values[0] ?? "").replaceAll("%", "\\%").replaceAll("_", "\\_");
      const pattern = method === "startsWith" ? `${value}%` : method === "endsWith" ? `%${value}` : `%${value}%`;
      where.push(`CAST(${expr} AS TEXT) LIKE ? ESCAPE '\\'`); params.push(pattern); continue;
    }
    if (method === "contains") {
      const value = values[0];
      where.push(`(CAST(${expr} AS TEXT) = CAST(? AS TEXT) OR EXISTS (SELECT 1 FROM json_each(${expr}) WHERE value = ?))`);
      params.push(value, value); continue;
    }
  }

  limit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 25;
  offset = Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0;
  if (!order.length) order.push("created_at DESC", "id DESC");
  return { where, params, order, limit, offset };
}
