// create-users-table.js
const { Client, Databases } = require('node-appwrite');

const client = new Client()
    .setEndpoint('https://sgp.cloud.appwrite.io/v1')  // 你的端点
    .setProject('lg')              // 替换为你的项目 ID
    .setKey('standard_f83c7a7b817746d953e3267b0b28b4b38f6c85aa9cd8b0a01fe24b7fe8539b8222d7dbcfc93854233568b4c7cc5e85a0f8fc3f117ac49c099ea7c9259828e3bc2c21e7eeaa3f2fa4263021598e7a2074b56c846b1486ac7b85829301ee1b51d5319b322bdeb708c51bf3d76f8cc0cc76a67a6f1de1611f4ec6b7807d21660438');                    // 替换为你的 API Key

const databases = new Databases(client);

const DATABASE_ID = 'lg';
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