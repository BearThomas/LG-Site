const { Client, Databases, Query, Account } = require('node-appwrite');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const jwt = event.headers.authorization?.replace('Bearer ', '') || '';
    const { boardId } = JSON.parse(event.body);

    const client = new Client()
        .setEndpoint(process.env.APPWRITE_ENDPOINT)
        .setProject(process.env.APPWRITE_PROJECT_ID)
        .setKey(process.env.APPWRITE_API_KEY);

    const databases = new Databases(client);

    try {
        // 1. 验证用户
        const userClient = new Client()
            .setEndpoint(process.env.APPWRITE_ENDPOINT)
            .setProject(process.env.APPWRITE_PROJECT_ID)
            .setJWT(jwt);
        
        const account = new Account(userClient);
        const user = await account.get();
        const userId = user.$id;

        // 2. 获取板块信息
        const board = await databases.getDocument(
            process.env.DATABASE_ID,
            'boards',
            boardId
        );

        // 3. 获取用户信息
        const userDoc = await databases.listDocuments(
            process.env.DATABASE_ID,
            'users',
            [Query.equal('userId', userId)]
        );

        if (userDoc.documents.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: '用户不存在' }) };
        }

        const doc = userDoc.documents[0];
        const joinedBoards = doc.joinedBoards || [];

        // 4. 检查是否已加入
        if (joinedBoards.includes(boardId)) {
            return { statusCode: 400, body: JSON.stringify({ error: '已加入该板块' }) };
        }

        // 5. 检查加入上限（20个）
        if (joinedBoards.length >= 20) {
            return { statusCode: 400, body: JSON.stringify({ error: '最多加入20个板块' }) };
        }

        // 6. 更新板块成员数
        await databases.updateDocument(
            process.env.DATABASE_ID,
            'boards',
            boardId,
            { memberCount: (board.memberCount || 0) + 1 }
        );

        // 7. 更新用户 joinedBoards
        await databases.updateDocument(
            process.env.DATABASE_ID,
            'users',
            doc.$id,
            { joinedBoards: [...joinedBoards, boardId] }
        );

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        };

    } catch (error) {
        console.error('加入板块失败:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};