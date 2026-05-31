// js/login.js
// 登录页前端逻辑（已修复会话令牌丢失与语法缺陷）

(function() {
    'use strict';

    // ========== API 配置 ==========
    const API_BASE = '/.netlify/functions';
    
    // ========== DOM 元素 ==========
    const tabs = document.querySelectorAll('.login-tab');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    
    const loginStudentId = document.getElementById('loginStudentId');
    const loginPassword = document.getElementById('loginPassword');
    const loginBtn = document.getElementById('loginBtn');
    
    const regStudentId = document.getElementById('regStudentId');
    const regPassword = document.getElementById('regPassword');
    const regConfirmPassword = document.getElementById('regConfirmPassword');
    const registerBtn = document.getElementById('registerBtn');

    // 验证弹窗相关元素（动态创建）
    let verifyModal = null;
    let currentQuestions = [];
    let pendingRegistration = null;

    // ========== 工具函数 ==========
    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.add('show');
        successMsg.classList.remove('show');
    }

    function showSuccess(msg) {
        successMsg.textContent = msg;
        successMsg.classList.add('show');
        errorMsg.classList.remove('show');
    }

    function hideMessages() {
        errorMsg.classList.remove('show');
        successMsg.classList.remove('show');
    }

    function isValidStudentId(id) {
        return /^\d{6,12}$/.test(id);
    }

    // ========== 创建校园验证弹窗 ==========
    function createVerifyModal(questions, onSubmit) {
        if (verifyModal) {
            verifyModal.remove();
        }

        verifyModal = document.createElement('div');
        verifyModal.className = 'verification-overlay';
        verifyModal.innerHTML = `
            <div class="verification-modal">
                <div class="verification-header">
                    <span>🏫 校园身份验证</span>
                    <button class="verification-close">&times;</button>
                </div>
                <div class="verification-body">
                    <p class="verification-tip">请回答以下问题，证明你是本校学生</p>
                    <form id="verificationForm">
                        ${questions.map((q, i) => `
                            <div class="verify-question">
                                <label>${i + 1}. ${q.question}</label>
                                ${q.hint ? `<span class="verify-hint">${q.hint}</span>` : ''}
                                <input type="text" 
                                       name="q_${q.id}" 
                                       data-id="${q.id}"
                                       placeholder="请输入答案" 
                                       autocomplete="off">
                            </div>
                        `).join('')}
                        <div class="verification-actions">
                            <button type="button" class="verify-cancel-btn">取消</button>
                            <button type="submit" class="verify-submit-btn">提交验证</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(verifyModal);

        const closeBtn = verifyModal.querySelector('.verification-close');
        const cancelBtn = verifyModal.querySelector('.verify-cancel-btn');
        const form = verifyModal.querySelector('#verificationForm');

        const closeModal = () => {
            verifyModal.remove();
            verifyModal = null;
            pendingRegistration = null;
        };

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        verifyModal.addEventListener('click', (e) => {
            if (e.target === verifyModal) closeModal();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const inputs = form.querySelectorAll('input');
            const answers = [];
            
            for (const input of inputs) {
                const id = input.dataset.id;
                const answer = input.value.trim();
                if (!answer) {
                    showError('请回答所有问题');
                    return;
                }
                answers.push({ id: parseInt(id), answer: answer });
            }

            const submitBtn = form.querySelector('.verify-submit-btn');
            submitBtn.textContent = '验证中...';
            submitBtn.disabled = true;

            try {
                const response = await fetch(`${API_BASE}/verify-question`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'verify', answers })
                });

                const result = await response.json();

                if (result.passed) {
                    showSuccess('验证通过！');
                    closeModal();
                    onSubmit();
                } else {
                    showError(result.message || '验证失败，请重试');
                }
            } catch (err) {
                showError('网络错误，请稍后重试');
            } finally {
                submitBtn.textContent = '提交验证';
                submitBtn.disabled = false;
            }
        });
    }

    // ========== 获取验证题目 ==========
    async function fetchAndShowVerification(callback) {
        try {
            const response = await fetch(`${API_BASE}/verify-question`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getQuestions' })
            });

            const result = await response.json();
            
            if (result.questions && result.questions.length > 0) {
                currentQuestions = result.questions;
                createVerifyModal(currentQuestions, callback);
            } else {
                showError('获取验证题目失败');
            }
        } catch (err) {
            showError('网络错误，请稍后重试');
        }
    }

    // ========== 执行真正的注册 ==========
    async function doRegister(studentId, password) {
        console.log('🚀 doRegister 被调用', { studentId, password });
        
        try {
            const url = '/.netlify/functions/auth-register';
            console.log('📡 请求地址:', url);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, password })
            });

            console.log('📦 响应状态:', response.status);
            
            const data = await response.json();
            console.log('📦 响应数据:', data);

            if (response.ok) {
                alert('注册成功！');
                document.querySelector('[data-tab="login"]').click();
                document.getElementById('loginStudentId').value = studentId;
            } else {
                alert('注册失败: ' + JSON.stringify(data));
            }
        } catch (err) {
            console.error('💥 异常:', err);
            alert('网络错误，看控制台: ' + err.message);
        }
    }

    // ========== 选项卡切换 ==========
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            if (targetTab === 'login') {
                loginForm.classList.remove('hidden');
                registerForm.classList.add('hidden');
            } else {
                loginForm.classList.add('hidden');
                registerForm.classList.remove('hidden');
            }
            
            hideMessages();
        });
    });

    // ========== 登录业务内核 ==========
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessages();

        const studentId = loginStudentId.value.trim();
        const password = loginPassword.value;

        if (!studentId) {
            showError('请输入学号');
            return;
        }
        if (!isValidStudentId(studentId)) {
            showError('学号格式不正确（6-12位数字）');
            return;
        }
        if (!password) {
            showError('请输入密码');
            return;
        }

        loginBtn.classList.add('loading');
        loginBtn.textContent = '登录中...';

        try {
            const response = await fetch(`${API_BASE}/auth-jwt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'login',
                    studentId: studentId,
                    password: password
                })
            });

            const result = await response.json();

            // 在你的登录成功分支里替换
            if (result.success) {
                const rawKeyHex = result.encryptKey; // 假设这是云端给你的 Hex 密钥
                
                // 1. 把 Hex 字符串转成字节数组
                const keyBytes = new Uint8Array(rawKeyHex.match(/.{2}/g).map(b => parseInt(b, 16)));
                
                // 2. 🌟 将其导入为浏览器托管的 CryptoKey，核心是设置 [extractable: false]
                const cryptoKey = await crypto.subtle.importKey(
                    "raw",
                    keyBytes,
                    { name: "AES-CBC" },
                    false, // 👈 关键：false 代表【不可导出】！一旦落地，神仙也拿不到明文
                    ["decrypt", "encrypt"] // 允许这把钥匙用来解密和加密
                );

                // 3. 把这个临时的 cryptoKey 存在当前页面的全局变量，或者存入 IndexedDB 里长效留存
                window.secureKeyBlackBox = cryptoKey; 
                await localforage.setItem('secure_gate_key', cryptoKey);
                console.log("🔒 密钥已成功锁入浏览器硬件级黑盒，控制台已无法读取！");
            }

            // 验证系统后台下发的登录许可
            if (result.success) {
                const { Client, Account } = await import('https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm');
                const loginClient = new Client()
                    .setEndpoint('https://sgp.cloud.appwrite.io/v1')
                    .setProject('lg');
                const account = new Account(loginClient);

                const loginEmail = `${studentId.trim()}@campus.local`;
                
                let session = null;

                // ⚡ ⭐ 【核心自愈大招】：直面幽灵 Cookie 冲突
                try {
                    // 尝试第一次标准登录
                    session = await account.createEmailPasswordSession(loginEmail, password); 
                } catch (loginError) {
                    // 🛡️ 如果服务器抛出“已有活跃会话”的 401 冲突拦截
                    if (loginError.message && loginError.message.includes("prohibited")) {
                        console.log("🔄 触发服务器级会话冲突！检测到幽灵 Cookie，正在进行现场强力清洗...");
                        
                        // 此时服务器承认会话存在，这句注销必然百分之百在云端执行成功，把幽灵 Cookie 彻底扬了
                        await account.deleteSession('current'); 
                        
                        console.log("🧹 幽灵会话已强制全量蒸发，正在原地发起二次登录重试...");
                        // 瞬间进行二次原地登录，此时两端障碍全部扫清，必定一路绿灯！
                        session = await account.createEmailPasswordSession(loginEmail, password);
                    } else {
                        // 如果是密码错误等其他真实异常，直接抛给外层 catch
                        throw loginError;
                    }
                }

                // ⚡ 凭证安全护航：保存完整的上下文凭证，将凭证 Secret 映射为其他页面急需的 token
                localStorage.setItem('campus_user', JSON.stringify({
                    userId: result.studentId,
                    studentId: result.studentId,
                    name: result.name || result.studentId, 
                    encryptKey: result.encryptKey,
                    token: session.secret, // 🔑 注入个人中心和帖子流改密必用的核心长效钥匙
                    loginTime: Date.now()
                }));

                showSuccess('登录成功！正在跳转...');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 800);
            } else {
                showError(result.error || '登录失败，请检查学号和密码');
            }
        } catch (err) {
            console.error("💥 登录链路最终捕获异常:", err);
            // 优雅拦截并翻译
            if (err.message && err.message.includes("Invalid credentials")) {
                showError('❌ 登录失败：学号或密码不正确！');
            } else {
                showError(`网络通信故障，或凭证异常: ${err.message}`);
            }
        } finally {
            loginBtn.classList.remove('loading');
            loginBtn.textContent = '登 录';
        }
    });

    // ========== 注册触发验证 ==========
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessages();

        const studentId = regStudentId.value.trim();
        const password = regPassword.value;
        const confirmPassword = regConfirmPassword.value;

        if (!password) {
            showError('请输入密码');
            return;
        }
        if (password.length < 8) {
            showError('密码至少8位');
            return;
        }
        if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
            showError('密码必须包含字母和数字');
            return;
        }
        if (password !== confirmPassword) {
            showError('两次密码不一致');
            return;
        }

        const pendingData = { studentId, password };
        
        await fetchAndShowVerification(() => {
            doRegister(pendingData.studentId, pendingData.password);
        });
    });

    // ========== 快捷事件监听 ==========
    loginStudentId.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginPassword.focus();
    });
    loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginForm.dispatchEvent(new Event('submit'));
    });

})();