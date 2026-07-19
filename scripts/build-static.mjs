import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const output = path.join(root, 'dist');

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

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (/\.html?$/i.test(entry.name) || /\.apk$/i.test(entry.name) || /^_headers$|^_redirects$/.test(entry.name) || /^[a-f0-9]{32}\.txt$/i.test(entry.name)) {
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
