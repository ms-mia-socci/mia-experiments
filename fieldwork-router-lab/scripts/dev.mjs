import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
const local = resolve(root, ".local");
const home = resolve(local, "home");
mkdirSync(home, { recursive: true, mode: 0o700 });
const keys = parseEnv(readFileSync(resolve(root, "../.env"), "utf8"));
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      !name.startsWith("AWS_") &&
      !name.startsWith("ANTHROPIC_") &&
      !name.startsWith("OPENAI_") &&
      !name.startsWith("CLAUDE_") &&
      !name.startsWith("CODEX_"),
  ),
);
const env = {
  ...inherited,
  HOME: home,
  ANTHROPIC_API_KEY: keys.ANTHROPIC_API_KEY || "",
  OPENAI_API_KEY: keys.OPENAI_API_KEY || "",
  OPENAI_API_ENDPOINT: keys.OPENAI_API_ENDPOINT || "",
  FIELDWORK_DB: resolve(local, "fieldwork.sqlite"),
  FIELDWORK_WORKSPACES: resolve(local, "workspaces"),
  FIELDWORK_BROWSER_EXECUTABLE: chromium.executablePath(),
  AWS_EC2_METADATA_DISABLED: "true",
  AWS_CONFIG_FILE: resolve(local, "empty-aws"),
  AWS_SHARED_CREDENTIALS_FILE: resolve(local, "empty-aws"),
};
writeFileSync(env.AWS_CONFIG_FILE, "", { mode: 0o600 });
const port = process.env.FIELDWORK_PORT || "5373";
const child = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--strictPort",
  ],
  { cwd: root, env, stdio: "inherit", detached: true },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  setTimeout(() => process.exit(), 500);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  if (!stopping) process.exit(code || 0);
});
console.log(
  `Fieldwork router lab: http://127.0.0.1:${port}\nStrands + Claude: ${keys.ANTHROPIC_API_KEY ? "configured" : "needs key"}; Codex: ${keys.OPENAI_API_KEY ? "configured" : "awaiting OpenAI API key"}\nLocal execution; no AWS deployment.`,
);
