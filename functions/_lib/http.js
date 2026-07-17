export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...headers }
  });
}

export async function readJsonBody(request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new HttpError(413, '请求内容过大');
  }

  if (!request.body) throw new HttpError(400, '请求 JSON 格式不正确');
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, '请求内容过大');
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('body must be an object');
    }
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, '请求 JSON 格式不正确');
  } finally {
    reader.releaseLock();
  }
}

export function methodNotAllowed(allowed = ['POST']) {
  return json(
    { error: 'Method not allowed' },
    405,
    { Allow: allowed.join(', ') }
  );
}

export function errorResponse(error, fallback = '服务器暂时不可用') {
  const status = Number(error?.status || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const message = error?.message || fallback;

  return json(
    {
      error: message,
      ...(error?.details ? { details: error.details } : {})
    },
    safeStatus
  );
}
