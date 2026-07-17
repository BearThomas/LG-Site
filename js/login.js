// js/login.js
// 登录页前端逻辑（已完美重构：改用高阶 Token 凭证兑换流，彻底消灭 Body 冲突漏洞）
// Made by BearThomas 2026/5/31

(function() {
    'use strict';

    // ========== API 配置 ==========
    const API_BASE = '/api';
    
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
        if (verifyModal) verifyModal.remove();

        verifyModal = document.createElement('div');
        verifyModal.className = 'verification-overlay';
        verifyModal.innerHTML = `
            <div class="verification-modal">
                <div class="verification-header">
                    <span>校园身份验证</span>
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
                    body: JSON.stringify({
                        action: 'verify',
                        answers,
                        studentId: pendingRegistration?.studentId || ''
                    })
                });
                const result = await response.json();
                if (result.passed) {
                    showSuccess('验证通过！');
                    closeModal();
                    onSubmit(result.verificationToken);
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

    // ========== 执行注册 ==========
    async function doRegister(studentId, password, verificationToken) {
        try {
            const response = await fetch(`${API_BASE}/auth-register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, password, verificationToken })
            });
            const data = await response.json();
            if (response.ok) {
                alert('注册成功！');
                document.querySelector('[data-tab="login"]').click();
                document.getElementById('loginStudentId').value = studentId;
            } else {
                alert('注册失败: ' + (data.error || JSON.stringify(data)));
            }
        } catch (err) {
            alert('网络错误，请稍后重试: ' + err.message);
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

    // ========== 🔑 登录业务内核（全量升级为凭证兑换流） ==========
    // ========== 🔑 登录业务内核（全面简化：不再自发请求 Appwrite，全权交由后端一条龙搞定） ==========
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessages();

        const studentId = loginStudentId.value.trim();
        const password = loginPassword.value;

        if (!studentId) { showError('请输入学号'); return; }
        if (!isValidStudentId(studentId)) { showError('学号格式不正确'); return; }
        if (!password) { showError('请输入密码'); return; }

        loginBtn.classList.add('loading');
        loginBtn.textContent = '登录中...';

        try {
            // 只请求同源 Cloudflare Pages Function，避免跨域登录状态分裂
            const response = await fetch(`${API_BASE}/auth-jwt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, password })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || '登录验证未通过');
            }

            

            // 旧版曾把备份解密密钥下发到浏览器；D1 版已彻底移除该行为。
            if (typeof localforage !== 'undefined') {
                try { await localforage.removeItem('secure_gate_key'); } catch {}
            }

            // 本地只缓存公开资料和短期应用令牌；Appwrite 会话密钥保存在 HttpOnly Cookie。
            localStorage.setItem('campus_user', JSON.stringify({
                userId: result.userId,
                studentId: result.studentId,
                name: result.name, 
                avatar: result.avatar || '',
                appToken: result.appToken || '',
                authVersion: 2,
                loginTime: Date.now()
            }));

            showSuccess('登录成功！正在跳转大厅...');
            setTimeout(() => {
                window.location.href = 'posts.html'; // 🚀 丝滑跳入帖子流大厅
            }, 800);

        } catch (err) {
            console.error("💥 登录链路捕获异常:", err);
            showError(err.message || '网络安全认证未通过');
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

        if (!studentId) { showError('请输入学号'); return; }
        if (!password) { showError('请输入密码'); return; }
        if (password.length < 8) { showError('密码至少8位'); return; }
        if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
            showError('密码必须包含字母和数字');
            return;
        }
        if (password !== confirmPassword) { showError('两次密码不一致'); return; }

        const pendingData = { studentId, password };
        pendingRegistration = pendingData;
        
        await fetchAndShowVerification((verificationToken) => {
            doRegister(pendingData.studentId, pendingData.password, verificationToken);
        });
    });

    // 快捷监听
    loginStudentId.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginPassword.focus();
    });
    loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginForm.dispatchEvent(new Event('submit'));
    });

})();
