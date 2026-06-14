import { escapeHtml } from './shared.js';

const DOC_ROOT = './doc/';

const treeEl = document.getElementById('docsTree');
const articleEl = document.getElementById('docsArticle');
const breadcrumbEl = document.getElementById('docsBreadcrumb');
const pagerEl = document.getElementById('docsPager');
const searchEl = document.getElementById('docsSearch');

let manifest = null;
let currentPath = '';

function docHash(path) {
    return `#/${encodeURI(path)}`;
}

function pathFromHash() {
    return decodeURIComponent(window.location.hash.replace(/^#\/?/, '').trim());
}

function defaultPage() {
    return manifest.pages.find(page => page.path === 'index.md') || manifest.pages[0];
}

function pageByPath(path) {
    return manifest.pages.find(page => page.path === path);
}

function pageMatches(page, keyword) {
    if (!keyword) return true;
    const haystack = `${page.title} ${page.path}`.toLowerCase();
    return haystack.includes(keyword.toLowerCase());
}

function folderHasMatch(node, keyword) {
    if (!keyword) return true;
    return node.children.some(child => {
        if (child.type === 'page') return pageMatches(child, keyword);
        return folderHasMatch(child, keyword);
    });
}

function renderTreeNode(node, keyword = '') {
    if (node.type === 'page') {
        if (!pageMatches(node, keyword)) return '';
        const active = node.path === currentPath ? ' class="active"' : '';
        return `<li><a${active} href="${docHash(node.path)}">${escapeHtml(node.title)}</a></li>`;
    }

    const children = node.children.map(child => renderTreeNode(child, keyword)).filter(Boolean);
    if (!children.length || !folderHasMatch(node, keyword)) return '';

    const title = node.name ? `<div class="docs-folder-title">${escapeHtml(node.title)}</div>` : '';
    const nestedClass = node.name ? ' class="nested"' : '';
    return `${title}<ul${nestedClass}>${children.join('')}</ul>`;
}

function renderTree() {
    const keyword = searchEl?.value.trim() || '';
    const html = renderTreeNode(manifest.tree, keyword);
    treeEl.innerHTML = html || '<div class="docs-empty">没有匹配的文档</div>';
}

function stripFrontMatter(markdown) {
    return markdown.replace(/^---[\s\S]*?\n---\s*/, '');
}

function resolveDocUrl(url) {
    if (/^(https?:|mailto:|#|\/)/i.test(url)) return url;

    const baseParts = currentPath.split('/');
    baseParts.pop();
    const base = baseParts.length ? `${baseParts.join('/')}/` : '';
    return `${DOC_ROOT}${base}${url}`;
}

function safeUrl(url) {
    const trimmed = url.trim();
    if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(trimmed)) return trimmed;
    if (!trimmed.includes(':')) return trimmed;
    return '#';
}

function renderInline(text) {
    let html = escapeHtml(text);

    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
        const src = safeUrl(resolveDocUrl(url));
        return `<img src="${escapeHtml(src)}" alt="${alt}">`;
    });

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
        const href = safeUrl(resolveDocUrl(url));
        return `<a href="${escapeHtml(href)}">${label}</a>`;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    return html;
}

function renderMarkdown(markdown) {
    const lines = stripFrontMatter(markdown).split(/\r?\n/);
    const output = [];
    let paragraph = [];
    let listType = null;
    let inCode = false;
    let codeLines = [];
    let codeLang = '';

    const flushParagraph = () => {
        if (!paragraph.length) return;
        output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
        paragraph = [];
    };

    const closeList = () => {
        if (!listType) return;
        output.push(`</${listType}>`);
        listType = null;
    };

    const openList = (type) => {
        if (listType === type) return;
        closeList();
        listType = type;
        output.push(`<${type}>`);
    };

    for (const line of lines) {
        const codeFence = line.match(/^```(\w*)\s*$/);
        if (codeFence) {
            if (inCode) {
                output.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
                inCode = false;
                codeLines = [];
                codeLang = '';
            } else {
                flushParagraph();
                closeList();
                inCode = true;
                codeLang = codeFence[1] || '';
            }
            continue;
        }

        if (inCode) {
            codeLines.push(line);
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            closeList();
            continue;
        }

        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            closeList();
            const level = heading[1].length;
            output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
            continue;
        }

        const unordered = line.match(/^\s*[-*]\s+(.+)$/);
        if (unordered) {
            flushParagraph();
            openList('ul');
            output.push(`<li>${renderInline(unordered[1])}</li>`);
            continue;
        }

        const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
        if (ordered) {
            flushParagraph();
            openList('ol');
            output.push(`<li>${renderInline(ordered[1])}</li>`);
            continue;
        }

        const quote = line.match(/^>\s+(.+)$/);
        if (quote) {
            flushParagraph();
            closeList();
            output.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
            continue;
        }

        paragraph.push(line.trim());
    }

    if (inCode) {
        output.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    }
    flushParagraph();
    closeList();

    return output.join('\n');
}

function renderBreadcrumb(page) {
    const segments = page.path.split('/');
    segments.pop();
    const folderTrail = segments.map(segment => segment.replace(/^\d+[-_.\s]*/, '')).join(' / ');
    breadcrumbEl.textContent = folderTrail ? `帮助文档 / ${folderTrail} / ${page.title}` : `帮助文档 / ${page.title}`;
}

function renderPager(page) {
    const index = manifest.pages.findIndex(item => item.path === page.path);
    const prev = manifest.pages[index - 1];
    const next = manifest.pages[index + 1];

    pagerEl.innerHTML = `
        <div>${prev ? `<a href="${docHash(prev.path)}">← ${escapeHtml(prev.title)}</a>` : ''}</div>
        <div>${next ? `<a href="${docHash(next.path)}">${escapeHtml(next.title)} →</a>` : ''}</div>
    `;
}

async function loadPage(path) {
    const page = pageByPath(path) || defaultPage();
    if (!page) {
        articleEl.innerHTML = '<div class="docs-error">还没有文档。请在 doc/ 文件夹里添加 Markdown 文件。</div>';
        return;
    }

    currentPath = page.path;
    if (path !== currentPath) {
        window.history.replaceState(null, '', docHash(currentPath));
    }

    articleEl.innerHTML = '<div class="docs-loading">加载中...</div>';

    try {
        const response = await fetch(`${DOC_ROOT}${page.path}`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const markdown = await response.text();
        articleEl.innerHTML = renderMarkdown(markdown);
        document.title = `龙高北小站 | ${page.title}`;
        renderBreadcrumb(page);
        renderPager(page);
        renderTree();
    } catch (error) {
        articleEl.innerHTML = '<div class="docs-error">文档加载失败，请检查文件是否存在。</div>';
    }
}

async function initDocs() {
    try {
        const response = await fetch(`${DOC_ROOT}manifest.json`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        manifest = await response.json();
        renderTree();
        await loadPage(pathFromHash());
    } catch (error) {
        articleEl.innerHTML = '<div class="docs-error">文档目录加载失败。请先运行 npm run docs:manifest。</div>';
        treeEl.innerHTML = '<div class="docs-empty">没有目录</div>';
    }
}

window.addEventListener('hashchange', () => {
    if (manifest) loadPage(pathFromHash());
});

searchEl?.addEventListener('input', renderTree);

initDocs();
