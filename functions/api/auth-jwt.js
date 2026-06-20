function isValidStudentId(studentId) {
    return /^\d{6,12}$/.test(studentId);
}

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function base64UrlEncode(input) {
    const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signAppToken(env, studentId) {
    const secret = clean(env.AUTH_TOKEN_SECRET || env.APP_AUTH_SECRET || env.APPWRITE_API_KEY);
    if (!secret) return '';

    const now = Math.floor(Date.now() / 1000);
    const payload = base64UrlEncode(JSON.stringify({
        sub: studentId,
        iat: now,
        exp: now + 60 * 60 * 24 * 30
    }));

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));

    return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function onRequestPost({ request, env }) {
    try {
        const { studentId, password } = await request.json();

        if (!studentId || !password) {
            return Response.json({ error: '学号和密码不能为空' }, { status: 400 });
        }

        if (!isValidStudentId(studentId)) {
            return Response.json({ error: '学号格式不正确' }, { status: 400 });
        }

        const finalEndpoint = (env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1').replace(/['"]/g, '').trim();
        const finalProject = (env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg').replace(/['"]/g, '').trim();
        const finalApiKey = env.APPWRITE_API_KEY ? String(env.APPWRITE_API_KEY).replace(/['"]/g, '').trim() : '';

        const getResponse = await fetch(`${finalEndpoint}/users/${studentId}`, {
            method: 'GET',
            headers: {
                'X-Appwrite-Project': finalProject,
                'X-Appwrite-Key': finalApiKey
            }
        });

        if (getResponse.status === 404) {
            const createResponse = await fetch(`${finalEndpoint}/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Appwrite-Project': finalProject,
                    'X-Appwrite-Key': finalApiKey
                },
                body: JSON.stringify({
                    userId: studentId,
                    email: `${studentId}@campus.local`,
                    password,
                    name: `同学${studentId.slice(-4)}`
                })
            });

            if (!createResponse.ok) {
                const createResult = await createResponse.json().catch(() => ({}));
                throw new Error(createResult.message || '创建用户失败');
            }
        }

        const sessionResponse = await fetch(`${finalEndpoint}/account/sessions/email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Appwrite-Project': finalProject
            },
            body: JSON.stringify({
                email: `${studentId}@campus.local`,
                password
            })
        });

        const sessionResult = await sessionResponse.json();

        if (!sessionResponse.ok) {
            if (sessionResult.message && sessionResult.message.includes('prohibited')) {
                throw new Error('检测到已有活跃会话，请先在无痕模式或清除浏览器 Cookie 后重试登录');
            }

            throw new Error(sessionResult.message || '后端 Session 签发受阻');
        }

        return Response.json({
            success: true,
            userId: studentId,
            studentId,
            name: `同学${studentId.slice(-4)}`,
            encryptKey: env.ENCRYPT_KEY,
            sessionSecret: sessionResult.secret || '',
            appToken: await signAppToken(env, studentId)
        });
    } catch (error) {
        console.error('[Fatal Auth Error]:', error);

        return Response.json(
            { error: error.message || '网关安全认证未通过' },
            { status: 400 }
        );
    }
}

export async function onRequestGet() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
