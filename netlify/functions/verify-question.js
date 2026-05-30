// netlify/functions/verify-question.js
// 题库存储在环境变量中，前端无法窃取

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
        const { action, answers } = JSON.parse(event.body);

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
            if (!answers || !Array.isArray(answers) || answers.length === 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: '请回答所有问题' })
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

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    passed: passed,
                    correctCount: correctCount,
                    totalCount: answers.length,
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