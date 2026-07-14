// netlify/functions/verify-question.js
// 题库存储在环境变量中，前端无法窃取

const crypto = require('crypto');

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function createVerificationToken(studentId) {
    const secret = clean(process.env.AUTH_TOKEN_SECRET || process.env.APP_AUTH_SECRET || process.env.APPWRITE_API_KEY);
    if (!secret) throw new Error('注册验证密钥未配置');

    const payload = Buffer.from(JSON.stringify({
        sub: String(studentId),
        purpose: 'campus-registration',
        exp: Math.floor(Date.now() / 1000) + 10 * 60
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // 处理预检请求
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers, 
            body: JSON.stringify({ error: '请使用 POST 请求' }) 
        };
    }

    try {
        const { action, answers, studentId } = JSON.parse(event.body);

        // 从环境变量读取题库（安全！前端看不到）
        const questionsJson = process.env.CAMPUS_VERIFY_QUESTIONS;
        if (!questionsJson) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: '题库未配置，请联系管理员' })
            };
        }

        const questions = JSON.parse(questionsJson);

        // ========== 获取随机题目（不返回答案） ==========
        if (action === 'getQuestions') {
            // 随机抽取 2 道题
            const shuffled = [...questions].sort(() => Math.random() - 0.5);
            const selected = shuffled.slice(0, 2).map(q => ({
                id: q.id,
                question: q.question,
                hint: q.hint || ''
            }));

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ questions: selected })
            };
        }

        // ========== 验证答案 ==========
        if (action === 'verify') {
            if (!/^\d{6,8}$/.test(String(studentId || ''))) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: '学号格式不正确' })
                };
            }
            if (!answers || !Array.isArray(answers) || answers.length !== 2 || new Set(answers.map(a => String(a.id))).size !== 2) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: '请完整回答两道不同的问题' })
                };
            }

            // 逐一验证
            let correctCount = 0;
            const results = [];

            for (const ans of answers) {
                const question = questions.find(q => q.id == ans.id);
                if (!question) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ error: '题目不存在' })
                    };
                }

                const normalizedUser = ans.answer.trim().toLowerCase().replace(/\s+/g, '');
                const isCorrect = question.answers.some(
                    a => a.toLowerCase().replace(/\s+/g, '') === normalizedUser
                );

                results.push({
                    id: ans.id,
                    correct: isCorrect
                });

                if (isCorrect) correctCount++;
            }

            const passed = correctCount === answers.length;
            const verificationToken = passed ? createVerificationToken(studentId) : '';

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    passed: passed,
                    correctCount: correctCount,
                    totalCount: answers.length,
                    verificationToken,
                    message: passed ? '验证通过' : `答对了 ${correctCount}/${answers.length} 题，请重试`
                })
            };
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: '无效的操作' })
        };

    } catch (error) {
        console.error('Verify error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: '服务器错误，请稍后重试' })
        };
    }
};
