const crypto = require('crypto');
const { COLLECTION_USERS, DATABASE_ID, createDatabases } = require('./appwrite');

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function normalizeUserId(userId) {
    return String(userId || '').trim().replace(/^student_/, '');
}

function json(statusCode, body) {
    return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function getAuthConfig() {
    return {
        endpoint: clean(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg'),
        tokenSecret: clean(process.env.AUTH_TOKEN_SECRET || process.env.APP_AUTH_SECRET || process.env.APPWRITE_API_KEY)
    };
}

async function verifyIdentity(config, userId, { sessionSecret, appToken }) {
    if (appToken && config.tokenSecret) {
        try {
            const [payloadPart, signaturePart] = String(appToken).split('.');
            const expected = crypto.createHmac('sha256', config.tokenSecret).update(payloadPart).digest();
            const actual = Buffer.from(signaturePart, 'base64url');
            const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
            if (
                expected.length === actual.length &&
                crypto.timingSafeEqual(expected, actual) &&
                normalizeUserId(payload.sub) === userId &&
                Number(payload.exp || 0) >= Math.floor(Date.now() / 1000)
            ) return;
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

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    try {
        const { content, userId, sessionSecret, appToken } = JSON.parse(event.body || '{}');
        const cleanUserId = normalizeUserId(userId);
        const cleanContent = String(content || '').trim();
        if (cleanContent.length < 5) return json(400, { error: cleanContent ? '内容至少5个字' : '内容不能为空' });
        if (!cleanUserId) return json(401, { error: '请先登录' });

        await verifyIdentity(getAuthConfig(), cleanUserId, { sessionSecret, appToken });
        const databases = createDatabases();
        await databases.getDocument(DATABASE_ID, COLLECTION_USERS, cleanUserId);
        const confession = await databases.createDocument(
            DATABASE_ID,
            clean(process.env.APPWRITE_COLLECTION_CONFESSIONS || 'confessions'),
            'unique()',
            {
                content: cleanContent,
                authorId: cleanUserId,
                authorName: '匿名',
                toName: null,
                status: 0,
                likes: 0
            }
        );
        return json(200, { success: true, confessionId: confession.$id });
    } catch (error) {
        console.error('发表表白失败:', error);
        return json(error.status || 500, { error: error.message || '发表失败' });
    }
};
