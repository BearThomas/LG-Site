// netlify/functions/search-users.js
const { Query } = require('node-appwrite');
const {
    COLLECTION_USERS,
    DATABASE_ID,
    createDatabases
} = require('./appwrite');

exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const keyword = event.queryStringParameters?.keyword?.trim();

    if (!keyword) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: '请输入学号' }) };
    }
    try {
        const databases = createDatabases();

        // 模糊搜索学号
        const response = await databases.listDocuments(
            DATABASE_ID,
            COLLECTION_USERS,
            [
                Query.contains('userId', keyword),
                // Query.limit(10)
            ]
        );

        const users = response.documents.map(doc => ({
            studentId: doc.userId,
            userId: doc.$id
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ users })
        };

    } catch (error) {
        console.error('搜索用户失败:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: '搜索失败' })
        };
    }
};
