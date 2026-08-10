import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const output = path.join(root, 'dist');

// Check if node_modules dependencies are installed; if not, auto-install
const aws4fetchPath = path.join(root, 'node_modules', 'aws4fetch');
if (!fs.existsSync(aws4fetchPath)) {
  console.log('⚠️ 检测到缺少必要依赖项 aws4fetch，正在自动运行 npm install...');
  const res = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    console.error('❌ 自动安装依赖失败，请先在当前目录下手动执行 npm install。');
    process.exit(1);
  }
}

const manifest = spawnSync(process.execPath, [path.join(scriptDir, 'generate-docs-manifest.js')], {
  cwd: root,
  stdio: 'inherit'
});
if (manifest.status !== 0) process.exit(manifest.status || 1);

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const directories = ['css', 'data', 'doc', 'image', 'js', 'public'];
for (const name of directories) {
  const source = path.join(root, name);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(output, name), { recursive: true });
}

// Copy public/ contents directly to dist root so /data-backups/... maps to dist/data-backups/...
const publicSource = path.join(root, 'public');
if (fs.existsSync(publicSource)) {
  fs.cpSync(publicSource, output, { recursive: true });
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (/\.(html?|json|js|apk)$/i.test(entry.name) || /^_headers$|^_redirects$|^sw\.js$|^manifest\.json$/.test(entry.name) || /^[a-f0-9]{32}\.txt$/i.test(entry.name)) {
    fs.copyFileSync(path.join(root, entry.name), path.join(output, entry.name));
  }
}

let files = 0;
const walk = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile()) files += 1;
  }
};
walk(output);
console.log(`Built dist/ with ${files} static files. Pages Functions remain in functions/.`);
