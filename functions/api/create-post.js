function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig(env) {
    return {
        endpoint: clean(env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(env.APPWRITE_API_KEY),
        databaseId: clean(env.APPWRITE_DATABASE_ID || env.DATABASE_ID || 'lg'),
        collectionPosts: clean(env.APPWRITE_COLLECTION_POSTS || 'posts')
    };
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

    const { userId, boardId, title, content, viewPermission, targetUsers } = body;

    if (!userId || !boardId || !title || !content) {
        return Response.json({ error: '缺少必要字段' }, { status: 400 });
    }

    try {
        const config = getConfig(env);

        if (!config.apiKey) {
            return Response.json({ error: 'APPWRITE_API_KEY 未配置' }, { status: 500 });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existing = await listDocuments(config, config.collectionPosts, [
            `equal("authorId", ["${userId}"])`,
            `greaterThan("$createdAt", "${today.toISOString()}")`
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
                authorId: userId,
                authorName: String(userId).replace('student_', ''),
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
            { status: 500 }
        );
    }
}

export async function onRequestGet() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}