function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig(env) {
    return {
        endpoint: clean(env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(env.APPWRITE_API_KEY),
        databaseId: clean(env.APPWRITE_DATABASE_ID || env.DATABASE_ID || 'lg'),
        collectionComments: clean(env.APPWRITE_COLLECTION_COMMENTS || 'comments')
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
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
        const error = new Error(data.message || data.error || `Appwrite 请求失败：${response.status}`);
        error.status = response.status;
        throw error;
    }

    return data;
}

function buildQueryParams(queries) {
    const params = new URLSearchParams();
    queries.forEach(query => params.append('queries[]', JSON.stringify(query)));
    return params.toString();
}

export async function onRequestGet({ request, env }) {
    try {
        const config = getConfig(env);
        const url = new URL(request.url);
        const postId = url.searchParams.get('postId');

        if (!postId) {
            return Response.json({ error: '缺少帖子 ID' }, { status: 400 });
        }

        if (!config.apiKey) {
            return Response.json({ error: 'APPWRITE_API_KEY 未配置' }, { status: 500 });
        }

        const queryString = buildQueryParams([
            { method: 'equal', attribute: 'postId', values: [postId] },
            { method: 'limit', values: [100] }
        ]);

        const result = await appwriteFetch(
            config,
            `/databases/${config.databaseId}/collections/${config.collectionComments}/documents?${queryString}`,
            { method: 'GET' }
        );

        const documents = Array.isArray(result.documents) ? result.documents : [];
        documents.sort((a, b) => new Date(a.$createdAt || a.createdAt) - new Date(b.$createdAt || b.createdAt));

        return Response.json({
            success: true,
            documents
        });
    } catch (error) {
        console.error('加载评论失败:', error);
        return Response.json({ error: error.message || '加载评论失败' }, { status: 500 });
    }
}

export async function onRequestPost() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
