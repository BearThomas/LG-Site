#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const roots = ["functions","src","lib","public"].filter((x) => fs.existsSync(x));
const bad = [];
function walk(dir) { for (const e of fs.readdirSync(dir,{withFileTypes:true})) { if (["node_modules",".git","dist","build"].includes(e.name)) continue; const p=path.join(dir,e.name); if(e.isDirectory()) walk(p); else if(/\.(js|mjs|cjs|ts|tsx|jsx|html)$/i.test(e.name)) { const t=fs.readFileSync(p,"utf8"); if(t.includes("__MOVE_APPWRITE_API_KEY_TO_CONTEXT_ENV__")) bad.push(p); } } }
roots.forEach(walk);
if (bad.length) { console.error("以下文件仍有安全占位符，请接入 context.env.APPWRITE_API_KEY：\n"+bad.join("\n")); process.exit(1); }
console.log("未发现遗留的 API Key 安全占位符。" );
