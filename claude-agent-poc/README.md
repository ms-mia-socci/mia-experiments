# Claude Agent POC — Fieldwork

A SvelteKit workspace for a Claude Agent SDK running on AWS AgentCore Runtime, using AG-UI events and an Anthropic API key. Everything lives in this subfolder of `mia-experiments`.

## What this experiment proves

- Users sign in through Cognito (authorization code + PKCE).
- SvelteKit verifies the login and owns the mapping from user → conversation → AgentCore runtime session.
- The SDK runs in an ARM64 Linux container in AWS and calls Anthropic directly.
- The browser uses `@ag-ui/client` to consume standard message/tool events and application-specific approval/artifact events.
- The agent can read a sample shipping project, run a trusted test suite, and propose a configuration change.
- The backend waits for approval of the **exact proposed content**, with a 90-second expiration. Denial, cancellation, and expiration prevent the write.
- Approved changes, run event transcripts, and decision records are saved. Users can download a Git patch.

The first project is deliberately constrained to `sample/README.md` and `sample/shipping.json`. Managed tools handle these fixed paths; all Claude built-in tools are disabled. Tests parse the JSON with trusted server code. The POC does not execute agent-authored code or expose an arbitrary shell. Extending this into a general coding environment requires a separately designed execution sandbox and credential boundary.

## Layout

| Folder | Purpose |
| --- | --- |
| `web/` | SvelteKit, Cognito login, authorization, AG-UI streaming proxy, interface |
| `agent/` | Claude Agent SDK, AG-UI adapter, managed tools, approval and persistence logic |
| `infra/bootstrap/` | Terraform: ECR repositories and the empty secret container |
| `infra/` | Terraform: AgentCore, ECS, networking, CloudFront, Cognito, DynamoDB, S3, IAM, logs |
| `sample/` | Demo project copied separately for each conversation |
| `scripts/` | Deployment and account provisioning |
| `tests/` | Workspace regression tests and deployed smoke checks |
| `.local/` | Ignored local deployment output, screenshots, and temporary login credentials |

## Deployment

Requires Node.js 24+, Terraform 1.10+, Docker running, and an AWS CLI profile with permissions to provision this stack. The default profile is `ai`, in `us-east-1`.

Keep `ANTHROPIC_API_KEY` in the parent repository's `.env`. The deploy script reads it without printing it and writes the value directly to Secrets Manager using the AWS SDK. Terraform manages only the secret's metadata, so the Anthropic key does not enter Terraform state.

```sh
cd claude-agent-poc
npm ci
npm run deploy
```

The script checks the code and regression tests, applies the bootstrap Terraform, builds/pushes ARM64 images with immutable tags, then plans and applies the application Terraform. It writes `infra/deployment.auto.tfvars` (image tag) and `.local/deployment.json` (outputs). Both are ignored. For an explicit new image tag use `npm run deploy -- poc-unique-tag`; do not reuse an existing tag.

Terraform state is local and ignored in both Terraform folders for this single-operator POC. Preserve it for updates and teardown. Move to an access-controlled remote backend before multiple people deploy this stack. Commit both provider lock files and `package-lock.json`.

Provision test accounts without sending email:

```sh
node scripts/create-users.mjs tim.ritzema@121.health mia.socci@121.health
```

Temporary passwords are saved to `.local/logins.json` with mode `0600`. Users must change their password on first login. Existing accounts are left untouched. Sign-in sessions expire after an hour; sign in again to continue. Production SSO and refresh-token sessions are follow-up work.

## Demo

1. Open the deployed URL and sign in.
2. Select **Find and fix the shipping bug**.
3. Watch the agent inspect the project and discover failing tests for $50 and $75 orders.
4. Review the proposed `shipping.json` change and choose **Approve change**.
5. Confirm that the tests pass and download the patch from **Changes**.
6. Repeat in a new conversation and choose **Deny**. Confirm the original file remains unchanged.
7. Sign in as a second user: conversations and workspaces are separate.

You can reload during a run. The page polls for status and pending approval; the saved response becomes available when the run ends. Live text already streamed is not replayed during an in-progress reconnect. A dropped browser connection does not itself cancel work; use **Stop** to request cancellation.

## State and controls

- A DynamoDB ownership record is checked before every thread, run, approval, cancellation, and download request. The browser cannot select the AWS runtime session or supply its own model configuration/tools.
- Mutating app endpoints require a same-origin request. The login cookie is HttpOnly, Secure in AWS, and SameSite=Lax; ID tokens are verified against Cognito's issuer, audience, and signing keys.
- One active run is allowed per conversation, with a five-minute lease; agent execution times out after four minutes. Each conversation permits 30 runs. SDK runs have a 12-turn and $1 model-budget setting; the latter is a stop condition, not a hard AWS billing cap.
- Approval records are atomically changed from pending to approved/denied, bound to the active run and authenticated owner, and expire after 90 seconds. The agent polls the server record before writing.
- Application records and S3 artifacts have seven-day retention. DynamoDB TTL deletion is asynchronous. The original SDK process is resumed while its runtime stays warm; after runtime replacement, the saved workspace and recent conversation text reconstruct context. This is not full SDK transcript restoration.
- AgentCore is configured with a 15-minute idle timeout and one-hour maximum lifetime. Files are restored from S3 after cold starts; an in-flight process cannot survive runtime termination.
- The web role has no Anthropic-secret permission. The agent role can read the POC key and access the POC storage. Model-visible tools cannot read environment variables, credentials, arbitrary paths, or the network.
- CloudWatch stores operational failures; application run events and approval records are saved separately. Do not put real customer data into this demo.

## Hosting details and limits

The browser connects over HTTPS to CloudFront. CloudFront forwards uncached requests to an ALB, which reaches the SvelteKit Fargate task. The ALB accepts only CloudFront origin-facing IPs and requires a generated origin header. For this AWS-provided hostname POC, the CloudFront→ALB connection uses HTTP; use an ACM certificate/custom origin hostname or an appropriate private-origin design before handling sensitive data. This is not end-to-end TLS.

AgentCore authenticates server requests with IAM (SigV4). The agent makes outbound HTTPS requests to Anthropic with the API key; Bedrock model inference is not used. All user requests share that API account's limits and billing. The POC does not enforce organizational use of this interface over desktop clients, and is not a complete enterprise security product.

ECS and the ALB incur ongoing charges while provisioned, even when no one is chatting. AgentCore, Anthropic, CloudFront, logs, and storage add usage charges. This POC has no account-wide cost ceiling.

## Development and verification

```sh
npm run check
npm test
npm run build
terraform -chdir=infra validate
npm run dev
```

The landing page works locally without AWS configuration. To use the deployed backend with local web development, configure the web process with the Terraform outputs: `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`, `AGENT_RUNTIME_ARN`, `SESSION_TABLE`, `ARTIFACT_BUCKET`, plus `AWS_PROFILE=ai` and `AWS_REGION=us-east-1`. Use `http://localhost:5173`, which is registered as a Cognito callback. No local authentication bypass is built in.

## Teardown

Do not delete state files before teardown. Save any patches you need, empty the POC artifact bucket, and delete image versions from the two POC ECR repositories before destroying their containers. Review both destroy plans:

```sh
AWS_PROFILE=ai terraform -chdir=infra plan -destroy
AWS_PROFILE=ai terraform -chdir=infra destroy
AWS_PROFILE=ai terraform -chdir=infra/bootstrap plan -destroy
AWS_PROFILE=ai terraform -chdir=infra/bootstrap destroy
```

Secrets Manager uses a seven-day recovery window. AgentCore-generated log groups can outlive the runtime; inspect and remove POC runtime logs if no longer needed.

## Request monitoring

The local LaunchAgent `com.mia-experiments.aws-poc-watch` checks support cases `178889514500948` (CloudFront) and `178889409700211` (AgentCore), plus the quota request, every 900 seconds while this Mac is awake and the user is logged in. It only reads AWS status; it does not send support messages or retry deployments. macOS notifications are submitted on status changes or new correspondence (delivery depends on notification settings). Current status and recent correspondence are saved in `.local/aws-request-status.json`; scheduled execution logs are in `.local/aws-request-watch.log`. Polling becomes a no-op once both cases and the quota request are finished.

Run a check now:

```sh
python3 scripts/watch-aws-requests.py
```

Stop the schedule:

```sh
launchctl bootout "gui/$(id -u)/com.mia-experiments.aws-poc-watch"
```

Its configuration is `~/Library/LaunchAgents/com.mia-experiments.aws-poc-watch.plist`. Remove that file after stopping if the monitor should not restart at login. The schedule is local, not a Codex chat reminder.

## References

- [AgentCore AG-UI support](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui.html)
- [AgentCore session lifecycle](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html)
- [Claude Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting)
- [AG-UI protocol](https://docs.ag-ui.com/introduction)
