function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig(env) {
    return {
        endpoint: clean(env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(env.APPWRITE_API_KEY),
        databaseId: clean(env.APPWRITE_DATABASE_ID || env.DATABASE_ID || 'lg'),
        collectionConfessions: clean(env.APPWRITE_COLLECTION_CONFESSIONS || 'confessions'),
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

async function verifyIdentity(config, userId, { sessionSecret, appToken }) {
    if (appToken && config.tokenSecret) {
        try {
            const [payloadPart, signaturePart] = String(appToken).split('.');
            const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
            const key = await crypto.subtle.importKey(
                'raw', new TextEncoder().encode(config.tokenSecret),
                { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
            );
            const valid = await crypto.subtle.verify(
                'HMAC', key, base64UrlDecode(signaturePart), new TextEncoder().encode(payloadPart)
            );
            if (valid && normalizeUserId(payload.sub) === userId && Number(payload.exp || 0) >= Math.floor(Date.now() / 1000)) return;
        } catch {}
        const error = new Error('登录凭证无效或已过期，请重新登录');
        error.status = 401;
        throw error;
    }

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
    try {
        const config = getConfig(env);
        const { content, userId, sessionSecret, appToken } = await request.json();
        const cleanUserId = normalizeUserId(userId);

        if (!content || !String(content).trim()) {
            return Response.json({ error: '内容不能为空' }, { status: 400 });
        }

        if (String(content).trim().length < 5) {
            return Response.json({ error: '内容至少5个字' }, { status: 400 });
        }

        if (!cleanUserId) {
            return Response.json({ error: '请先登录' }, { status: 401 });
        }

        if (!config.apiKey) {
            return Response.json({ error: 'APPWRITE_API_KEY 未配置' }, { status: 500 });
        }

        await verifyIdentity(config, cleanUserId, { sessionSecret, appToken });
        await appwriteFetch(
            config,
            `/databases/${config.databaseId}/collections/${config.collectionUsers}/documents/${cleanUserId}`,
            { method: 'GET' }
        );

        const confession = await createDocument(
            config,
            config.collectionConfessions,
            'unique()',
            {
                content: String(content).trim(),
                authorId: cleanUserId,
                authorName: '匿名',
                toName: null,
                status: 0,
                likes: 0
            }
        );

        return Response.json({
            success: true,
            confessionId: confession.$id
        });
    } catch (error) {
        console.error('发表表白失败:', error);

        return Response.json(
            { error: error.message || '发表失败' },
            { status: error.status || 500 }
        );
    }
}

export async function onRequestGet() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
