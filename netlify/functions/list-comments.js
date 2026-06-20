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

function json(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

function buildQueryParams(queries) {
    const params = new URLSearchParams();
    queries.forEach(query => params.append('queries[]', JSON.stringify(query)));
    return params.toString();
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

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return json(405, { error: 'Method not allowed' });
    }

    try {
        const config = getConfig();
        const postId = event.queryStringParameters?.postId;

        if (!postId) return json(400, { error: '缺少帖子 ID' });
        if (!config.apiKey) return json(500, { error: 'APPWRITE_API_KEY 未配置' });

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

        return json(200, { success: true, documents });
    } catch (error) {
        console.error('加载评论失败:', error);
        return json(500, { error: error.message || '加载评论失败' });
    }
};
