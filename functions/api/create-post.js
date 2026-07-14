function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig(env) {
    return {
        endpoint: clean(env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(env.APPWRITE_API_KEY),
        databaseId: clean(env.APPWRITE_DATABASE_ID || env.DATABASE_ID || 'lg'),
        collectionPosts: clean(env.APPWRITE_COLLECTION_POSTS || 'posts'),
        collectionUsers: clean(env.APPWRITE_COLLECTION_USERS || 'users'),
        tokenSecret: clean(env.AUTH_TOKEN_SECRET || env.APP_AUTH_SECRET || env.APPWRITE_API_KEY)
    };
}

function normalizeUserId(userId) {
    return String(userId || '').trim().replace(/^student_/, '');
}

function base64UrlDecode(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function verifySession(config, userId, sessionSecret) {
    if (!sessionSecret) {
        const error = new Error('登录会话已过期，请重新登录');
        error.status = 401;
        throw error;
    }
    const response = await fetch(`${config.endpoint}/account`, {
        headers: {
            'X-Appwrite-Project': config.projectId,
            'X-Appwrite-Session': sessionSecret
        }
    });
    const account = await response.json().catch(() => ({}));
    if (!response.ok || normalizeUserId(account.$id) !== userId) {
        const error = new Error(response.ok ? '登录身份不匹配' : '登录会话已过期，请重新登录');
        error.status = response.ok ? 403 : 401;
        throw error;
    }
}

async function verifyAppToken(config, userId, appToken) {
    if (!appToken || !config.tokenSecret) return false;
    try {
        const [payloadPart, signaturePart] = String(appToken).split('.');
        if (!payloadPart || !signaturePart) throw new Error();
        const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
        if (normalizeUserId(payload.sub) !== userId || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) {
            throw new Error();
        }
        const key = await crypto.subtle.importKey(
            'raw', new TextEncoder().encode(config.tokenSecret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
        );
        if (!await crypto.subtle.verify('HMAC', key, base64UrlDecode(signaturePart), new TextEncoder().encode(payloadPart))) {
            throw new Error();
        }
        return true;
    } catch {
        const error = new Error('登录凭证无效或已过期，请重新登录');
        error.status = 401;
        throw error;
    }
}

async function verifyIdentity(config, userId, credentials) {
    if (await verifyAppToken(config, userId, credentials.appToken)) return;
    await verifySession(config, userId, credentials.sessionSecret);
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
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { raw: text };
        }
    }

    if (!response.ok) {
        const error = new Error(data.message || data.error || `Appwrite 请求失败：${response.status}`);
        error.status = response.status;
        error.code = data.code || response.status;
        error.data = data;
        throw error;
    }

    return data;
}

function buildQueryParams(queries) {
    const params = new URLSearchParams();

    for (const query of queries) {
        params.append('queries[]', query);
    }

    return params.toString();
}

async function listDocuments(config, collectionId, queries = []) {
    const queryString = buildQueryParams(queries);
    const path = `/databases/${config.databaseId}/collections/${collectionId}/documents${queryString ? `?${queryString}` : ''}`;

    return appwriteFetch(config, path, {
        method: 'GET'
    });
}

async function createDocument(config, collectionId, documentId, data) {
    return appwriteFetch(
        config,
        `/databases/${config.databaseId}/collections/${collectionId}/documents`,
        {
            method: 'POST',
            body: JSON.stringify({
                documentId,
                data
            })
        }
    );
}

export async function onRequestPost({ request, env }) {
    let body;

    try {
        body = await request.json();
    } catch {
        return Response.json({ error: '无效的请求体' }, { status: 400 });
    }

    const { userId, boardId, title, content, viewPermission, targetUsers, sessionSecret, appToken } = body;
    const cleanUserId = normalizeUserId(userId);

    if (!cleanUserId || !boardId || !title || !content) {
        return Response.json({ error: '缺少必要字段' }, { status: 400 });
    }

    try {
        const config = getConfig(env);

        if (!config.apiKey) {
            return Response.json({ error: 'APPWRITE_API_KEY 未配置' }, { status: 500 });
        }

        await verifyIdentity(config, cleanUserId, { sessionSecret, appToken });
        await appwriteFetch(
            config,
            `/databases/${config.databaseId}/collections/${config.collectionUsers}/documents/${cleanUserId}`,
            { method: 'GET' }
        );
        const authorId = `student_${cleanUserId}`;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existing = await listDocuments(config, config.collectionPosts, [
            JSON.stringify({
                method: 'equal',
                attribute: 'authorId',
                values: [authorId]
            }),
            JSON.stringify({
                method: 'greaterThan',
                attribute: '$createdAt',
                values: [today.toISOString()]
            })
        ]);

        const dailyLimit = 5;

        if ((existing.total || 0) >= dailyLimit) {
            return Response.json(
                { error: `今日发帖已达上限（${dailyLimit}条），请明天再来` },
                { status: 429 }
            );
        }

        const post = await createDocument(
            config,
            config.collectionPosts,
            'unique()',
            {
                boardId,
                title,
                content,
                authorId,
                authorName: cleanUserId,
                viewPermission: viewPermission || 1,
                status: 0,
                targetGroups: targetUsers || []
            }
        );

        return Response.json({
            success: true,
            postId: post.$id
        });
    } catch (error) {
        console.error('发帖失败:', error);

        return Response.json(
            { error: error.message || '发帖失败' },
            { status: error.status || 500 }
        );
    }
}

export async function onRequestGet() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
