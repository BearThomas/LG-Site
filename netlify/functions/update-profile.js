const crypto = require('crypto');

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig() {
    return {
        endpoint: clean(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(process.env.APPWRITE_API_KEY),
        tokenSecret: clean(process.env.AUTH_TOKEN_SECRET || process.env.APP_AUTH_SECRET || process.env.APPWRITE_API_KEY),
        databaseId: clean(process.env.APPWRITE_DATABASE_ID || process.env.DATABASE_ID || 'lg'),
        collectionUsers: clean(process.env.APPWRITE_COLLECTION_USERS || 'users')
    };
}

function normalizeUserId(userId) {
    return String(userId || '').trim().replace(/^student_/, '');
}

function json(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

async function appwriteFetch(config, path, options = {}) {
    const response = await fetch(`${config.endpoint}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Appwrite-Project': config.projectId,
            'X-Appwrite-Key': config.apiKey,
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
        throw new Error(data.message || data.error || `Appwrite 请求失败：${response.status}`);
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

function verifyAppToken(config, userId, appToken) {
    if (!appToken || !config.tokenSecret) return false;

    const [payloadPart, signaturePart] = String(appToken).split('.');
    if (!payloadPart || !signaturePart) {
        const error = new Error('登录凭证无效，请重新登录');
        error.status = 401;
        throw error;
    }

    const expected = crypto.createHmac('sha256', config.tokenSecret).update(payloadPart).digest('base64url');
    if (expected !== signaturePart) {
        const error = new Error('登录凭证无效，请重新登录');
        error.status = 401;
        throw error;
    }

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (normalizeUserId(payload.sub) !== userId || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) {
        const error = new Error('登录凭证已过期，请重新登录');
        error.status = 401;
        throw error;
    }

    return true;
}

async function verifyIdentity(config, userId, credentials = {}) {
    if (verifyAppToken(config, userId, credentials.appToken)) return;
    await verifySession(config, userId, credentials.sessionSecret);
}

function isAllowedAvatarUrl(avatar) {
    return !avatar || avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/');
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' });
    }

    try {
        const config = getConfig();
        const { userId, name, avatar, sessionSecret, appToken } = JSON.parse(event.body || '{}');
        const cleanUserId = normalizeUserId(userId);
        const cleanName = String(name || '').trim();
        const cleanAvatar = String(avatar || '').trim();

        if (!config.apiKey) return json(500, { error: 'APPWRITE_API_KEY 未配置' });
        if (!cleanUserId) return json(401, { error: '请先登录' });
        if (!cleanName) return json(400, { error: '名字或昵称不能为空' });
        if (cleanName.length > 12) return json(400, { error: '名字或昵称不能超过 12 个字' });
        if (!isAllowedAvatarUrl(cleanAvatar)) {
            return json(400, { error: '头像链接需要以 http://、https:// 或 / 开头' });
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

        return json(200, {
            success: true,
            name: userDoc.name || cleanName,
            avatar: userDoc.avatar || ''
        });
    } catch (error) {
        console.error('保存个人资料失败:', error);
        return json(error.status || 500, { error: error.message || '保存个人资料失败' });
    }
};
