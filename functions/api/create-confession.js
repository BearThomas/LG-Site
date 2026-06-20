function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig(env) {
    return {
        endpoint: clean(env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(env.APPWRITE_API_KEY),
        databaseId: clean(env.APPWRITE_DATABASE_ID || env.DATABASE_ID || 'lg'),
        collectionConfessions: clean(env.APPWRITE_COLLECTION_CONFESSIONS || 'confessions')
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
        const { content, userId } = await request.json();

        if (!content || !String(content).trim()) {
            return Response.json({ error: '内容不能为空' }, { status: 400 });
        }

        if (String(content).trim().length < 5) {
            return Response.json({ error: '内容至少5个字' }, { status: 400 });
        }

        if (!userId) {
            return Response.json({ error: '请先登录' }, { status: 401 });
        }

        if (!config.apiKey) {
            return Response.json({ error: 'APPWRITE_API_KEY 未配置' }, { status: 500 });
        }

        const confession = await createDocument(
            config,
            config.collectionConfessions,
            'unique()',
            {
                content: String(content).trim(),
                authorId: userId,
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
            { status: 500 }
        );
    }
}

export async function onRequestGet() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}