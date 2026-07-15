import { apiError, json, readJson } from "../_lib/http.js";
import { getCurrentUser } from "../_lib/auth.js";
import { listDocuments, getDocument, createDocument, updateDocument, deleteDocument, changeNumber } from "../_lib/documents.js";

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(`缺少 ${name}`), { status: 400, type: "general_argument_invalid" });
  return text;
}

function normalizeArgs(value = {}) {
  return {
    ...value,
    databaseId: required(value.databaseId, "databaseId"),
    collectionId: required(value.collectionId, "collectionId"),
  };
}

async function handle(context) {
  try {
    const method = context.request.method;
    let action;
    let args;
    if (method === "GET") {
      const url = new URL(context.request.url);
      action = url.searchParams.get("action") || "listDocuments";
      args = Object.fromEntries(url.searchParams);
      if (args.queries) {
        try { args.queries = JSON.parse(args.queries); } catch { args.queries = []; }
      }
    } else {
      const body = await readJson(context.request);
      action = body.action;
      args = body.args || body;
    }
    args = normalizeArgs(args);
    const writeAction = ["createDocument","updateDocument","deleteDocument","incrementDocumentAttribute","decrementDocumentAttribute"].includes(action);
    const user = await getCurrentUser(context.request, context.env, { required: writeAction });

    if (action === "listDocuments") return json(await listDocuments(context.env, args, user));
    if (action === "getDocument") return json(await getDocument(context.env, { ...args, documentId: required(args.documentId, "documentId") }, user));
    if (action === "createDocument") return json(await createDocument(context.env, args, user), 201);
    if (action === "updateDocument") return json(await updateDocument(context.env, { ...args, documentId: required(args.documentId, "documentId") }, user));
    if (action === "deleteDocument") return json(await deleteDocument(context.env, { ...args, documentId: required(args.documentId, "documentId") }, user));
    if (action === "incrementDocumentAttribute") return json(await changeNumber(context.env, args, user, 1));
    if (action === "decrementDocumentAttribute") return json(await changeNumber(context.env, args, user, -1));
    return apiError(400, `不支持的操作：${action}`, "general_argument_invalid");
  } catch (error) {
    console.error(JSON.stringify({ event: "d1_api_error", message: String(error?.message || error), type: error?.type || "unknown" }));
    return apiError(Number(error?.status || 500), error?.message || "服务器内部错误", error?.type || "general_server_error");
  }
}

export const onRequestGet = handle;
export const onRequestPost = handle;
export const onRequestPatch = handle;
export const onRequestDelete = handle;
