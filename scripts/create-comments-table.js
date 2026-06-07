// scripts/create-comments-table.js
const { DATABASE_ID, databases } = require('./appwrite-client');
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
