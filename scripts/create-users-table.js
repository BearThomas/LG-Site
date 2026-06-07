// create-users-table.js
const { DATABASE_ID, databases } = require('./appwrite-client');
const COLLECTION_ID = 'users';

async function createUsersCollection() {
    try {
        // 1. 先检查集合是否已存在
        try {
            const existing = await databases.getCollection(DATABASE_ID, COLLECTION_ID);
            console.log(`⚠️ 集合 "${COLLECTION_ID}" 已存在，跳过建表。`);
            console.log(`   现有字段数量: ${existing.attributes?.length || 0}`);
            // 3. 添加字段
            await addAttributes();
            
            // 4. 创建索引
            await addIndexes();
            return;
        } catch (error) {
            // 404 表示不存在，继续创建
            if (error.code !== 404) {
                throw error;
            }
        }

        // 2. 创建集合
        const collection = await databases.createCollection(
            DATABASE_ID,
            COLLECTION_ID,
            'Users'
        );
        
        console.log(`✅ 集合创建成功: ${collection.$id}`);

        // 3. 添加字段
        await addAttributes();
        
        // 4. 创建索引
        await addIndexes();
        
        console.log('🎉 用户表创建完成！');

    } catch (error) {
        console.error('❌ 建表失败:', error.message);
    }
}

async function addAttributes() {
    const attributes = [
        // userId
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'userId', 20, true), name: 'userId' },
        // name
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'name', 30, true), name: 'name' },
        // avatar
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'avatar', 255, false, null), name: 'avatar' },
        // email
        { fn: () => databases.createEmailAttribute(DATABASE_ID, COLLECTION_ID, 'email', false, null), name: 'email' },
        // role
        { fn: () => databases.createEnumAttribute(DATABASE_ID, COLLECTION_ID, 'role', ['normal', 'moderator', 'admin', 'super_admin'], true), name: 'role' },
        // permissions
        { fn: () => databases.createIntegerAttribute(DATABASE_ID, COLLECTION_ID, 'permissions', true, 11583), name: 'permissions' },
        // joinedBoards
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'joinedBoards', 255, true, undefined, true), name: 'joinedBoards' },
        // ownedBoards
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'ownedBoards', 255, true, undefined, true), name: 'ownedBoards' },
        // class
        { fn: () => databases.createStringAttribute(DATABASE_ID, COLLECTION_ID, 'class', 20, false, null), name: 'class' },
        // mutedUntil
        { fn: () => databases.createDatetimeAttribute(DATABASE_ID, COLLECTION_ID, 'mutedUntil', false, null), name: 'mutedUntil' },
        // banned
        { fn: () => databases.createBooleanAttribute(DATABASE_ID, COLLECTION_ID, 'banned', true), name: 'banned' },
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
        { key: 'idx_userId', type: 'unique', attributes: ['userId'] },
        { key: 'idx_role', type: 'key', attributes: ['role'] },
        { key: 'idx_class', type: 'key', attributes: ['class'] },
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

createUsersCollection();
