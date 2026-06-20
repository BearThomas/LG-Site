function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig() {
    return {
        endpoint: clean(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(process.env.APPWRITE_API_KEY),
        databaseId: clean(process.env.APPWRITE_DATABASE_ID || process.env.DATABASE_ID || 'lg'),
        collectionComments: clean(process.env.APPWRITE_COLLECTION_COMMENTS || 'comments')
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

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed' });
    }

    try {
        const config = getConfig();
        const { postId, content, userId, sessionSecret } = JSON.parse(event.body || '{}');
        const cleanUserId = normalizeUserId(userId);
        const cleanContent = String(content || '').trim();

        if (!config.apiKey) return json(500, { error: 'APPWRITE_API_KEY 未配置' });
        if (!postId) return json(400, { error: '缺少帖子 ID' });
        if (!cleanUserId) return json(401, { error: '请先登录' });
        if (!cleanContent) return json(400, { error: '请输入评论内容' });
        if (cleanContent.length < 2) return json(400, { error: '内容太短，多说两个字吧' });
        if (cleanContent.length > 500) return json(400, { error: '评论不能超过 500 字' });

        await verifySession(config, cleanUserId, sessionSecret);

        const comment = await appwriteFetch(
            config,
            `/databases/${config.databaseId}/collections/${config.collectionComments}/documents`,
            {
                method: 'POST',
                body: JSON.stringify({
                    documentId: 'unique()',
                    data: {
                        postId,
                        content: cleanContent,
                        authorId: cleanUserId,
                        authorName: `同学${cleanUserId.slice(-4)}`
                    }
                })
            }
        );

        return json(200, { success: true, commentId: comment.$id });
    } catch (error) {
        console.error('发表评论失败:', error);
        return json(error.status || 500, { error: error.message || '发表评论失败' });
    }
};
