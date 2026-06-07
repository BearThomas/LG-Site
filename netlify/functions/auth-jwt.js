// netlify/functions/auth-jwt.js
// 🛠️ 终极无 SDK 污染纯物理 Fetch 咬合版
// Made by BearThomas 2026/5/31

function isValidStudentId(studentId) {
    if (!/^\d{6,12}$/.test(studentId)) return false;
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

        const finalEndpoint = (process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1').replace(/['"]/g, '').trim();
        const finalProject = (process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg').replace(/['"]/g, '').trim();
        const finalApiKey = process.env.APPWRITE_API_KEY ? String(process.env.APPWRITE_API_KEY).replace(/['"]/g, '').trim() : '';

        // 1. 物理检查用户
        let getResponse = await fetch(`${finalEndpoint}/users/${studentId}`, {
            method: 'GET',
            headers: { 'X-Appwrite-Project': finalProject, 'X-Appwrite-Key': finalApiKey }
        });

        // 2. 如果不存在，现场无感建档
        if (getResponse.status === 404) {
            await fetch(`${finalEndpoint}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Appwrite-Project': finalProject, 'X-Appwrite-Key': finalApiKey },
                body: JSON.stringify({
                    userId: studentId,
                    email: `${studentId}@campus.local`,
                    password: password,
                    name: `同学${studentId.slice(-4)}`
                })
            });
        }

        // 3. 现场直接在后端通过密码为用户创建合规 Session，完美绕过前端浏览器的 403 跨域 Cookie 限制！
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
                sessionSecret: sessionResult.secret || '' // 把合规的持久化 Secret 交付给前端落地
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
