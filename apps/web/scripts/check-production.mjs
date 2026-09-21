import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const directory = new URL("../dist/assets/", import.meta.url);
for (const file of await readdir(directory)) {
  if (!file.endsWith(".js")) continue;
  const code = await readFile(new URL(file, directory), "utf8");
  for (const marker of [
    "专利技术交底",
    "fixture-adapter",
    "演示请求失败",
    "本周较满",
    "林同学已接受前期成果整理",
    "文献依据清单.md",
  ]) {
    if (code.includes(marker))
      throw new Error(`Production contains fixture marker: ${marker}`);
  }
}
let rejected = false;
try {
  execFileSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build", "--mode", "demo"],
    { stdio: "pipe" },
  );
} catch (error) {
  rejected = String(error.stderr).includes("Demo is development-only");
}
if (!rejected)
  throw new Error("Demo build was not rejected by the production guard");
console.log("Production excludes fixtures; explicit demo build rejected.");
