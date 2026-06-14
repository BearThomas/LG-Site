function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

function getConfig(env) {
    return {
        endpoint: clean(env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1'),
        projectId: clean(env.APPWRITE_PROJECT_ID || env.APPWRITE_PROJECT || 'lg'),
        apiKey: clean(env.APPWRITE_API_KEY),
        databaseId: clean(env.APPWRITE_DATABASE_ID || env.DATABASE_ID || 'lg'),
        collectionBoards: clean(env.APPWRITE_COLLECTION_BOARDS || 'boards'),
        collectionUsers: clean(env.APPWRITE_COLLECTION_USERS || 'users')
    };
}

function appwriteHeaders(config) {
    return {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': config.projectId,
        'X-Appwrite-Key': config.apiKey
    };
}

async function appwriteFetch(config, path, options = {}) {
    const response = await fetch(`${config.endpoint}${path}`, {
        ...options,
        headers: {
            ...appwriteHeaders(config),
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { raw: text };
        }
    }

    if (!response.ok) {
        const error = new Error(data.message || data.error || `Appwrite 请求失败：${response.status}`);
        error.status = response.status;
        error.code = data.code || response.status;
        error.data = data;
        throw error;
    }

    return data;
}

function isValidStudentId(studentId) {
    if (!/^\d{6,8}$/.test(studentId)) return false;

    const year = parseInt(studentId.slice(0, 4), 10);
    const classNum = parseInt(studentId.slice(4, 6), 10);
    const studentNum = parseInt(studentId.slice(6), 10);
    const currentYear = new Date().getFullYear();

    if (year < 2020 || year > currentYear) return false;
    if (classNum < 1 || classNum > 8) return false;
    if (studentNum < 1 || studentNum > 60) return false;

    return true;
}

function extractClass(studentId) {
    const year = studentId.slice(0, 4);
    const classNum = studentId.slice(4, 6);
    return `${year}届${classNum}班`;
}

async function getDocument(config, collectionId, documentId) {
    return appwriteFetch(
        config,
        `/databases/${config.databaseId}/collections/${collectionId}/documents/${documentId}`,
        { method: 'GET' }
    );
}

async function createDocument(config, collectionId, documentId, data, permissions = []) {
    return appwriteFetch(
        config,
        `/databases/${config.databaseId}/collections/${collectionId}/documents`,
        {
            method: 'POST',
            body: JSON.stringify({
                documentId,
                data,
                permissions
            })
        }
    );
}

async function updateDocument(config, collectionId, documentId, data) {
    return appwriteFetch(
        config,
        `/databases/${config.databaseId}/collections/${collectionId}/documents/${documentId}`,
        {
            method: 'PATCH',
            body: JSON.stringify({ data })
        }
    );
}

async function createAuthUser(config, studentId, password, displayName) {
    return appwriteFetch(config, '/users', {
        method: 'POST',
        body: JSON.stringify({
            userId: studentId,
            email: `${studentId}@campus.local`,
            password,
            name: displayName
        })
    });
}

export async function onRequestPost({ request, env }) {
    try {
        const config = getConfig(env);
        const { studentId, password, name } = await request.json();

        if (!studentId || !password) {
            return Response.json({ error: '学号和密码不能为空' }, { status: 400 });
        }

        if (password.length < 8) {
            return Response.json({ error: '密码至少8位' }, { status: 400 });
        }

        if (!isValidStudentId(studentId)) {
            return Response.json({ error: '学号格式不正确' }, { status: 400 });
        }

        if (!config.apiKey) {
            return Response.json({ error: 'APPWRITE_API_KEY 未配置' }, { status: 500 });
        }

        try {
            await getDocument(config, config.collectionUsers, studentId);

            return Response.json(
                { error: '该学号已注册' },
                { status: 409 }
            );
        } catch (error) {
            if (error.status !== 404 && error.code !== 404) {
                console.error('检查用户存在时出错:', error);
            }
        }

        const displayName = name || `同学${studentId.slice(-4)}`;
        let authUser;

        try {
            authUser = await createAuthUser(config, studentId, password, displayName);
            console.log('Appwrite Auth 账号创建成功:', authUser.$id);
        } catch (error) {
            if (error.status === 409 || error.code === 409) {
                return Response.json(
                    { error: '该学号已注册' },
                    { status: 409 }
                );
            }

            throw error;
        }

        const userClass = extractClass(studentId);
        const defaultPermissions = 31;

        await createDocument(
            config,
            config.collectionUsers,
            studentId,
            {
                userId: studentId,
                name: displayName,
                avatar: null,
                email: `${studentId}@campus.local`,
                role: 'normal',
                permissions: defaultPermissions,
                joinedBoards: ['main'],
                ownedBoards: [],
                class: userClass,
                mutedUntil: null,
                banned: false
            },
            [
                `read("user:${studentId}")`,
                `update("user:${studentId}")`,
                `delete("user:${studentId}")`,
                'read("team:admin")',
                'write("team:admin")'
            ]
        );

        const classBoardId = `class_${studentId.slice(0, 4)}_${studentId.slice(4, 6)}`;

        try {
            const classBoard = await getDocument(config, config.collectionBoards, classBoardId);

            await updateDocument(config, config.collectionBoards, classBoardId, {
                memberCount: Number(classBoard.memberCount || 0) + 1
            });

            await updateDocument(config, config.collectionUsers, studentId, {
                joinedBoards: ['main', classBoardId]
            });

            console.log(`账号已自动编入班级板块: ${classBoardId}`);
        } catch (error) {
            console.log('班级板块未预设，跳过自动编入逻辑:', classBoardId);
        }

        return Response.json({
            success: true,
            message: '注册成功',
            userId: authUser.$id || studentId,
            class: userClass
        });
    } catch (error) {
        console.error('Register 云函数错误:', error);

        return Response.json(
            { error: '注册失败，请稍后重试: ' + (error.message || '未知错误') },
            { status: 500 }
        );
    }
}

export async function onRequestGet() {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
}