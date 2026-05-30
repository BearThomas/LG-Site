// scripts/create-comments-table.js
const { Client, Databases } = require('node-appwrite');

const client = new Client()
    .setEndpoint('https://sgp.cloud.appwrite.io/v1')  // 你的端点
    .setProject('lg')              // 替换为你的项目 ID
    .setKey('standard_f83c7a7b817746d953e3267b0b28b4b38f6c85aa9cd8b0a01fe24b7fe8539b8222d7dbcfc93854233568b4c7cc5e85a0f8fc3f117ac49c099ea7c9259828e3bc2c21e7eeaa3f2fa4263021598e7a2074b56c846b1486ac7b85829301ee1b51d5319b322bdeb708c51bf3d76f8cc0cc76a67a6f1de1611f4ec6b7807d21660438');                    // 替换为你的 API Key



const databases = new Databases(client);

const DATABASE_ID = 'lg';
const COLLECTION_ID = 'comments';

async function createCommentsCollection() {
    try {
        // 检查是否已存在
        try {
            const existing = await databases.getCollection(DATABASE_ID, COLLECTION_ID);
            console.log(`⚠️ 集合 "${COLLECTION_ID}" 已存在，跳过建表。`);
            return;
        } catch (error) {
            if (error.code !== 404) throw error;
             // 创建集合
            const collection = await databases.createCollection(DATABASE_ID, COLLECTION_ID, 'Comments');
            console.log(`✅ 集合创建成功: ${collection.$id}`);
        }

       

        // 添加字段
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'postId', 36, true);
        console.log('   ✅ postId');
        
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'content', 500, true);
        console.log('   ✅ content');
        
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'authorId', 20, true);
        console.log('   ✅ authorId');
        
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'authorName', 30, true);
        console.log('   ✅ authorName');

        // 创建索引
        await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'idx_postId', 'key', ['postId']);
        console.log('   ✅ 索引 idx_postId');

        console.log('🎉 评论表创建完成！');

    } catch (error) {
        console.error('❌ 建表失败:', error.message);
    }
}

createCommentsCollection();