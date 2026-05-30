// scripts/create-posts-table.js
const { Client, Databases } = require('node-appwrite');

const client = new Client()
    .setEndpoint('https://sgp.cloud.appwrite.io/v1')  // 你的端点
    .setProject('lg')              // 替换为你的项目 ID
    .setKey('standard_f83c7a7b817746d953e3267b0b28b4b38f6c85aa9cd8b0a01fe24b7fe8539b8222d7dbcfc93854233568b4c7cc5e85a0f8fc3f117ac49c099ea7c9259828e3bc2c21e7eeaa3f2fa4263021598e7a2074b56c846b1486ac7b85829301ee1b51d5319b322bdeb708c51bf3d76f8cc0cc76a67a6f1de1611f4ec6b7807d21660438');                    // 替换为你的 API Key


const databases = new Databases(client);

const DATABASE_ID = 'lg';
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