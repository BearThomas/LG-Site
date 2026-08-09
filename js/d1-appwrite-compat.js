function currentCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem('campus_user') || 'null');
    return {
      appToken: saved?.appToken || '',
      sessionSecret: saved?.token || ''
    };
  } catch {
    return { appToken: '', sessionSecret: '' };
  }
}

async function requestJson(url, options = {}) {
  const credentials = currentCredentials();
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (credentials.appToken) headers.set('X-LG-Token', credentials.appToken);
  if (credentials.sessionSecret) headers.set('X-Appwrite-Session', credentials.sessionSecret);

  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `请求失败（${response.status}）`);
    error.code = response.status;
    error.type = payload.type || '';
    throw error;
  }
  return payload;
}

export class Client {
  setEndpoint() { return this; }
  setProject() { return this; }
  setSession() { return this; }
  setJWT() { return this; }
}

export class Databases {
  constructor() {}

  listDocuments(_databaseId, collectionId, queries = []) {
    const params = new URLSearchParams({
      collection: String(collectionId),
      queries: JSON.stringify(queries || [])
    });
    return requestJson(`/api/data?${params.toString()}`);
  }

  getDocument(_databaseId, collectionId, documentId, options = {}) {
    const params = new URLSearchParams({
      collection: String(collectionId),
      documentId: String(documentId)
    });
    if (Array.isArray(options.fields) && options.fields.length) {
      params.set('fields', options.fields.join(','));
    }
    return requestJson(`/api/data?${params.toString()}`);
  }

  updateDocument(_databaseId, collectionId, documentId, data) {
    return requestJson('/api/data', {
      method: 'PATCH',
      body: JSON.stringify({ collection: collectionId, documentId, data })
    });
  }

  deleteDocument(_databaseId, collectionId, documentId) {
    return requestJson('/api/data', {
      method: 'DELETE',
      body: JSON.stringify({ collection: collectionId, documentId })
    });
  }
}

function values(value) {
  return Array.isArray(value) ? value : [value];
}

export const Query = Object.freeze({
  equal(attribute, value) {
    return { method: 'equal', attribute: String(attribute), values: values(value) };
  },
  search(attribute, value) {
    return { method: 'search', attribute: String(attribute), values: values(value) };
  },
  greaterThan(attribute, value) {
    return { method: 'greaterThan', attribute: String(attribute), values: values(value) };
  },
  orderDesc(attribute) {
    return { method: 'orderDesc', attribute: String(attribute) };
  },
  orderAsc(attribute) {
    return { method: 'orderAsc', attribute: String(attribute) };
  },
  limit(value) {
    return { method: 'limit', values: [Number(value)] };
  },
  offset(value) {
    return { method: 'offset', values: [Number(value)] };
  }
});
