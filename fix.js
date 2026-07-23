const fs = require('fs');
const indexLines = fs.readFileSync('index.html', 'utf8').split('\n');
const postsLines = fs.readFileSync('posts.html', 'utf8').split('\n');
const modalLines = postsLines.slice(161, 360);
const newIndexLines = [...indexLines.slice(0, 79), ...modalLines, ...indexLines.slice(275)];
fs.writeFileSync('index.html', newIndexLines.join('\n'), 'utf8');
