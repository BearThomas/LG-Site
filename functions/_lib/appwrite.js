import { HttpError } from './http.js';

async function parseResponse(response) {
  if (response.status === 204) return {};
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { message: `Appwrite 返回 HTTP ${response.status}` };
  }
  try {
    return await response.json();
  } catch {
    return { message: `Appwrite 返回了无效 JSON（HTTP ${response.status}）` };
  }
}

export async function appwriteRequest(config, path, options = {}) {
  const response = await fetch(`${config.endpoint}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': config.projectId,
      ...(config.apiKey ? { 'X-Appwrite-Key': config.apiKey } : {}),
      ...(options.headers || {})
    }
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    const error = new HttpError(
      response.status,
      data.message || data.error || `Appwrite 请求失败（${response.status}）`,
      data.type ? { type: data.type, code: data.code } : undefined
    );
    error.appwrite = data;
    throw error;
  }
  return data;
}

export function createPasswordSession(config, studentId, password) {
  return appwriteRequest(
    { ...config, apiKey: '' },
    '/account/sessions/email',
    {
      method: 'POST',
      body: JSON.stringify({ email: `${studentId}@campus.local`, password })
    }
  );
}

export function getAccountWithSession(config, sessionSecret) {
  return appwriteRequest(
    { ...config, apiKey: '' },
    '/account',
    {
      method: 'GET',
      headers: { 'X-Appwrite-Session': sessionSecret }
    }
  );
}

export async function deleteCurrentSession(config, sessionSecret) {
  if (!sessionSecret) return;
  await appwriteRequest(
    { ...config, apiKey: '' },
    '/account/sessions/current',
    {
      method: 'DELETE',
      headers: { 'X-Appwrite-Session': sessionSecret }
    }
  );
}

export function createAuthUser(config, studentId, password, name) {
  return appwriteRequest(config, '/users', {
    method: 'POST',
    body: JSON.stringify({
      userId: studentId,
      email: `${studentId}@campus.local`,
      password,
      name
    })
  });
}

export function getAuthUser(config, userId) {
  return appwriteRequest(config, `/users/${encodeURIComponent(userId)}`, { method: 'GET' });
}

export async function deleteAuthUser(config, userId) {
  try {
    await appwriteRequest(config, `/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', event: 'appwrite_user_rollback_failed', userId, status: error.status }));
  }
}

export function updatePasswordWithSession(config, sessionSecret, password, oldPassword) {
  return appwriteRequest(
    { ...config, apiKey: '' },
    '/account/password',
    {
      method: 'PATCH',
      headers: { 'X-Appwrite-Session': sessionSecret },
      body: JSON.stringify({ password, oldPassword })
    }
  );
}
