function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig(env) {
    return {
        endpoint: clean(env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(env.APPWRITE_API_KEY),
        tokenSecret: clean(env.AUTH_TOKEN_SECRET || env.APP_AUTH_SECRET || env.APPWRITE_API_KEY),
        databaseId: clean(env.APPWRITE_DATABASE_ID || env.DATABASE_ID || 'lg'),
        collectionUsers: clean(env.APPWRITE_COLLECTION_USERS || 'users')
    };
}

function normalizeUserId(userId) {
    return String(userId || '').trim().replace(/^student_/, '');
}

function appwriteHeaders(config) {
    return {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': config.projectId,
        'X-Appwrite-Key': config.apiKey
    };
}

async function appwriteFetch(config, path, options = {}) {
    const response = await fetch(`${config.endpoint}${path}`, {
        ...options,
        headers: {
            ...appwriteHeaders(config),
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
        const error = new Error(data.message || data.error || `Appwrite 请求失败：${response.status}`);
        error.status = response.status;
        throw error;
    }

    return data;
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

    const text = await response.text();
    const account = text ? JSON.parse(text) : {};

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

function isAllowedAvatarUrl(avatar) {
    return !avatar || avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/');
}

export async function onRequestPost({ request, env }) {
    try {
        const config = getConfig(env);
        const { userId, name, avatar, sessionSecret, appToken } = await request.json();
        const cleanUserId = normalizeUserId(userId);
        const cleanName = String(name || '').trim();
        const cleanAvatar = String(avatar || '').trim();

        if (!config.apiKey) {
            return Response.json({ error: 'APPWRITE_API_KEY 未配置' }, { status: 500 });
        }

        if (!cleanUserId) {
            return Response.json({ error: '请先登录' }, { status: 401 });
        }

        if (!cleanName) {
            return Response.json({ error: '名字或昵称不能为空' }, { status: 400 });
        }

        if (cleanName.length > 12) {
            return Response.json({ error: '名字或昵称不能超过 12 个字' }, { status: 400 });
        }

        if (!isAllowedAvatarUrl(cleanAvatar)) {
            return Response.json({ error: '头像链接需要以 http://、https:// 或 / 开头' }, { status: 400 });
        }

        await verifyIdentity(config, cleanUserId, { sessionSecret, appToken });

        const userDoc = await appwriteFetch(
            config,
            `/databases/${config.databaseId}/collections/${config.collectionUsers}/documents/${cleanUserId}`,
            {
                method: 'PATCH',
                body: JSON.stringify({
                    data: {
                        name: cleanName,
                        avatar: cleanAvatar || null
                    }
                })
            }
        );

        return Response.json({
            success: true,
            name: userDoc.name || cleanName,
            avatar: userDoc.avatar || ''
        });
    } catch (error) {
        console.error('保存个人资料失败:', error);
        return Response.json({ error: error.message || '保存个人资料失败' }, { status: error.status || 500 });
    }
}

export async function onRequestGet() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
