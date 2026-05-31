// netlify/functions/auth-jwt.js
// Made by BearThomas 2026/5/31
const { Client, Users } = require('node-appwrite');

// ========== 🛡️ 学号格式刚性校验断路器 ==========
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
        // 🌟 核心高阶重构：精准对齐状态码，自愈消灭 409 漏洞
        // ====================================================
        try { 
            await users.get(studentId); 
            console.log(`👤 [Auth Sync] 盘查完毕：用户 ${studentId} 已存在于云端，跳过创建。`);
        } catch (getErr) {
            // 🔍 判定：只有当 Appwrite 明确返回 404（用户不存在）时，才触发自动注册流程
            if (getErr.code === 404 || getErr.type === 'user_not_found') {
                console.log(`📝 [Auth Sync] 盘查完毕：用户 ${studentId} 是新同学，正在现场执行无感建档...`);
                try {
                    await users.create(studentId, undefined, undefined, undefined, `同学${studentId.slice(-4)}`);
                    console.log(`✅ [Auth Sync] 新同学 ${studentId} 账户建档成功。`);
                } catch (createErr) {
                    // 🛡️ 终极并发防御：如果极小概率下别人刚巧也在同一毫秒触发了建档，拦截 409
                    if (createErr.code === 409 || createErr.type === 'user_already_exists') {
                        console.log(`⚠️ [Auth Sync] 遭遇并发创建临界点，账户已被抢先建立，无缝放行。`);
                    } else {
                        throw createErr; // 别的建档错误（如格式不合规）继续外抛给大 catch
                    }
                }
            } else {
                // 如果是网络震荡、凭证失效等非 404 错误，绝不瞎建档，直接外抛查明真相
                console.error("❌ [Auth Sync] 遭遇非 404 阻碍错误:", getErr);
                throw getErr;
            }
        }

        // 🔥 长效 Session 令牌兑换点
        console.log(`🔑 [Auth Sync] 正在为用户 ${studentId} 签发一次性安全授信凭证(Token)...`);
        const token = await users.createToken({ userId: studentId }); 
        const secret = token.secret; // 兑换客户端持久化 Session 的终极黑盒

        console.log(`🎉 [Auth Sync] 授信成功！正在安全分发下行数据包。`);
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                success: true,
                userId: studentId,      
                secret: secret,          
                studentId: studentId,
                encryptKey: process.env.ENCRYPT_KEY // 吐给前端用来和本地 IndexedDB 钥匙核对
            })
        };

    } catch (error) {
        // 🎯 这里的 catch 现在只会拦截到【真正的未知系统级崩溃】，再也不会把 409 错当成 401 误杀给前端了
        console.error('💥 [Fatal Auth Error] 云函数生命周期遭遇严重崩塌:', error);
        
        // 动态识别真实报错状态码返回给前端，彻底破除“指鹿为马”的万能好人卡现象
        const errCode = error.code && error.code >= 400 && error.code < 600 ? error.code : 401;
        return { 
            statusCode: errCode, 
            body: JSON.stringify({ 
                error: error.message || '安全网关验证失败',
                type: error.type || 'unknown_auth_error'
            }) 
        };
    }
};