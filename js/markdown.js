import { marked } from 'https://cdn.jsdelivr.net/npm/marked@15.0.12/+esm';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.2.5/+esm';

marked.setOptions({
    gfm: true,
    breaks: true
});

const renderer = new marked.Renderer();

renderer.image = function(token) {
    const href = token.href || '';
    const title = token.title || '';
    const text = token.text || '';
    const isVideo = /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(href);
    if (isVideo) {
        return `<span class="feed-image-container" style="display: block; text-align: center; padding: 12px 0; width: 100%;"><video src="${href}" controls playsinline style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: var(--shadow-sm); background: var(--surface-2);"></video></span>`;
    }
    return `<span class="feed-image-container" style="display: block; text-align: center; padding: 12px 0; width: 100%;"><img src="${href}" alt="${text}" title="${title}" onclick="if(window.previewImage){window.previewImage('${href}'); event.stopPropagation();}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: var(--shadow-sm); cursor: zoom-in; background: var(--surface-2);" /></span>`;
};

renderer.link = function(token) {
    const href = token.href || '';
    const text = token.text || '';
    const isImage = /\.(png|jpe?g|gif|webp|bmp)(\?.*)?$/i.test(href);
    
    // 如果它是一个纯链接且指向图片
    if (isImage && text === href) {
        return `<span class="feed-image-container" style="display: block; text-align: center; padding: 12px 0; width: 100%;"><img src="${href}" alt="图片" onclick="if(window.previewImage){window.previewImage('${href}'); event.stopPropagation();}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: var(--shadow-sm); cursor: zoom-in; background: var(--surface-2);" /></span>`;
    }
    
    // 默认的 link 渲染
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};
marked.use({ renderer });

const sanitizeConfig = {
    ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'del', 'blockquote',
        'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4',
        'code', 'pre',
        'a',
        'hr',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'img', 'video', 'source'
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'controls', 'playsinline', 'style', 'class']
};

export function renderMarkdown(markdown = '') {
    const raw = marked.parse(String(markdown || ''));
    return DOMPurify.sanitize(raw, sanitizeConfig);
}

export function markdownToPreview(markdown, maxLength = 150) {
    const cleaned = String(markdown || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/~~~[\s\S]*?~~~/g, ' ')
        .replace(/`([^`]+)`/g, '$1');

    const safeHtml = renderMarkdown(cleaned);
    const plain = htmlToText(safeHtml)
        .replace(/\s+/g, ' ')
        .trim();

    const chars = Array.from(plain);
    return chars.length > maxLength
        ? `${chars.slice(0, maxLength).join('').trim()}...`
        : plain;
}

function htmlToText(html) {
    if (typeof DOMParser === 'undefined') {
        return String(html || '').replace(/<[^>]*>/g, ' ');
    }

    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return doc.body.textContent || '';
}
