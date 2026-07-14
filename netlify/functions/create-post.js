const { Query } = require('node-appwrite');
const crypto = require('crypto');
const {
    COLLECTION_POSTS,
    COLLECTION_USERS,
    DATABASE_ID,
    createDatabases
} = require('./appwrite');

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function normalizeUserId(userId) {
    return String(userId || '').trim().replace(/^student_/, '');
}

function getAuthConfig() {
    return {
        endpoint: clean(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg'),
        tokenSecret: clean(process.env.AUTH_TOKEN_SECRET || process.env.APP_AUTH_SECRET || process.env.APPWRITE_API_KEY)
    };
}

function verifyAppToken(config, userId, appToken) {
    if (!appToken || !config.tokenSecret) return false;
    try {
        const [payloadPart, signaturePart] = String(appToken).split('.');
        if (!payloadPart || !signaturePart) throw new Error();
        const expected = crypto.createHmac('sha256', config.tokenSecret).update(payloadPart).digest();
        const actual = Buffer.from(signaturePart, 'base64url');
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error();
        const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
        if (normalizeUserId(payload.sub) !== userId || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) throw new Error();
        return true;
    } catch {
        const error = new Error('登录凭证无效或已过期，请重新登录');
        error.status = 401;
        throw error;
    }
}

async function verifyIdentity(config, userId, credentials) {
    if (verifyAppToken(config, userId, credentials.appToken)) return;
    if (!credentials.sessionSecret) {
        const error = new Error('登录会话已过期，请重新登录');
        error.status = 401;
        throw error;
    }
    const response = await fetch(`${config.endpoint}/account`, {
        headers: {
            'X-Appwrite-Project': config.projectId,
            'X-Appwrite-Session': credentials.sessionSecret
        }
    });
    const account = await response.json().catch(() => ({}));
    if (!response.ok || normalizeUserId(account.$id) !== userId) {
        const error = new Error(response.ok ? '登录身份不匹配' : '登录会话已过期，请重新登录');
        error.status = response.ok ? 403 : 401;
        throw error;
    }
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: '无效的请求体' }) };
    }

    const { userId, boardId, title, content, viewPermission, targetUsers, sessionSecret, appToken } = body;
    const cleanUserId = normalizeUserId(userId);

    if (!cleanUserId || !boardId || !title || !content) {
        return { statusCode: 400, body: JSON.stringify({ error: '缺少必要字段' }) };
    }

    const databases = createDatabases();

    try {
        await verifyIdentity(getAuthConfig(), cleanUserId, { sessionSecret, appToken });
        await databases.getDocument(DATABASE_ID, COLLECTION_USERS, cleanUserId);
        const authorId = `student_${cleanUserId}`;

        // 限流校验：查询今日发帖数
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existing = await databases.listDocuments(
            DATABASE_ID,
            COLLECTION_POSTS,
            [
                Query.equal('authorId', authorId),
                Query.greaterThan('$createdAt', today.toISOString())
            ]
        );

        const DAILY_LIMIT = 5;
        if (existing.total >= DAILY_LIMIT) {
            return {
                statusCode: 429,
                body: JSON.stringify({ error: `今日发帖已达上限（${DAILY_LIMIT}条），请明天再来` })
            };
        }

        // 创建帖子
        const post = await databases.createDocument(
            DATABASE_ID,
            COLLECTION_POSTS,
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

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, postId: post.$id })
        };

    } catch (error) {
        console.error('发帖失败:', error);
        return {
            statusCode: error.status || 500,
            body: JSON.stringify({ error: error.message || '发帖失败' })
        };
    }
};
