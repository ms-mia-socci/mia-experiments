import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const cwd = fileURLToPath(new URL("../infra/memory", import.meta.url));
for (const args of [
  ["init", "-input=false"],
  ["plan", "-input=false", "-out=memory.tfplan"],
  ["apply", "-input=false", "memory.tfplan"],
]) {
  const r = spawnSync("terraform", args, { cwd, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
const r = spawnSync("terraform", ["output", "-raw", "memory_id"], {
  cwd,
  encoding: "utf8",
});
if (r.status !== 0) process.exit(r.status || 1);
mkdirSync(`${root}/.local`, { recursive: true });
writeFileSync(
  `${root}/.local/memory.json`,
  JSON.stringify({ memoryId: r.stdout.trim() }),
  { mode: 0o600 },
);
console.log(
  "Memory configured. Restart npm run dev; each person can opt in at /settings.",
);
