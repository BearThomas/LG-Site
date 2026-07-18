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
        return `<video src="${href}" controls playsinline style="max-width: 100%; max-height: 500px; border-radius: 8px; margin: 10px 0;"></video>`;
    }
    return `<img src="${href}" alt="${text}" title="${title}" style="max-width: 100%; border-radius: 8px; margin: 10px 0;" />`;
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
