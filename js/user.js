import { Client, Databases, Query } from './d1-appwrite-compat.js';
import { renderMarkdown } from './markdown.js';
import { formatNameWithYear, getPostAuthorDisplay, APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, DATABASE_ID, COLLECTION_USERS, COLLECTION_POSTS } from './shared.js';

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);

const urlParams = new URLSearchParams(window.location.search);
const targetUserId = urlParams.get('id');

const tabUserPosts = document.getElementById('tabMyPosts');
const tabUserComments = document.getElementById('tabMyComments');
const userPostsList = document.getElementById('myPostsList');
const userCommentsList = document.getElementById('myCommentsList');
const avatarPreview = document.getElementById('avatarPreview');
const avatarText = document.getElementById('avatarText');
const avatarImg = document.getElementById('avatarImg');
const profileUsername = document.getElementById('profileUsername');
const profileUserId = document.getElementById('profileUserId');

let userDoc = null;
let userCache = {}; // Minimal cache for the target user

function updateAvatarPreview(name, url) {
    if (url && (url.startsWith('http') || url.startsWith('/') || url.startsWith('data:'))) {
        avatarImg.src = url;
        avatarImg.onerror = () => {
            avatarImg.style.display = 'none';
            avatarText.style.display = 'block';
            avatarText.textContent = (name || '?').charAt(0);
        };
        avatarImg.style.display = 'block';
        avatarText.style.display = 'none';
    } else {
        avatarImg.style.display = 'none';
        avatarText.style.display = 'block';
        avatarText.textContent = (name || '?').charAt(0);
    }
}

async function loadUserInfo() {
    if (!targetUserId) {
        profileUsername.textContent = '未指定用�?;
        return;
    }
    
    // Hide comments tab for now since comments don't always track user well without index
    tabUserComments.style.display = 'none';

    try {
        let userResult = null;
        let finalName = '';
        let sid = targetUserId.replace(/^student_/, '').trim();
        
        try {
            userResult = await databases.getDocument(DATABASE_ID, COLLECTION_USERS, targetUserId);
        } catch(e) {
            console.log('Direct ID fallback');
        }

        if (userResult) {
            sid = (userResult.studentId || sid).replace(/^student_/, '').trim();
            finalName = window.escapeHtml ? window.escapeHtml(userResult.name || '未设置名�?) : userResult.name || '未设置名�?;
            if (sid.length >= 4) finalName = `${finalName}<span class="year-badge">${sid.substring(0, 4)}�?/span>`;
            
            profileUsername.innerHTML = finalName;
            profileUserId.style.display = 'none'; // Don't show ID
            updateAvatarPreview(userResult.name, userResult.avatar);
            
            userCache[targetUserId] = {
                name: userResult.name,
                avatar: userResult.avatar
            };
            userCache[sid] = userCache[targetUserId];
        } else {
            // User not found in DB, fallback
            finalName = window.escapeHtml ? window.escapeHtml(`同学${sid.slice(-4)}`) : `同学${sid.slice(-4)}`;
            if (sid.length >= 4) finalName = `${finalName}<span class="year-badge">${sid.substring(0, 4)}�?/span>`;
            profileUsername.innerHTML = finalName;
            profileUserId.style.display = 'none';
            updateAvatarPreview(`同学${sid.slice(-4)}`, '');
        }
        
        loadUserPosts(targetUserId, sid);
    } catch (error) {
        console.error('加载用户信息失败:', error);
        profileUsername.textContent = '加载失败或用户不存在';
    }
}

async function loadUserPosts(rawId, cleanSid) {
    try {
        const queries = [
            Query.orderDesc('createdAt'),
            Query.limit(50)
        ];
        // The DB might store rawId or cleanSid as authorId
        
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, queries);
        
        // Filter locally due to potential multi-format IDs
        const posts = response.documents.filter(p => {
            const author = (p.authorId || '').replace(/^student_/, '').trim();
            return author === cleanSid;
        });

        if (posts.length === 0) {
            userPostsList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">该用户暂未发布任何帖�?/div>';
            return;
        }

        userPostsList.innerHTML = '';
        posts.forEach(post => {
            const author = getPostAuthorDisplay(post, userCache);
            
            const div = document.createElement('div');
            div.className = 'activity-item';
            div.style.cssText = 'padding: 16px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: background 0.2s;';
            div.onmouseover = () => div.style.background = 'var(--surface-2)';
            div.onmouseout = () => div.style.background = 'transparent';
            div.onclick = () => window.location.href = `post-detail?id=${post.$id}`;

            const postTime = post.$createdAt || post.createdAt || post.created_at;
            const timeStr = new Date(postTime).toLocaleDateString('zh-CN', {
                month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            div.innerHTML = `
                <div style="font-weight: bold; font-size: 1.05rem; color: var(--text);">${window.escapeHtml ? window.escapeHtml(post.title) : post.title}</div>
                <div style="font-size: 0.9rem; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">
                    ${window.escapeHtml ? window.escapeHtml(post.content.replace(/<[^>]*>?/gm, '').substring(0, 100)) : post.content.substring(0, 100)}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                    <div>📅 ${timeStr}</div>
                    <div style="display: flex; gap: 12px;">
                        <span>💬 ${post.commentCount || 0}</span>
                        <span>👀 ${post.views || 0}</span>
                    </div>
                </div>
            `;
            userPostsList.appendChild(div);
        });

    } catch (error) {
        console.error('加载用户帖子失败:', error);
        userPostsList.innerHTML = '<div style="color: var(--danger); text-align: center; padding: 20px;">加载帖子失败，请重试</div>';
    }
}

document.addEventListener('DOMContentLoaded', loadUserInfo);
