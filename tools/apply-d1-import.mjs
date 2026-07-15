#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; }
const database = option("--database", process.env.D1_DATABASE_NAME || "lg-site-db");
const remote = args.includes("--local") ? "--local" : "--remote";
const files = ["migrations/0001_d1_compat.sql", ...fs.readdirSync("migration/generated").filter((x) => /^\d{3}-documents\.sql$/.test(x)).sort().map((x) => path.join("migration/generated", x))];
for (const file of files) {
  console.log(`\n==> 导入 ${file}`);
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["wrangler", "d1", "execute", database, remote, "--file", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("\nD1 架构和备份数据导入完成。再次运行也是安全的。" );
