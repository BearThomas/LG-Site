import { marked } from 'https://cdn.jsdelivr.net/npm/marked@15.0.12/+esm';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.2.5/+esm';

marked.setOptions({
    gfm: true,
    breaks: true
});

export function renderMarkdown(markdown) {
    const raw = marked.parse(String(markdown || ''));

    return DOMPurify.sanitize(raw, {
        USE_PROFILES: { html: true },
        ALLOWED_TAGS: [
            'p', 'br', 'strong', 'em', 'del', 'blockquote',
            'ul', 'ol', 'li',
            'h1', 'h2', 'h3', 'h4',
            'code', 'pre',
            'a',
            'hr',
            'table', 'thead', 'tbody', 'tr', 'th', 'td'
        ],
        ALLOWED_ATTR: ['href', 'title', 'target', 'rel']
    });
}

export function markdownToPreview(markdown, maxLength = 150) {
    const raw = String(markdown || '');

    const withoutCodeBlock = raw.replace(/```[\s\S]*?```/g, ' ');
    const withoutInlineCode = withoutCodeBlock.replace(/`([^`]+)`/g, '$1');

    const plain = withoutInlineCode
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/[*_~>#-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return plain.length > maxLength
        ? `${plain.slice(0, maxLength)}...`
        : plain;
}