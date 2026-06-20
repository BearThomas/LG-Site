const crypto = require('crypto');

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig() {
    return {
        endpoint: clean(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(process.env.APPWRITE_API_KEY),
        tokenSecret: clean(process.env.AUTH_TOKEN_SECRET || process.env.APP_AUTH_SECRET || process.env.APPWRITE_API_KEY)
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
        body: JSON.stringify({ password: newPassword })
    });

    if (!response.ok) {
        const data = await readJson(response).catch(() => ({}));
        throw new Error(data.message || '密码修改失败');
    }
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' });
    }

    try {
        const config = getConfig();
        const { studentId, oldPassword, newPassword, sessionSecret, appToken } = JSON.parse(event.body || '{}');
        const cleanStudentId = normalizeUserId(studentId);

        if (!config.apiKey) return json(500, { error: 'APPWRITE_API_KEY 未配置' });
        if (!cleanStudentId || !oldPassword || !newPassword) {
            return json(400, { error: '请完整填写原当前密码与安全新密码' });
        }
        if (String(newPassword).length < 8) return json(400, { error: '新密码长度至少为 8 位' });

        await verifyIdentity(config, cleanStudentId, { sessionSecret, appToken });
        await verifyOldPassword(config, cleanStudentId, oldPassword);
        await updateUserPassword(config, cleanStudentId, newPassword);

        return json(200, { success: true });
    } catch (error) {
        console.error('修改密码失败:', error);
        return json(error.status || 500, { error: error.message || '修改密码失败' });
    }
};
