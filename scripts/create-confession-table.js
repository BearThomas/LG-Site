// scripts/create-confessions-table.js
const { DATABASE_ID, databases } = require('./appwrite-client');
const COLLECTION_ID = 'confessions';

async function createConfessionsCollection() {
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
        const collection = await databases.createCollection(DATABASE_ID, COLLECTION_ID, 'Confessions');
        console.log(`✅ 集合创建成功: ${collection.$id}`);

        // 添加字段
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'content', 300, true);
        console.log('   ✅ content (300)');
        
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'authorId', 20, true);
        console.log('   ✅ authorId (20)');
        
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'authorName', 30, true);
        console.log('   ✅ authorName (30)');
        
        await databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'toName', 30, false, null);
        console.log('   ✅ toName (30)');
        
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTION_ID, 'status', true, 0);
        console.log('   ✅ status (默认 0)');
        
        await databases.createIntegerAttribute(DATABASE_ID, COLLECTION_ID, 'likes', true, 0);
        console.log('   ✅ likes (默认 0)');

        // 创建索引
        await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'idx_createdAt', 'key', ['$createdAt']);
        console.log('   ✅ 索引 idx_createdAt');
        
        await databases.createIndex(DATABASE_ID, COLLECTION_ID, 'idx_likes', 'key', ['likes']);
        console.log('   ✅ 索引 idx_likes');

        console.log('🎉 表白墙表创建完成！');

    } catch (error) {
        console.error('❌ 建表失败:', error.message);
    }
}

createConfessionsCollection();
