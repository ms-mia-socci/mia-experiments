import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist/lambda", { recursive: true });

await build({
  entryPoints: ["src/handler.ts"],
  outfile: "dist/lambda/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  minify: false,
});
