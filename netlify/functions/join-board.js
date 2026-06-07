const { Query } = require('node-appwrite');
const {
    COLLECTION_BOARDS,
    COLLECTION_USERS,
    DATABASE_ID,
    createAccount,
    createDatabases
} = require('./appwrite');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const jwt = event.headers.authorization?.replace('Bearer ', '') || '';
    const { boardId } = JSON.parse(event.body);

    const databases = createDatabases();

    try {
        // 1. 验证用户
        const account = createAccount(jwt);
        const user = await account.get();
        const userId = user.$id;

        // 2. 获取板块信息
        const board = await databases.getDocument(
            DATABASE_ID,
            COLLECTION_BOARDS,
            boardId
        );

        // 3. 获取用户信息
        const userDoc = await databases.listDocuments(
            DATABASE_ID,
            COLLECTION_USERS,
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
            DATABASE_ID,
            COLLECTION_BOARDS,
            boardId,
            { memberCount: (board.memberCount || 0) + 1 }
        );

        // 7. 更新用户 joinedBoards
        await databases.updateDocument(
            DATABASE_ID,
            COLLECTION_USERS,
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
