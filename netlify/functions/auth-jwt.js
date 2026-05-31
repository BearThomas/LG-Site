// netlify/functions/auth-jwt.js
const { Client, Users } = require('node-appwrite');

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

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { studentId, password } = JSON.parse(event.body);

        if (!studentId || !password) {
            return { statusCode: 400, body: JSON.stringify({ error: '学号和密码不能为空' }) };
        }
        if (!isValidStudentId(studentId)) {
            return { statusCode: 400, body: JSON.stringify({ error: '学号格式不正确' }) };
        }

        console.log("📡 [Env Check] 开始盘查线上环境变量...");
        console.log("📡 [Env Check] ENDPOINT 原文:", process.env.APPWRITE_ENDPOINT);
        console.log("📡 [Env Check] ENDPOINT 类型:", typeof process.env.APPWRITE_ENDPOINT);
        console.log("📡 [Env Check] PROJECT_ID 原文:", process.env.APPWRITE_PROJECT_ID);
        console.log("📡 [Env Check] API_KEY 是否存在:", !!process.env.APPWRITE_API_KEY);

        // 刚性洗白处理
        const finalEndpoint = (process.env.APPWRITE_ENDPOINT).trim();
        const finalProject = (process.env.APPWRITE_PROJECT_ID).trim();

        console.log(`🚀 [Env Check] 最终咬合注入 -> Endpoint: "${finalEndpoint}", Project: "${finalProject}"`);

        const client = new Client()
            .setEndpoint(finalEndpoint)
            .setProject(finalProject)
            .setKey(process.env.APPWRITE_API_KEY);

        // const client = new Client()
        //     .setEndpoint(process.env.APPWRITE_ENDPOINT)
        //     .setProject(process.env.APPWRITE_PROJECT_ID)
        //     .setKey(process.env.APPWRITE_API_KEY);

        const users = new Users(client);

        // 确保用户存在
        try { await users.get(studentId); } catch {
            await users.create(studentId, undefined, undefined, undefined, `同学${studentId.slice(-4)}`);
        }

        // 🔥 核心修改：使用 createToken 生成一次性 Token
        const token = await users.createToken({ userId: studentId }); 
        const secret = token.secret; // 这是客户端用来兑换 Session 的凭证

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                userId: studentId,      // 学号就是 userId
                secret: secret,          // 将 secret 返回给客户端
                studentId: studentId,
                encryptKey: process.env.ENCRYPT_KEY
            })
        };
    } catch (error) {
        console.error('Auth error:', error);
        return { statusCode: 401, body: JSON.stringify({ error: '验证失败' }) };
    }
};