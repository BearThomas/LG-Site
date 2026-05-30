/**
 * Appwrite 长期免登录保活自动认证模块（LocalStorage 强力持久化版）
 * 彻底绕过本地开发环境的跨域 Cookie 拦截问题
 */
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT = 'lg';

let client, account;
let cachedJwt = null;

function getAppwriteSDK() {
  if (typeof window.AppwriteWeb !== 'undefined') return window.AppwriteWeb;
  if (typeof window.Appwrite !== 'undefined') return window.Appwrite;
  throw new Error('❌ Appwrite SDK 未加载');
}

function getClient() {
  if (!client) {
    const SDK = getAppwriteSDK();
    client = new SDK.Client()
      .setEndpoint(APPWRITE_ENDPOINT)
      .setProject(APPWRITE_PROJECT);
    account = new SDK.Account(client);
  }
  return client;
}

// 刷新 JWT
// 修改 auto-auth.js 中的 refreshJwt 函数
// 修改前端 auto-auth.js 中的 refreshJwt 函数
async function refreshJwt() {
  getClient();
  try {
    // 1. 从原本 login.js 存的 campus_user 里把学号拿出来
    const campusUser = JSON.parse(localStorage.getItem('campus_user'));
    if (!campusUser || !campusUser.studentId) {
      throw new Error('未发现本地学号缓存，无法自动续期');
    }

    console.log(`📡 正在请求 Netlify 后端为学号 ${campusUser.studentId} 进行 Token 续期...`);
    
    // 2. 发起续期 POST 请求
    const response = await fetch('/.netlify/functions/auth-jwt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'refresh', // 触发后端的续期分支
        studentId: campusUser.studentId // 告诉后端是谁要续期
      })
    });

    const result = await response.json();

    if (response.ok && result.token) {
      cachedJwt = result.token;
      // 3. 将新拿到的 jwt 重新锁回 localStorage 
      localStorage.setItem('persistent_jwt', result.token);
      console.log('🚀 [成功] Netlify 后端已颁发新的长效 Token！');
      return result.token;
    } else {
      throw new Error(result.error || '后端拒绝续期');
    }

  } catch (e) {
    console.warn('⚠️ Netlify 后端续期失败:', e.message);
    return null;
  }
}

// 获取当前有效的 JWT
function getJwt() {
  if (cachedJwt) return cachedJwt;
  cachedJwt = localStorage.getItem('persistent_jwt');
  return cachedJwt;
}

// 统一 API 请求封装
async function apiRequest(url, options = {}) {
  let jwt = getJwt();
  
  const headers = {
    ...options.headers,
    'Content-Type': 'application/json',
  };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

  try {
    let res = await fetch(url, { ...options, headers });
    
    // 如果报 401 错误，说明旧的 JWT 过期了（JWT 通常只有 15 分钟寿命）
    if (res.status === 401) {
      console.log('🔄 JWT 已过期，尝试从云端 Session 续期...');
      jwt = await refreshJwt(); // 尝试用 Cookie 续期
      
      if (jwt) {
        headers['Authorization'] = `Bearer ${jwt}`;
        res = await fetch(url, { ...options, headers }); 
      } else {
        // 🔥 如果 Cookie 续期也失败了（本地没 Cookie），说明真的需要重新登录了
        console.error('❌ 本地持久化令牌已完全失效');
        localStorage.removeItem('persistent_jwt');
        cachedJwt = null;
        window.dispatchEvent(new CustomEvent('auth:sessionExpired'));
      }
    }
    return res;
  } catch (err) {
    console.error('🌐 网络请求异常:', err);
    throw err;
  }
}

// 初始化逻辑
// 修改 auto-auth.js 中的 initAutoAuth 函数

async function initAutoAuth() {
  getClient();
  
  // 1. 优先检查本地 LocalStorage 里有没有之前存下来的令牌
  const localToken = getJwt();
  
  if (localToken) {
    console.log('✓ 发现本地持久化令牌，Thomas，正在恢复您的长效会话...');
    
    // 🚨【超级核心修改】：以前这里只是静静地调用 refreshJwt(); 并没有 await！
    // 现在加上 await！逼迫 initAutoAuth 必须卡在原地，等 Netlify 颁发完新钥匙才能往下走！
    await refreshJwt(); 
    
  } else {
    // 2. 如果本地什么都没有，尝试向云端要一次
    console.log('ℹ️ 本地无令牌，正在尝试同步云端 Session...');
    const cloudJwt = await refreshJwt();
    if (!cloudJwt) {
      console.warn('ℹ️ 彻底确认为未登录状态');
      window.dispatchEvent(new CustomEvent('auth:sessionExpired'));
    }
  }
  
  // 3. 挂载全局请求通道
  window.$api = apiRequest;
}

// 登录
async function login(email, password) {
  getClient();
  await account.createEmailPasswordSession(email, password);
  // 登录成功后，立刻强行换取一个 JWT 并死死锁在 LocalStorage 里
  await refreshJwt();
  console.log('✓ 登录成功，长效本地凭证已锁定');
}

// 登出
async function logout() {
  getClient();
  try {
    await account.deleteSessions();
  } catch (e) {}
  localStorage.removeItem('persistent_jwt');
  cachedJwt = null;
  window.dispatchEvent(new CustomEvent('auth:loggedOut'));
}

window.initAutoAuth = initAutoAuth;
window.login = login;
window.logout = logout;
window.$api = apiRequest;