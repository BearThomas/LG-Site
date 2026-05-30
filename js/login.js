// js/login.js
// 登录页前端逻辑（已剥离）

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
        // 移除旧弹窗
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

            // 提交验证
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
                    // 执行回调（真正的注册）
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

    // ========== 登录 ==========
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

            // 登录成功处理
            if (result.success) {
                // 用一个新的 client 来恢复会话，避免和页面上的 client 冲突
                const { Client, Account } = await import('https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm');
                const loginClient = new Client()
                    .setEndpoint('https://sgp.cloud.appwrite.io/v1')
                    .setProject('lg');
                const account = new Account(loginClient);

                // 🔥 核心：用 userId 和 secret 创建长期 Session
                await account.createSession(result.userId, result.secret); 

                // 存储学生信息和密钥（不需要再存 token）
                localStorage.setItem('campus_user', JSON.stringify({
                    studentId: result.studentId,
                    encryptKey: result.encryptKey,
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
                        showError('网络错误，请稍后重试');
                    } finally {
                        loginBtn.classList.remove('loading');
                        loginBtn.textContent = '登 录';
                    }
                });

    // ========== 注册（触发验证） ==========
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessages();

        const studentId = regStudentId.value.trim();
        const password = regPassword.value;
        const confirmPassword = regConfirmPassword.value;

        // 前端校验
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

        // 保存待注册信息
        const pendingRegistration = { studentId, password };
        console.log(pendingRegistration)
        // 先弹出校园验证
        await fetchAndShowVerification(() => {
            console.log(pendingRegistration);
            console.log("20240160");
            doRegister(pendingRegistration.studentId, pendingRegistration.password);
        });
    });

    // ========== 回车快捷登录 ==========
    loginStudentId.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginPassword.focus();
    });
    loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginForm.dispatchEvent(new Event('submit'));
    });

    // ========== 检查是否已登录 ==========
    const user = localStorage.getItem('campus_user');
    if (user) {
        try {
            const userData = JSON.parse(user);
            
        } catch (e) {}
    }

})();