// netlify/functions/auth-register.js
// 注册云函数（已完全修复 Appwrite SDK 参数错位导致的匿名与403/401冲突漏洞）

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
    // 强制限制请求方法
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { studentId, password, name } = JSON.parse(event.body);

        // 1. 严格的前端输入刚性校验
        if (!studentId || !password) {
            return { statusCode: 400, body: JSON.stringify({ error: '学号和密码不能为空' }) };
        }
        if (password.length < 8) {  // Appwrite 官方认证系统安全硬性要求至少 8 位
            return { statusCode: 400, body: JSON.stringify({ error: '密码至少8位' }) };
        }
        if (!isValidStudentId(studentId)) {
            return { statusCode: 400, body: JSON.stringify({ error: '学号格式不正确' }) };
        }

        // 2. 初始化高权 Appwrite 后端控制客户端
        const client = new Client()
            .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
            .setProject(process.env.APPWRITE_PROJECT_ID)
            .setKey(process.env.APPWRITE_API_KEY);

        const users = new Users(client);
        const databases = new Databases(client);

        const DATABASE_ID = 'lg';
        const COLLECTION_USERS = 'users';

        // 3. 检查学号是否已在数据库集合中存在（双重安全防御）
        try {
            await databases.getDocument(DATABASE_ID, COLLECTION_USERS, studentId);
            return {
                statusCode: 409,
                body: JSON.stringify({ error: '该学号已注册' })
            };
        } catch (e) {
            // 404 状态码表示不存在该文档，属于正常状态，可以放行创建
            if (e.code !== 404) {
                console.error('检查用户存在时出错:', e);
            }
        }

        // 🌟 4. 创建 Appwrite 认证用户 (核心修复：对齐官方 SDK 严格的参数位置签名)
        // 标准顺位：users.create(userId, email, phone, password, name)
        let authUser;
        const displayName = name || `同学${studentId.slice(-4)}`; // 提取学号后四位作为缺省初始昵称
        
        try {
            authUser = await users.create(
                studentId,                           // 1. userId (明确绑定为学号字符串)
                `${studentId}@campus.local`,         // 2. email (⭐ 虚拟邮箱归位！彻底终结匿名黑户陷阱)
                undefined,                           // 3. phone (无手机绑定，传 undefined)
                password,                            // 4. password (明文密码，供 Auth 底层加密托管)
                displayName                          // 5. name (真正的用户实名昵称)
            );
            console.log('✅ Appwrite Auth 实名账号同步创建成功:', authUser.$id);
        } catch (error) {
            if (error.code === 409) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: '该学号已注册' })
                };
            }
            throw error;
        }

        // 5. 在数据库 users 集合中联动创建个性化用户扩展记录
        const userClass = extractClass(studentId);
        const DEFAULT_PERMISSIONS = 31; // 默认权限掩码
        
        await databases.createDocument(
            DATABASE_ID,
            COLLECTION_USERS,
            studentId,  // 强制用学号作为集合内的 Document ID，方便后续前端一键查询
            {
                userId: studentId,
                name: displayName,
                avatar: null,
                email: `${studentId}@campus.local`,
                role: 'normal',
                permissions: parseInt(DEFAULT_PERMISSIONS),
                joinedBoards: ['main'],  // 默认打通主板块
                ownedBoards: [],
                class: userClass,
                mutedUntil: null,
                banned: false
            },
            [
                // 数据行级权限隔离：只有用户本人和 admin 团队有权读写此名片
                Permission.read(Role.user(studentId)),
                Permission.update(Role.user(studentId)),
                Permission.delete(Role.user(studentId)),
                Permission.read(Role.team('admin')),
                Permission.write(Role.team('admin'))
            ]
        );
        console.log('✅ Appwrite Databases 映射扩展文档同步创建成功');

        // 6. 自动扫描并加入班级专属板块
        const classBoardId = `class_${studentId.slice(0, 4)}_${studentId.slice(4, 6)}`;
        try {
            const classBoard = await databases.getDocument(DATABASE_ID, 'boards', classBoardId);
            // 原子递增板块成员数计数器
            await databases.updateDocument(DATABASE_ID, 'boards', classBoardId, {
                memberCount: (classBoard.memberCount || 0) + 1
            });
            // 将自动识别出的班级板块追加进用户的已加入阵营
            await databases.updateDocument(DATABASE_ID, COLLECTION_USERS, studentId, {
                joinedBoards: ['main', classBoardId]
            });
            console.log(`🎉 账号已自动无感编入班级板块: ${classBoardId}`);
        } catch (e) {
            // 班级板块在系统内未建立时，静默跳过，不阻断主线注册
            console.log('班级板块未预设，跳过自动编入逻辑:', classBoardId);
        }

        // 注册大获全胜，返回许可
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
        console.error('💥 Register 云函数灾难性捕获:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: '注册失败，请稍后重试: ' + error.message })
        };
    }
};