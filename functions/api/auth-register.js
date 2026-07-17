import { createAuthUser, createPasswordSession, deleteAuthUser, deleteCurrentSession, getAccountWithSession } from '../_lib/appwrite.js';
import { getAppwriteConfig, getAuthTokenSecret } from '../_lib/config.js';
import { ensureUserRow, extractClass, getUserRow } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';
import { verifyToken } from '../_lib/tokens.js';

function validStudentId(studentId) {
  if (!/^\d{6,8}$/.test(studentId)) return false;
  const year = Number(studentId.slice(0, 4));
  const classNumber = Number(studentId.slice(4, 6));
  const studentNumber = Number(studentId.slice(6));
  const currentYear = new Date().getUTCFullYear();
  return year >= 2020 && year <= currentYear && classNumber >= 1 && classNumber <= 99 && studentNumber >= 1 && studentNumber <= 99;
}

async function verifyRegistration(env, studentId, token) {
  const payload = await verifyToken(getAuthTokenSecret(env), token, { purpose: 'campus-registration' });
  if (String(payload.sub) !== studentId) throw new HttpError(403, '校园身份验证与当前学号不匹配');
}

export async function onRequestPost({ request, env }) {
  let newlyCreatedAuthUser = false;
  let studentId = '';
  let transientSessionSecret = '';
  let appwriteConfig = null;
  try {
    const body = await readJsonBody(request);
    studentId = String(body.studentId || '').trim();
    const password = String(body.password || '');
    const displayName = String(body.name || `同学${studentId.slice(-4)}`).trim().slice(0, 12);
    const verificationToken = String(body.verificationToken || '');

    if (!validStudentId(studentId)) throw new HttpError(400, '学号格式不正确');
    if (password.length < 8 || password.length > 256) throw new HttpError(400, '密码长度需要在 8 到 256 位之间');
    if (!displayName) throw new HttpError(400, '昵称不能为空');
    await verifyRegistration(env, studentId, verificationToken);

    if (await getUserRow(env, studentId)) throw new HttpError(409, '该学号已注册');
    const config = getAppwriteConfig(env, { requireApiKey: true });
    appwriteConfig = config;
    let account;

    try {
      account = await createAuthUser(config, studentId, password, displayName);
      newlyCreatedAuthUser = true;
    } catch (error) {
      if (error.status !== 409) throw error;
      const session = await createPasswordSession(config, studentId, password);
      transientSessionSecret = String(session.secret || '').trim();
      if (!transientSessionSecret) throw new HttpError(409, '该学号已有账号，请使用原密码登录');
      account = await getAccountWithSession(config, transientSessionSecret);
    }

    const classBoard = `class_${studentId.slice(0, 4)}_${studentId.slice(4, 6)}`;
    const profile = await ensureUserRow(env, account, {
      userId: studentId,
      name: displayName,
      email: `${studentId}@campus.local`,
      className: extractClass(studentId),
      joinedBoards: ['main', classBoard],
      permissions: 31
    });

    if (transientSessionSecret) {
      try {
        await deleteCurrentSession(config, transientSessionSecret);
      } catch (cleanupError) {
        console.warn(JSON.stringify({ level: 'warn', route: '/api/auth-register', event: 'transient_session_cleanup_failed', status: cleanupError.status }));
      }
      transientSessionSecret = '';
    }

    return json({
      success: true,
      message: '注册成功',
      userId: profile.id,
      class: profile.class_name
    }, 201);
  } catch (error) {
    if (transientSessionSecret && appwriteConfig) {
      try {
        await deleteCurrentSession(appwriteConfig, transientSessionSecret);
      } catch {}
    }
    if (newlyCreatedAuthUser && studentId) {
      try {
        await deleteAuthUser(getAppwriteConfig(env, { requireApiKey: true }), studentId);
      } catch {}
    }
    console.error(JSON.stringify({ level: 'error', route: '/api/auth-register', message: error.message, status: error.status }));
    return errorResponse(error, '注册失败，请稍后重试');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
