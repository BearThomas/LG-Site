// netlify/functions/auth-register.js
// 注册云函数：创建 Appwrite Auth 用户 + 数据库用户文档 + 自动标记虚拟邮箱为已验证

const { Permission, Role } = require('node-appwrite');
const {
    COLLECTION_BOARDS,
    COLLECTION_USERS,
    DATABASE_ID,
    createDatabases,
    createUsers
} = require('./appwrite');

// 学号格式校验
function isValidStudentId(studentId) {
    if (!/^\d{6,8}$/.test(studentId)) return false;
    const year = parseInt(studentId.slice(0, 4), 10);
    const classNum = parseInt(studentId.slice(4, 6), 10);
    const studentNum = parseInt(studentId.slice(6), 10);
    const currentYear = new Date().getFullYear();
    if (year < 2020 || year > currentYear) return false;
    if (classNum < 1 || classNum > 8) return false;
    if (studentNum < 1 || studentNum > 60) return false;
    return true;
}

// 从学号提取班级
function extractClass(studentId) {
    const year = studentId.slice(0, 4);
    const classNum = studentId.slice(4, 6);
    return `${year}届${classNum}班`;
}

// 自动标记邮箱为已验证
async function markEmailVerified(users, userId) {
    if (typeof users.updateEmailVerification === 'function') {
        return await users.updateEmailVerification(userId, true);
    }

    if (typeof users.updateEmail === 'function') {
        return await users.updateEmail(userId, undefined, true);
    }

    console.warn('⚠️ 当前 node-appwrite SDK 未暴露邮箱验证更新方法，已跳过自动验证');
    return null;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { studentId, password, name } = JSON.parse(event.body || '{}');

        if (!studentId || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: '学号和密码不能为空' })
            };
        }

        if (password.length < 8) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: '密码至少8位' })
            };
        }

        if (!isValidStudentId(studentId)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: '学号格式不正确' })
            };
        }

        const users = createUsers();
        const databases = createDatabases();

        try {
            await databases.getDocument(DATABASE_ID, COLLECTION_USERS, studentId);
            return {
                statusCode: 409,
                body: JSON.stringify({ error: '该学号已注册' })
            };
        } catch (e) {
            if (e.code !== 404) {
                console.error('检查用户存在时出错:', e);
            }
        }

        let authUser;
        const displayName = name || `同学${studentId.slice(-4)}`;
        const virtualEmail = `${studentId}@campus.local`;

        try {
            authUser = await users.create(
                studentId,
                virtualEmail,
                undefined,
                password,
                displayName
            );

            await markEmailVerified(users, authUser.$id);

            console.log('✅ Appwrite Auth 账号创建成功，并尝试标记邮箱已验证:', authUser.$id);
        } catch (error) {
            if (error.code === 409) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: '该学号已注册' })
                };
            }
            throw error;
        }

        const userClass = extractClass(studentId);
        const DEFAULT_PERMISSIONS = 31;

        await databases.createDocument(
            DATABASE_ID,
            COLLECTION_USERS,
            studentId,
            {
                userId: studentId,
                name: displayName,
                avatar: null,
                email: virtualEmail,
                role: 'normal',
                permissions: parseInt(DEFAULT_PERMISSIONS),
                joinedBoards: ['main'],
                ownedBoards: [],
                class: userClass,
                mutedUntil: null,
                banned: false
            },
            [
                Permission.read(Role.user(studentId)),
                Permission.update(Role.user(studentId)),
                Permission.delete(Role.user(studentId)),
                Permission.read(Role.team('admin')),
                Permission.write(Role.team('admin'))
            ]
        );

        console.log('✅ Appwrite Databases 用户扩展文档创建成功');

        const classBoardId = `class_${studentId.slice(0, 4)}_${studentId.slice(4, 6)}`;

        try {
            const classBoard = await databases.getDocument(
                DATABASE_ID,
                COLLECTION_BOARDS,
                classBoardId
            );

            await databases.updateDocument(
                DATABASE_ID,
                COLLECTION_BOARDS,
                classBoardId,
                {
                    memberCount: (classBoard.memberCount || 0) + 1
                }
            );

            await databases.updateDocument(
                DATABASE_ID,
                COLLECTION_USERS,
                studentId,
                {
                    joinedBoards: ['main', classBoardId]
                }
            );

            console.log(`🎉 账号已自动加入班级板块: ${classBoardId}`);
        } catch (e) {
            console.log('班级板块未预设，跳过自动加入:', classBoardId);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: '注册成功',
                userId: authUser.$id,
                class: userClass
            })
        };

    } catch (error) {
        console.error('💥 Register 云函数捕获错误:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: '注册失败，请稍后重试: ' + error.message
            })
        };
    }
};