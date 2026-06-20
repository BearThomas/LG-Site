function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig(env) {
    return {
        endpoint: clean(env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(env.APPWRITE_API_KEY),
        tokenSecret: clean(env.AUTH_TOKEN_SECRET || env.APP_AUTH_SECRET || env.APPWRITE_API_KEY)
    };
}

function normalizeUserId(userId) {
    return String(userId || '').trim().replace(/^student_/, '');
}

async function readJson(response) {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

async function verifySession(config, userId, sessionSecret) {
    if (!sessionSecret) {
        const error = new Error('登录会话已过期，请重新登录');
        error.status = 401;
        throw error;
    }

    const response = await fetch(`${config.endpoint}/account`, {
        method: 'GET',
        headers: {
            'X-Appwrite-Project': config.projectId,
            'X-Appwrite-Session': sessionSecret
        }
    });

    const account = await readJson(response).catch(() => ({}));

    if (!response.ok) {
        const error = new Error(account.message || '登录会话已过期，请重新登录');
        error.status = 401;
        throw error;
    }

    if (normalizeUserId(account.$id) !== userId) {
        const error = new Error('登录身份不匹配');
        error.status = 403;
        throw error;
    }
}

function base64UrlDecode(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function verifyAppToken(config, userId, appToken) {
    if (!appToken || !config.tokenSecret) return false;

    const [payloadPart, signaturePart] = String(appToken).split('.');
    if (!payloadPart || !signaturePart) {
        const error = new Error('登录凭证无效，请重新登录');
        error.status = 401;
        throw error;
    }

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (normalizeUserId(payload.sub) !== userId || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) {
        const error = new Error('登录凭证已过期，请重新登录');
        error.status = 401;
        throw error;
    }

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(config.tokenSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );
    const ok = await crypto.subtle.verify(
        'HMAC',
        key,
        base64UrlDecode(signaturePart),
        new TextEncoder().encode(payloadPart)
    );

    if (!ok) {
        const error = new Error('登录凭证无效，请重新登录');
        error.status = 401;
        throw error;
    }

    return true;
}

async function verifyIdentity(config, userId, credentials = {}) {
    if (await verifyAppToken(config, userId, credentials.appToken)) return;
    await verifySession(config, userId, credentials.sessionSecret);
}

async function verifyOldPassword(config, studentId, oldPassword) {
    const response = await fetch(`${config.endpoint}/account/sessions/email`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Appwrite-Project': config.projectId
        },
        body: JSON.stringify({
            email: `${studentId}@campus.local`,
            password: oldPassword
        })
    });

    if (!response.ok) {
        const data = await readJson(response).catch(() => ({}));
        throw new Error(data.message || '当前旧密码不正确');
    }
}

async function updateUserPassword(config, studentId, newPassword) {
    const response = await fetch(`${config.endpoint}/users/${studentId}/password`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-Appwrite-Project': config.projectId,
            'X-Appwrite-Key': config.apiKey
        },
        body: JSON.stringify({
            password: newPassword
        })
    });

    if (!response.ok) {
        const data = await readJson(response).catch(() => ({}));
        throw new Error(data.message || '密码修改失败');
    }
}

export async function onRequestPost({ request, env }) {
    try {
        const config = getConfig(env);
        const { studentId, oldPassword, newPassword, sessionSecret, appToken } = await request.json();
        const cleanStudentId = normalizeUserId(studentId);

        if (!config.apiKey) {
            return Response.json({ error: 'APPWRITE_API_KEY 未配置' }, { status: 500 });
        }

        if (!cleanStudentId || !oldPassword || !newPassword) {
            return Response.json({ error: '请完整填写原当前密码与安全新密码' }, { status: 400 });
        }

        if (String(newPassword).length < 8) {
            return Response.json({ error: '新密码长度至少为 8 位' }, { status: 400 });
        }

        await verifyIdentity(config, cleanStudentId, { sessionSecret, appToken });
        await verifyOldPassword(config, cleanStudentId, oldPassword);
        await updateUserPassword(config, cleanStudentId, newPassword);

        return Response.json({ success: true });
    } catch (error) {
        console.error('修改密码失败:', error);
        return Response.json({ error: error.message || '修改密码失败' }, { status: error.status || 500 });
    }
}

export async function onRequestGet() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
