const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOC_DIR = path.join(ROOT_DIR, 'doc');
const OUTPUT_FILE = path.join(DOC_DIR, 'manifest.json');

function toPosix(filePath) {
    return filePath.split(path.sep).join('/');
}

function stripPrefix(name) {
    return name.replace(/^\d+[-_.\s]*/, '');
}

function titleFromName(name) {
    return stripPrefix(name)
        .replace(/\.md$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
}

function orderFromName(name) {
    const match = name.match(/^(\d+)/);
    return match ? Number(match[1]) : 1000;
}

function readFrontMatter(content) {
    if (!content.startsWith('---')) return {};

    const end = content.indexOf('\n---', 3);
    if (end === -1) return {};

    const block = content.slice(3, end).trim();
    return block.split(/\r?\n/).reduce((data, line) => {
        const index = line.indexOf(':');
        if (index === -1) return data;

        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        data[key] = value;
        return data;
    }, {});
}

function firstHeading(content) {
    const body = content.replace(/^---[\s\S]*?\n---\s*/, '');
    const match = body.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '';
}

function walk(dir) {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) return walk(fullPath);
        if (!entry.isFile() || !entry.name.endsWith('.md')) return [];

        const relativePath = toPosix(path.relative(DOC_DIR, fullPath));
        const content = fs.readFileSync(fullPath, 'utf8');
        const frontMatter = readFrontMatter(content);

        return [{
            path: relativePath,
            title: frontMatter.title || firstHeading(content) || titleFromName(entry.name),
            order: frontMatter.order ? Number(frontMatter.order) : orderFromName(entry.name)
        }];
    });
}

function ensureFolder(root, segments) {
    let current = root;

    for (const segment of segments) {
        let folder = current.children.find(child => child.type === 'folder' && child.name === segment);
        if (!folder) {
            folder = {
                type: 'folder',
                name: segment,
                title: titleFromName(segment),
                order: orderFromName(segment),
                children: []
            };
            current.children.push(folder);
        }
        current = folder;
    }

    return current;
}

function sortTree(node) {
    node.children.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.title.localeCompare(b.title, 'zh-Hans-CN');
    });

    for (const child of node.children) {
        if (child.type === 'folder') sortTree(child);
    }
}

function buildTree(pages) {
    const root = {
        type: 'folder',
        name: '',
        title: '帮助文档',
        order: 0,
        children: []
    };

    for (const page of pages) {
        const segments = page.path.split('/');
        const fileName = segments.pop();
        const folder = ensureFolder(root, segments);

        folder.children.push({
            type: 'page',
            name: fileName,
            path: page.path,
            title: page.title,
            order: page.order
        });
    }

    sortTree(root);
    return root;
}

function main() {
    fs.mkdirSync(DOC_DIR, { recursive: true });

    const pages = walk(DOC_DIR).sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.path.localeCompare(b.path, 'zh-Hans-CN');
    });

    const manifest = {
        generatedAt: new Date().toISOString(),
        pages,
        tree: buildTree(pages)
    };

    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`Generated ${toPosix(path.relative(ROOT_DIR, OUTPUT_FILE))} with ${pages.length} page(s).`);
}

main();
