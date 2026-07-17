import { getAuthTokenSecret, getRegistrationQuestions } from '../_lib/config.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';
import { secureShuffle, signToken } from '../_lib/tokens.js';

function normalizeAnswer(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const questions = getRegistrationQuestions(env);

    if (body.action === 'getQuestions') {
      return json({
        questions: secureShuffle(questions).slice(0, 2).map(question => ({
          id: question.id,
          question: question.question,
          hint: question.hint || ''
        }))
      });
    }

    if (body.action !== 'verify') throw new HttpError(400, '无效操作');
    const studentId = String(body.studentId || '').trim();
    if (!/^\d{6,8}$/.test(studentId)) throw new HttpError(400, '学号格式不正确');
    if (!Array.isArray(body.answers) || body.answers.length !== 2) {
      throw new HttpError(400, '请完整回答两道题');
    }
    if (new Set(body.answers.map(answer => String(answer.id))).size !== 2) {
      throw new HttpError(400, '请选择两道不同的题目');
    }

    const results = body.answers.map(answer => {
      const question = questions.find(item => String(item.id) === String(answer.id));
      if (!question) throw new HttpError(400, '题目不存在或已更新，请重新获取');
      const submitted = normalizeAnswer(answer.answer);
      const correct = question.answers.some(candidate => normalizeAnswer(candidate) === submitted);
      return { id: answer.id, correct };
    });
    const correctCount = results.filter(result => result.correct).length;
    const passed = correctCount === results.length;
    const verificationToken = passed
      ? await signToken(
          getAuthTokenSecret(env),
          { purpose: 'campus-registration', sub: studentId },
          10 * 60
        )
      : '';

    return json({
      passed,
      correctCount,
      totalCount: results.length,
      results,
      verificationToken,
      message: passed ? '验证通过' : `答对了 ${correctCount}/${results.length} 题，请重试`
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/verify-question', message: error.message, status: error.status }));
    return errorResponse(error, '验证失败，请稍后重试');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
