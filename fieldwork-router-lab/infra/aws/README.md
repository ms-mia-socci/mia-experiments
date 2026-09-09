# Fieldwork on AWS

This deploys **fieldwork-router-lab**, not either sibling experiment. Terraform is pinned to AWS profile `medplum`, account **229015218172**, region **us-east-1**. `allowed_account_ids` rejects credentials for any other account. Both directories have their own ignored local state; never copy state from the earlier POC or `infra/memory`.

## Architecture

- CloudFront provides the HTTPS app URL; caching is disabled for authenticated responses and AG-UI streams.
- An ALB accepts only CloudFront origin traffic with a generated origin header. ECS Fargate serves the SvelteKit app on port 8080.
- Cognito provides invite-only sign-in. `openid-client` implements OIDC authorization code + PKCE, state, nonce and ID-token validation. Cloud mode disables demo identities. Sessions use secure HttpOnly cookies and expire after one hour; logout invalidates the app session.
- The web task invokes AgentCore Runtime through IAM/SigV4. A stable runtime session ID groups all turns in one conversation, while each turn keeps its own run ID and distributed trace. The runtime exposes `/invocations`, `/ping` and the internal Codex MCP bridge, and runs the same Strands, Claude and Codex adapters as local development. Its protocol configuration is `AGUI`.
- Private RDS PostgreSQL stores conversations, run claims, approvals, settings and events. Local development uses SQLite behind the same asynchronous repository. Transactions enforce ownership and prevent concurrent run starts. Runtime callbacks check shared cancellation state, so approval and cancellation work across processes.
- Private S3 stores uploaded files and generated artifacts. Only selected images are materialized in a runtime workspace for Codex. Model credentials are loaded only by the agent container from Secrets Manager.
- AgentCore Memory provides opt-in preference and summary extraction. The built-in AgentCore Code Interpreter runs explicitly approved Python and is stopped after each call.
- CloudWatch Transaction Search, X-Ray trace delivery and a 1% indexing rule expose Runtime and content-free Fieldwork spans. The Runtime role has the documented X-Ray, CloudWatch metric and log-policy permissions. Trace headers continue into Code Interpreter calls.

The agent runs in private subnets with a NAT gateway for provider APIs. PostgreSQL accepts traffic only from the web and agent security groups; its connection verifies the RDS TLS certificate. Neither the database nor the agent has a public inbound security-group rule.

## Deploy

Requires AWS CLI credentials for `medplum`, Terraform 1.10+, Docker with ARM64 builds, and the parent `.env` containing `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `OPENAI_API_ENDPOINT`.

```sh
cd fieldwork-router-lab
npm ci
npm run check
npm test
node scripts/deploy-aws.mjs
```

The script checks account identity, plans and applies `bootstrap` (ECR repositories and secret metadata), writes provider secret values through stdin outside Terraform, builds/pushes an immutable image tag, then plans/applies `stack`. The stack resolves image digests. Plans involving resource deletion/replacement are rejected, except replacing Fieldwork’s ECS task definition with a new revision during an image update.

Terraform state and plans can contain sensitive infrastructure values such as the CloudFront origin header. They are gitignored and must remain private. Provider API keys do not appear in Terraform variables, state, image layers or command arguments. `.local/aws-deployment.json` contains deployment outputs; `.local/aws-image-tag` records the last built tag for resuming a failed apply.

To inspect or resume after a provisioning failure, use the saved plan only if it is still current; otherwise plan again with the recorded image tag:

```sh
terraform -chdir=infra/aws/stack plan -var="image_tag=$(cat .local/aws-image-tag)" -out=deployment.tfplan
terraform -chdir=infra/aws/stack apply deployment.tfplan
```

## Local development

`npm run dev` still serves the same UI on port 5373 with demo identities, SQLite and local files. No cloud web/database resources are required. Set `FIELDWORK_AWS_PROFILE=medplum` for Code Interpreter and supply `FIELDWORK_MEMORY_ID` to use the deployed Memory resource locally. The local and cloud conversation databases and identities are separate; no existing local conversations or uploaded files are migrated.

For repository tests against a disposable local PostgreSQL database, set `FIELDWORK_DATABASE_URL` and run `tests/database.test.ts` with the normal test runner. Cloud startup rejects this development URL mode and requires the managed database secret plus TLS.

## Observability

Open the app's Activity panel after an AWS run to copy its trace ID or follow the CloudWatch link. Transaction Search may take roughly ten minutes to populate after initial enablement. The stack directs spans to the Runtime's unified log group when AgentCore supports it; otherwise AWS uses the shared `aws/spans` group.

The agent container loads AWS Distro for OpenTelemetry before the application. Fieldwork's own spans do not record prompt, response, memory, file or tool payloads; automatic generative-AI message capture is disabled and automatic instrumentation is limited to HTTP and AWS SDK calls. Terraform sets 30-day retention on the ECS web and AgentCore Runtime log groups; the shared `aws/spans` group also retains traces for 30 days. This does not change AWS service-provided application-log behavior, so review access and any payload-bearing log delivery before regulated use.

## POC limits and costs

This is a working deployment target, not a production compliance certification. Provider model calls still use the configured Anthropic/OpenAI APIs; placing the runtime in AWS does not change their data-processing terms.

The POC uses one web task, a single-AZ PostgreSQL instance and one NAT gateway. These incur ongoing charges while provisioned. CloudFront, S3, Secrets Manager, Memory, Code Interpreter and Runtime add usage charges. The dedicated database uses its managed administrative credential for initial schema creation and access; separate migration/application database roles are production follow-up work.

Runs are bounded to 210 seconds and require a live worker. Shared state supports refresh and cancellation but does not provide durable provider checkpoint/resume. A worker crash recovers as an expired run with saved partial output. Stored conversation lists still use generic JSON records and need pagination/indexing for scale. State/expired session cleanup, retention, backups/restore drills, WAF, alarms and centralized organization policies are follow-up work.

Database deletion protection and final snapshots are enabled. S3 buckets are not force-deleted. Destructive teardown is intentionally a separate reviewed operation. Do not remove protection or delete state simply to make a deployment succeed.

References: [AgentCore AG-UI contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui-protocol-contract.html), [AgentCore VPC configuration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-vpc.html), [openid-client](https://github.com/panva/openid-client), [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).
