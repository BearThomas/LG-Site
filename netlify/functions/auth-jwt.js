// netlify/functions/auth-jwt.js
// Made by BearThomas 2026/5/31
const { Client, Users } = require('node-appwrite');

// ========== 🛡️ 学号格式刚性校验断路器 ==========
function isValidStudentId(studentId) {
    if (!/^\d{6,12}$/.test(studentId)) return false;
    return true;
}

exports.handler = async (event) => {
    // 🛡️ 限制只接收 POST
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

        // 🔍 【环境安全审计日志】
        console.log("📡 [Env Check] 开始建立 Appwrite 线上安全隧道...");
        
        // 🧼 强行清洗可能被 Netlify 误吞的单双引号或隐形尾部换行符
        const finalEndpoint = (process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1').replace(/['"]/g, '').trim();
        const finalProject = (process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg').replace(/['"]/g, '').trim();

        console.log(`🚀 [Env Check] 当前咬合配置 -> Endpoint: "${finalEndpoint}", Project: "${finalProject}"`);

        const client = new Client()
            .setEndpoint(finalEndpoint)
            .setProject(finalProject)
            .setKey(process.env.APPWRITE_API_KEY);

        const users = new Users(client);

        // ====================================================
        // 🌟 精准对齐状态码，自愈消灭 409 漏洞
        // ====================================================
        try { 
            await users.get(studentId); 
            console.log(`👤 [Auth Sync] 用户 ${studentId} 已存在于云端，跳过创建。`);
        } catch (getErr) {
            // 当 Appwrite 返回 404（用户不存在）时，触发自动注册流程
            if (getErr.code === 404 || getErr.type === 'user_not_found') {
                console.log(`📝 [Auth Sync] 用户 ${studentId} 是新同学，正在现场执行无感建档...`);
                try {
                    await users.create(studentId, undefined, undefined, undefined, `同学${studentId.slice(-4)}`);
                    console.log(`✅ [Auth Sync] 新同学 ${studentId} 账户建档成功。`);
                } catch (createErr) {
                    if (createErr.code === 409 || createErr.type === 'user_already_exists') {
                        console.log(`⚠️ [Auth Sync] 遭遇并发创建临界点，无缝放行。`);
                    } else {
                        throw createErr;
                    }
                }
            } else {
                console.error("❌ [Auth Sync] 遭遇非 404 阻碍错误:", getErr);
                throw getErr;
            }
        }

        // ====================================================
        // 🌟【终极修复核心】：彻底干掉 {} 对象，直接盲传纯字符串！
        // ====================================================
        console.log(`🔑 [Auth Sync] 正在为用户 ${studentId} 签发一次性授信凭证(Token)...`);
        
        // 🧼 拒绝传入 { userId: studentId }，直接以纯 string 喂给 SDK，彻底抹除后端 Body 冲突！
        const token = await users.createToken(studentId); 
        const secret = token.secret; 

        console.log(`🎉 [Auth Sync] 授信成功！正在安全分发下行数据包。`);
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                success: true,
                userId: studentId,      
                secret: secret,          
                studentId: studentId,
                encryptKey: process.env.ENCRYPT_KEY
            })
        };

    } catch (error) {
        console.error('💥 [Fatal Auth Error] 云函数生命周期遭遇严重崩塌:', error);
        
        // 动态识别真实报错状态码返回给前端
        const errCode = error.code && error.code >= 400 && error.code < 600 ? error.code : 500;
        return { 
            statusCode: errCode, 
            body: JSON.stringify({ 
                error: error.message || '安全网关验证失败',
                type: error.type || 'unknown_auth_error'
            }) 
        };
    }
};