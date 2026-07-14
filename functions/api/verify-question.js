const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function base64UrlEncode(input) {
    const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createVerificationToken(env, studentId) {
    const secret = clean(env.AUTH_TOKEN_SECRET || env.APP_AUTH_SECRET || env.APPWRITE_API_KEY);
    if (!secret) throw new Error('注册验证密钥未配置');

    const payload = base64UrlEncode(JSON.stringify({
        sub: String(studentId),
        purpose: 'campus-registration',
        exp: Math.floor(Date.now() / 1000) + 10 * 60
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

export async function onRequestOptions() {
    return new Response('', {
        status: 200,
        headers: corsHeaders
    });
}

export async function onRequestPost({ request, env }) {
    try {
        const { action, answers, studentId } = await request.json();

        const questionsJson = env.CAMPUS_VERIFY_QUESTIONS;

        if (!questionsJson) {
            return Response.json(
                { error: '题库未配置，请联系管理员' },
                { status: 500, headers: corsHeaders }
            );
        }

        const questions = JSON.parse(questionsJson);

        if (action === 'getQuestions') {
            const shuffled = [...questions].sort(() => Math.random() - 0.5);

            const selected = shuffled.slice(0, 2).map(q => ({
                id: q.id,
                question: q.question,
                hint: q.hint || ''
            }));

            return Response.json(
                { questions: selected },
                { headers: corsHeaders }
            );
        }

        if (action === 'verify') {
            if (!/^\d{6,8}$/.test(String(studentId || ''))) {
                return Response.json(
                    { error: '学号格式不正确' },
                    { status: 400, headers: corsHeaders }
                );
            }
            if (!answers || !Array.isArray(answers) || answers.length !== 2 || new Set(answers.map(a => String(a.id))).size !== 2) {
                return Response.json(
                    { error: '请完整回答两道不同的问题' },
                    { status: 400, headers: corsHeaders }
                );
            }

            let correctCount = 0;
            const results = [];

            for (const ans of answers) {
                const question = questions.find(q => q.id == ans.id);

                if (!question) {
                    return Response.json(
                        { error: '题目不存在' },
                        { status: 400, headers: corsHeaders }
                    );
                }

                const normalizedUser = String(ans.answer || '')
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/g, '');

                const isCorrect = question.answers.some(a =>
                    String(a).toLowerCase().replace(/\s+/g, '') === normalizedUser
                );

                results.push({
                    id: ans.id,
                    correct: isCorrect
                });

                if (isCorrect) correctCount++;
            }

            const passed = correctCount === answers.length;
            const verificationToken = passed
                ? await createVerificationToken(env, studentId)
                : '';

            return Response.json(
                {
                    passed,
                    correctCount,
                    totalCount: answers.length,
                    results,
                    verificationToken,
                    message: passed ? '验证通过' : `答对了 ${correctCount}/${answers.length} 题，请重试`
                },
                { headers: corsHeaders }
            );
        }

        return Response.json(
            { error: '无效的操作' },
            { status: 400, headers: corsHeaders }
        );
    } catch (error) {
        console.error('Verify error:', error);

        return Response.json(
            { error: '服务器错误，请稍后重试' },
            { status: 500, headers: corsHeaders }
        );
    }
}

export async function onRequestGet() {
    return Response.json(
        { error: '请使用 POST 请求' },
        { status: 405, headers: corsHeaders }
    );
}
