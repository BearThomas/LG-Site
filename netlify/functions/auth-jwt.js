// netlify/functions/auth-jwt.js
// 🛠️ 终极无 SDK 污染纯物理 Fetch 咬合版
// Made by BearThomas 2026/5/31

// 降级保留 Client 仅备后面可能的需求，核心查询与创建全部换成原生物理 Fetch，彻底绝育 request body 错误！
const { Client } = require('node-appwrite');

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

        console.log("📡 [Env Check] 开始清洗环境变量与密钥...");
        const finalEndpoint = (process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1').replace(/['"]/g, '').trim();
        const finalProject = (process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg').replace(/['"]/g, '').trim();
        const finalApiKey = process.env.APPWRITE_API_KEY ? String(process.env.APPWRITE_API_KEY).replace(/['"]/g, '').trim() : '';

        console.log(`🚀 [Env Check] 物理对齐配置 -> Endpoint: "${finalEndpoint}", Project: "${finalProject}"`);

        // ====================================================
        // 🌟 核心高阶重构：手写原生纯净 GET 请求，彻底粉碎 SDK 空 Body 漏洞
        // ====================================================
        let userExists = false;
        let userData = null;

        console.log(`👤 [Auth Sync] 正在通过原生物理通道盘查用户 ${studentId} 是否存在于云端...`);
        
        // 🧼 刚性硬核：发起绝无任何 Body 污染的纯净原生 HTTP GET 请求！
        const getResponse = await fetch(`${finalEndpoint}/users/${studentId}`, {
            method: 'GET', // 纯净 GET
            headers: {
                'Content-Type': 'application/json',
                'X-Appwrite-Project': finalProject,
                'X-Appwrite-Key': finalApiKey
            }
            // 🚨 绝对不写 body 属性！从物理层斩断 request cannot have request body 的可能！
        });

        const getResult = await getResponse.json();

        if (getResponse.ok) {
            userExists = true;
            userData = getResult;
            console.log(`👤 [Auth Sync] 盘查完毕：用户 ${studentId} 确认存在，直接放行.`);
        } else if (getResponse.status === 404 || getResult.type === 'user_not_found') {
            // 📝 用户不存在，走原生物理 POST 执行自动建档注册
            console.log(`📝 [Auth Sync] 用户 ${studentId} 是新同学，正在现场通过物理通道建档...`);
            
            const createResponse = await fetch(`${finalEndpoint}/users`, {
                method: 'POST', // 注册需要 POST
                headers: {
                    'Content-Type': 'application/json',
                    'X-Appwrite-Project': finalProject,
                    'X-Appwrite-Key': finalApiKey
                },
                body: JSON.stringify({
                    userId: studentId,
                    email: `${studentId}@campus.local`, // 自动规范邮箱双口袋
                    phone: undefined,
                    password: password, // 将初始密码同步对齐
                    name: `同学${studentId.slice(-4)}`
                })
            });

            const createResult = await createResponse.json();

            if (createResponse.ok || createResponse.status === 409) {
                console.log(`✅ [Auth Sync] 新同学 ${studentId} 账户物理建档成功。`);
                userExists = true;
            } else {
                throw new Error(createResult.message || '原生物理建档被拒绝');
            }
        } else {
            // 如果遇到别的类似 400 错误，直接吐出真实底层报错
            throw new Error(getResult.message || `Appwrite 物理通道阻碍: ${getResponse.status}`);
        }

        // ====================================================
        // 🌟 签发 Token 部分：同样换成无可挑剔的物理 POST 请求
        // ====================================================
        console.log(`🔑 [Auth Sync] 正在为用户 ${studentId} 签发一次性物理安全 Token...`);
        
        const tokenResponse = await fetch(`${finalEndpoint}/users/${studentId}/tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Appwrite-Project': finalProject,
                'X-Appwrite-Key': finalApiKey
            },
            body: JSON.stringify({
                userId: studentId
            })
        });

        const tokenResult = await tokenResponse.json();

        if (!tokenResponse.ok) {
            throw new Error(tokenResult.message || '物理令牌签发失败');
        }

        const secret = tokenResult.secret;
        console.log(`🎉 [Auth Sync] 全链路物理闭合授信成功！下行分发数据包中.`);

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
        return { 
            statusCode: 500, 
            body: JSON.stringify({ 
                error: error.message || '安全网关物理验证失败',
                type: 'fatal_physical_auth_error'
            }) 
        };
    }
};