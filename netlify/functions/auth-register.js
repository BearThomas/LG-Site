// netlify/functions/auth-register.js
const { Client, Users, Databases, Permission, Role } = require('node-appwrite');

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

// 从学号提取班级（用于自动分配）
function extractClass(studentId) {
    const year = studentId.slice(0, 4);
    const classNum = studentId.slice(4, 6);
    return `${year}届${classNum}班`;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { studentId, password, name } = JSON.parse(event.body);

        // 1. 基本校验
        if (!studentId || !password) {
            return { statusCode: 400, body: JSON.stringify({ error: '学号和密码不能为空' }) };
        }
        if (password.length < 8) {  // Appwrite 要求至少 8 位
            return { statusCode: 400, body: JSON.stringify({ error: '密码至少8位' }) };
        }
        if (!isValidStudentId(studentId)) {
            return { statusCode: 400, body: JSON.stringify({ error: '学号格式不正确' }) };
        }

        // 2. 初始化 Appwrite 客户端
        const client = new Client()
            .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
            .setProject(process.env.APPWRITE_PROJECT_ID)
            .setKey(process.env.APPWRITE_API_KEY);

        const users = new Users(client);
        const databases = new Databases(client);

        const DATABASE_ID = 'lg';
        const COLLECTION_USERS = 'users';

        // 3. 检查学号是否已在 users 表中存在（双重校验）
        try {
            await databases.getDocument(DATABASE_ID, COLLECTION_USERS, studentId);
            return {
                statusCode: 409,
                body: JSON.stringify({ error: '该学号已注册' })
            };
        } catch (e) {
            // 404 表示不存在，可以继续
            if (e.code !== 404) {
                console.error('检查用户存在时出错:', e);
            }
        }

        // 4. 创建 Appwrite 认证用户
        let authUser;
        try {
            authUser = await users.create(
                studentId,                           // userId = 学号
                undefined,                           // email (可选)
                undefined,                           // phone (可选)
                password,                            // password
                `${studentId}@campus.local`          // 虚拟邮箱
            );
        } catch (error) {
            if (error.code === 409) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: '该学号已注册' })
                };
            }
            throw error;
        }

        // 5. 在 users 表中创建用户记录
        const displayName = name || `同学${studentId.slice(-4)}`;
        const userClass = extractClass(studentId);
        
        // 普通用户默认权限值：1(发帖) + 2(删自己帖) + 4(评论) + 8(删自己评论) + 16(表白墙) = 31
        const DEFAULT_PERMISSIONS = 31;
        
        await databases.createDocument(
            DATABASE_ID,
            COLLECTION_USERS,
            studentId,  // 用学号作为文档 ID
            {
                userId: studentId,
                name: displayName,
                avatar: null,
                email: `${studentId}@campus.local`,
                role: 'normal',
                permissions: parseInt(DEFAULT_PERMISSIONS),
                joinedBoards: ['main'],  // 默认加入主板块
                ownedBoards: [],
                class: userClass,
                mutedUntil: null,
                banned: false
            },
            [
                // 权限设置：只有用户自己和管理员可以读写
                Permission.read(Role.user(studentId)),
                Permission.update(Role.user(studentId)),
                Permission.delete(Role.user(studentId)),
                Permission.read(Role.team('admin')),
                Permission.write(Role.team('admin'))
            ]
        );

        // 6. 自动加入班级板块（如果存在）
        const classBoardId = `class_${studentId.slice(0, 4)}_${studentId.slice(4, 6)}`;
        try {
            const classBoard = await databases.getDocument(DATABASE_ID, 'boards', classBoardId);
            // 更新板块成员数
            await databases.updateDocument(DATABASE_ID, 'boards', classBoardId, {
                memberCount: (classBoard.memberCount || 0) + 1
            });
            // 将班级板块加入用户列表
            await databases.updateDocument(DATABASE_ID, COLLECTION_USERS, studentId, {
                joinedBoards: ['main', classBoardId]
            });
        } catch (e) {
            // 班级板块不存在，跳过
            console.log('班级板块不存在，跳过自动加入:', classBoardId);
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
        console.error('Register error:', error);
        
        return {
            statusCode: 500,
            body: JSON.stringify({ error: '注册失败，请稍后重试: ' + error.message })
        };
    }
};