const { Client, Databases, Query } = require('node-appwrite');

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

    const { userId, boardId, title, content, viewPermission, targetUsers } = body;

    if (!userId || !boardId || !title || !content) {
        return { statusCode: 400, body: JSON.stringify({ error: '缺少必要字段' }) };
    }

    const client = new Client()
        .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_PROJECT_ID)
        .setKey(process.env.APPWRITE_API_KEY);

    const databases = new Databases(client);

    try {
        // 限流校验：查询今日发帖数
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existing = await databases.listDocuments(
            process.env.DATABASE_ID || 'lg',
            'posts',
            [
                Query.equal('authorId', userId),
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
            process.env.DATABASE_ID || 'lg',
            'posts',
            'unique()',
            {
                boardId,
                title,
                content,
                authorId: userId,
                authorName: userId.replace('student_', ''),
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
            statusCode: 500,
            body: JSON.stringify({ error: error.message || '发帖失败' })
        };
    }
};