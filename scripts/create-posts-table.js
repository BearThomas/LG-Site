// scripts/create-posts-table.js
const { DATABASE_ID, databases } = require('./appwrite-client');
const COLLECTION_ID = 'posts';

async function createPostsCollection() {
    try {
        // 检查是否已存在
        try {
            const existing = await databases.getCollection(DATABASE_ID, COLLECTION_ID);
            console.log(`⚠️ 集合 "${COLLECTION_ID}" 已存在，跳过建表。`);
            return;
        } catch (error) {
            if (error.code !== 404) throw error;
        }

        // 创建集合
        const collection = await databases.createCollection(DATABASE_ID, COLLECTION_ID, 'Posts');
        console.log(`✅ 集合创建成功: ${collection.$id}`);

        await addAttributes();
        await addIndexes();
        
        console.log('🎉 帖子表创建完成！');

    } catch (error) {
        console.error('❌ 建表失败:', error.message);
    }
}

async function addAttributes() {
    const attributes = [
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'boardId', 36, true), name: 'boardId' },
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'title', 100, true), name: 'title' },
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'content', 10000, true), name: 'content' },
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'authorId', 20, true), name: 'authorId' },
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'authorName', 30, true), name: 'authorName' },
        { fn: () => databases.createIntegerAttribute(DATABASE_ID, COLLECTION_ID, 'viewPermission', true, 1), name: 'viewPermission' },
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'targetGroups', 36, false, null, true), name: 'targetGroups' },
        { fn: () => databases.createIntegerAttribute(DATABASE_ID, COLLECTION_ID, 'status', true, 0), name: 'status' },
        { fn: () => databases.createDatetimeAttribute(DATABASE_ID, COLLECTION_ID, 'editedAt', false, null), name: 'editedAt' },
    ];

    for (const attr of attributes) {
        try {
            await attr.fn();
            console.log(`   ✅ 字段 ${attr.name} 添加成功`);
        } catch (error) {
            if (error.message?.includes('already exists') || error.code === 409) {
                console.log(`   ⏭️ 字段 ${attr.name} 已存在，跳过`);
            } else {
                throw error;
            }
        }
    }
}

async function addIndexes() {
    const indexes = [
        { key: 'idx_boardId', type: 'key', attributes: ['boardId'] },
        { key: 'idx_authorId', type: 'key', attributes: ['authorId'] },
        { key: 'idx_board_status', type: 'key', attributes: ['boardId', 'status'] },
    ];

    for (const idx of indexes) {
        try {
            await databases.createIndex(DATABASE_ID, COLLECTION_ID, idx.key, idx.type, idx.attributes);
            console.log(`   ✅ 索引 ${idx.key} 创建成功`);
        } catch (error) {
            if (error.message?.includes('already exists') || error.code === 409) {
                console.log(`   ⏭️ 索引 ${idx.key} 已存在，跳过`);
            } else {
                throw error;
            }
        }
    }
}

createPostsCollection();
