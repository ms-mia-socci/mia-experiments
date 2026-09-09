import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const account = "229015218172",
  profile = "medplum",
  region = "us-east-1";
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.status !== 0)
    throw Error(
      `${command} failed (${result.status})${options.capture ? ": " + result.stderr : ""}`,
    );
  return result.stdout?.trim();
}
function aws(args, options = {}) {
  return run(
    "aws",
    [...args, "--profile", profile, "--region", region],
    options,
  );
}
function tf(folder, args, options = {}) {
  return run("terraform", [`-chdir=infra/aws/${folder}`, ...args], options);
}
if (
  JSON.parse(
    aws(["sts", "get-caller-identity", "--output", "json"], { capture: true }),
  ).Account !== account
)
  throw Error("Refusing unexpected AWS account");
function apply(folder, extra = []) {
  tf(folder, ["init", "-input=false"]);
  tf(folder, ["validate"]);
  tf(folder, ["plan", "-input=false", "-out=deployment.tfplan", ...extra]);
  const plan = JSON.parse(
    tf(folder, ["show", "-json", "deployment.tfplan"], { capture: true }),
  );
  if (
    plan.resource_changes?.some(
      (r) =>
        r.change.actions.includes("delete") &&
        r.address !== "aws_ecs_task_definition.web",
    )
  )
    throw Error(
      "Deployment includes deletion/replacement; inspect the saved plan manually.",
    );
  tf(folder, ["apply", "-input=false", "deployment.tfplan"]);
}
apply("bootstrap");
const outputs = JSON.parse(
  tf("bootstrap", ["output", "-json"], { capture: true }),
);
// Values never enter Terraform state, image layers, command arguments or stdout.
const env = parseEnv(readFileSync(`${root}/../.env`, "utf8"));
const keys = Object.fromEntries(
  ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENAI_API_ENDPOINT"].map((k) => {
    if (!env[k]) throw Error(`Missing ${k}`);
    return [k, env[k]];
  }),
);
aws(
  [
    "secretsmanager",
    "put-secret-value",
    "--secret-id",
    outputs.model_secret_arn.value,
    "--secret-string",
    "file:///dev/stdin",
    "--query",
    "ARN",
    "--output",
    "text",
  ],
  { capture: true, input: JSON.stringify(keys) },
);
const registry = `${account}.dkr.ecr.${region}.amazonaws.com`;
const password = aws(["ecr", "get-login-password"], { capture: true });
run("docker", ["login", "--username", "AWS", "--password-stdin", registry], {
  capture: true,
  input: password,
});
const tag = `poc-${Date.now()}`;
run("docker", [
  "build",
  "--platform",
  "linux/arm64",
  "--provenance=false",
  "-t",
  `fieldwork-router-lab:${tag}`,
  ".",
]);
for (const repository of Object.values(outputs.repositories.value)) {
  run("docker", ["tag", `fieldwork-router-lab:${tag}`, `${repository}:${tag}`]);
  run("docker", ["push", `${repository}:${tag}`]);
}
mkdirSync(`${root}/.local`, { recursive: true });
writeFileSync(`${root}/.local/aws-image-tag`, tag);
apply("stack", [`-var=image_tag=${tag}`]);
mkdirSync(`${root}/.local`, { recursive: true });
writeFileSync(
  `${root}/.local/aws-deployment.json`,
  tf("stack", ["output", "-json"], { capture: true }),
  { mode: 0o600 },
);
console.log("Medplum deployment outputs saved to .local/aws-deployment.json");
