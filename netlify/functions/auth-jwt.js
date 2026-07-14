// netlify/functions/auth-jwt.js
// 🛠️ 终极无 SDK 污染纯物理 Fetch 咬合版
// Made by BearThomas 2026/5/31

const crypto = require('crypto');

function isValidStudentId(studentId) {
    if (!/^\d{6,12}$/.test(studentId)) return false;
    return true;
}

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function signAppToken(studentId) {
    const secret = clean(process.env.AUTH_TOKEN_SECRET || process.env.APP_AUTH_SECRET || process.env.APPWRITE_API_KEY);
    if (!secret) return '';

    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
        sub: studentId,
        iat: now,
        exp: now + 60 * 60 * 24 * 30
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

    return `${payload}.${signature}`;
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

        const finalEndpoint = (process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1').replace(/['"]/g, '').trim();
        const finalProject = (process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg').replace(/['"]/g, '').trim();
        const finalApiKey = process.env.APPWRITE_API_KEY ? String(process.env.APPWRITE_API_KEY).replace(/['"]/g, '').trim() : '';
        const finalDatabase = clean(process.env.APPWRITE_DATABASE_ID || process.env.DATABASE_ID || 'lg');
        const finalUsersCollection = clean(process.env.APPWRITE_COLLECTION_USERS || 'users');

        // 1. 物理检查用户
        let getResponse = await fetch(`${finalEndpoint}/users/${studentId}`, {
            method: 'GET',
            headers: { 'X-Appwrite-Project': finalProject, 'X-Appwrite-Key': finalApiKey }
        });

        // 登录接口只负责认证，禁止在这里绕过注册流程自动建号
        if (getResponse.status === 404) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: '该学号尚未注册，请先完成注册' })
            };
        }
        if (!getResponse.ok) {
            throw new Error('账号状态检查失败，请稍后重试');
        }

        // 只有完成正式注册、已写入用户资料库的账号才允许登录。
        // 这也会拦截旧版本登录接口曾经自动创建的“幽灵账号”。
        const profileResponse = await fetch(
            `${finalEndpoint}/databases/${finalDatabase}/collections/${finalUsersCollection}/documents/${studentId}`,
            { headers: { 'X-Appwrite-Project': finalProject, 'X-Appwrite-Key': finalApiKey } }
        );
        if (profileResponse.status === 404) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: '该学号尚未完成注册，请先注册' })
            };
        }
        if (!profileResponse.ok) throw new Error('注册状态检查失败，请稍后重试');

        // 2. 仅为已注册用户创建 Session
        console.log(`📡 [Backend Auth] 正在后端隧道为用户 ${studentId} 建立官方长效 Session...`);
        const sessionResponse = await fetch(`${finalEndpoint}/account/sessions/email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Appwrite-Project': finalProject
            },
            body: JSON.stringify({
                email: `${studentId}@campus.local`,
                password: password
            })
        });

        const sessionResult = await sessionResponse.json();

        if (!sessionResponse.ok) {
            // 如果多开冲突，后端现场物理执行强洗
            if (sessionResult.message && sessionResult.message.includes("prohibited")) {
                throw new Error("检测到已有活跃会话，请先在无痕模式或清除浏览器Cookie后重试登录");
            }
            throw new Error(sessionResult.message || '后端 Session 签发受阻');
        }

        // 4. 大获全胜！把全套完成凭证直接打包发给前端
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                success: true,
                userId: studentId,      
                studentId: studentId,
                name: `同学${studentId.slice(-4)}`,
                encryptKey: process.env.ENCRYPT_KEY,
                sessionSecret: sessionResult.secret || '', // 把合规的持久化 Secret 交付给前端落地
                appToken: signAppToken(studentId)
            })
        };

    } catch (error) {
        console.error('💥 [Fatal Auth Error]:', error);
        return { 
            statusCode: 400, 
            body: JSON.stringify({ error: error.message || '网关安全认证未通过' }) 
        };
    }
};
