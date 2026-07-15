import { HttpError } from './http.js';

export function clean(value) {
  return String(value ?? '').replace(/^['"]|['"]$/g, '').trim();
}

export function required(env, name) {
  const value = clean(env?.[name]);
  if (!value) {
    const error = new HttpError(500, `缺少环境变量：${name}`);
    error.expose = true;
    throw error;
  }
  return value;
}

export function getAppwriteConfig(env, { requireApiKey = false } = {}) {
  const config = {
    endpoint: required(env, 'APPWRITE_ENDPOINT').replace(/\/$/, ''),
    projectId: required(env, 'APPWRITE_PROJECT_ID'),
    apiKey: clean(env.APPWRITE_API_KEY)
  };

  if (requireApiKey && !config.apiKey) {
    const error = new HttpError(500, '缺少环境变量：APPWRITE_API_KEY');
    error.expose = true;
    throw error;
  }
  return config;
}

export function getAuthTokenSecret(env) {
  const secret = required(env, 'AUTH_TOKEN_SECRET');
  if (secret.length < 32) {
    const error = new HttpError(500, 'AUTH_TOKEN_SECRET 至少需要 32 个字符');
    error.expose = true;
    throw error;
  }
  return secret;
}

export function getBackupEncryptKey(env) {
  return clean(env.BACKUP_ENCRYPT_KEY || env.ENCRYPT_KEY);
}

export function getRuntimeConfig(env) {
  return {
    tokenTtlSeconds: clampNumber(env.AUTH_SESSION_TTL_SECONDS, 15 * 60, 24 * 60 * 60, 60 * 60),
    timezoneOffsetMinutes: clampNumber(env.APP_TIMEZONE_OFFSET_MINUTES, -12 * 60, 14 * 60, 8 * 60),
    postDailyLimit: clampNumber(env.POST_DAILY_LIMIT, 1, 1000, 5),
    commentDailyLimit: clampNumber(env.COMMENT_DAILY_LIMIT, 1, 5000, 100),
    confessionDailyLimit: clampNumber(env.CONFESSION_DAILY_LIMIT, 1, 1000, 20)
  };
}

export function getRegistrationQuestions(env) {
  const raw = required(env, 'CAMPUS_VERIFY_QUESTIONS');
  try {
    const questions = JSON.parse(raw);
    if (!Array.isArray(questions) || questions.length < 2) {
      throw new Error('至少需要两道题');
    }
    for (const question of questions) {
      if (!question?.id || !question?.question || !Array.isArray(question.answers) || !question.answers.length) {
        throw new Error('题目必须包含 id、question 和 answers');
      }
    }
    return questions;
  } catch (error) {
    const wrapped = new HttpError(500, `CAMPUS_VERIFY_QUESTIONS 格式错误：${error.message}`);
    wrapped.expose = true;
    throw wrapped;
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
