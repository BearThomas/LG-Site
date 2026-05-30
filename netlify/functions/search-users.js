// netlify/functions/search-users.js
const { Client, Databases, Query } = require('node-appwrite');

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
    // const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
    //     const COLLECTION_USERS = process.env.APPWRITE_COLLECTION_USERS;
        
    //     console.log('=== 环境变量检查 ===');
    //     console.log('APPWRITE_DATABASE_ID:', DATABASE_ID, '| 类型:', typeof DATABASE_ID);
    //     console.log('APPWRITE_COLLECTION_USERS:', COLLECTION_USERS, '| 类型:', typeof COLLECTION_USERS);
    //     console.log('APPWRITE_ENDPOINT:', process.env.APPWRITE_ENDPOINT);
    //     console.log('APPWRITE_PROJECT_ID:', process.env.APPWRITE_PROJECT_ID);
    try {
        const client = new Client()
            .setEndpoint(process.env.APPWRITE_ENDPOINT)
            .setProject(process.env.APPWRITE_PROJECT_ID)
            .setKey(process.env.APPWRITE_API_KEY);

        const databases = new Databases(client);

        // 模糊搜索学号
        const response = await databases.listDocuments(
            process.env.APPWRITE_DATABASE_ID || 'lg',
            process.env.APPWRITE_COLLECTION_USERS || 'users',
            [
                Query.contains('userId', keyword),
                Query.limit(10)
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