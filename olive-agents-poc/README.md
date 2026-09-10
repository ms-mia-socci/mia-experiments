# Olive agents POC

Staging Olive message automation in the Medplum AWS account **229015218172**, region **us-east-1**, profile **medplum**. Infrastructure uses CloudFormation. Other experiments and their Terraform state are independent.

**Deployment verified September 10, 2026:** stack `olive-agents-poc-staging` is deployed, the one-minute schedule is enabled, and `DRY_RUN=false`. The Harness is `OliveAgentsStaging-L1Kvb3UIYY`, version 4, with the `staging` endpoint READY. The completeness/evidence fix passed 23 local tests and all 20 synthetic scenarios against the deployed Harness. Read-only checks using the recorded surname reply and the thread's premature acknowledgment both correctly requested the missing DOB. The Lambda-to-Harness smoke probe passed and scheduled polls completed without errors. These verification tests did not send patient messages. Version 3's live ankle-interruption test exposed premature completion after surname only; version 4 adds a generic evidence/completeness check and a corrective retry. Existing processed messages are not replayed—continue the Olive thread with a new inbound message to test delivery with version 4.

An EventBridge rule invokes a Lambda every minute. Lambda discovers recently active Medusa conversations, reads their histories to recover inbound message bursts (including when the latest message is outbound), resolves the ticket and canonical member context, checks `member.client_id`, and invokes the managed **AgentCore Harness**. The Harness is powered by Strands. It holds the model and instructions and is available in the AWS console. Lambda validates its decision and sends an approved response through Connect's `olive.message.send` event.

## Client workflows

The deployed model is **Amazon Nova Pro** (`amazon.nova-pro-v1:0`), invoked within us-east-1. Sonnet 4.6 was tested but requires global/US inference profiles that the organization's service control policy denies (including us-west-2). Nova Pro's regional invocation succeeded. The managed Harness remains Strands-powered. `HARNESS_MODEL_ID` can select another permitted model on deployment.

| Client UUID | Behavior |
| --- | --- |
| `81209de7-5208-477b-b6c4-7c792e0dfc77` | Compare the triggering message's topic with prior patient messages. Reply on the first occurrence; otherwise do nothing. Runs at all hours for this POC, as requested. |
| `724ef93c-546c-4084-acf6-ed035a3528cd` | Naturally collect first name, last name, and DOB across messages. Ask only for missing or unclear information, acknowledge completion, and stay silent after completion or an explicit refusal. This collects information; it does not verify identity against an authoritative record. |
| All other clients | Do nothing, without calling the Harness. |

`FirstTopicResponse` is a fixed CloudFormation response parameter: the model must copy it exactly and Lambda rejects altered wording for that workflow. Its current text says “You have reached us outside of normal business hours. Please contact the care team during normal business hours.” There is deliberately no time-of-day gate in this POC. `IdentityConfirmationResponse` guides the initial identity request; the Harness authors natural initial requests, follow-ups, clarifications, and acknowledgments. Lambda validates the response schema, length, action/reason pairing, and authorized workflow, then sends the agent's message. There is no missing-field combination table.

`IdentityCollectionFields` is a JSON CloudFormation parameter declaring the requested fields as `{key,label,type}` objects (`text` or `date`). Locally use `IDENTITY_COLLECTION_FIELDS`. Defaults are first name, last name, and DOB. The Harness receives this list and returns `collectedDetails`, using exact patient-message substrings or null for missing/unclear values. A generic validator requires every configured key, checks quoted values against patient message bodies (not timestamps, profiles, or assistant messages), and validates complete calendar dates. It rejects completion or completed-conversation silence when anything is missing. One corrective Harness invocation is allowed before failing closed; neither attempt calls Connect until the decision passes validation. Extracted values are not written to the processed-message table or Lambda logs.

Adding a requested field changes this declaration and the instructions/tests as appropriate; it does not require field-combination branches or patient-response templates. The extra-symptom-field test is synthetic only: the deployed policy still requests just the three identity details. New clinical workflows still need appropriate instructions and testing.

The earlier manually tested member `51b18566-225f-4451-89b4-b88bf0e72df1` belongs to client `891a963b-58d5-4033-94cd-8da4413d0162`, so automatic processing skips that member. Use a staging member associated with one of the two configured client UUIDs to test an automated response.

## Build and deploy

```sh
npm ci
npm run check
npm test
AWS_PROFILE=medplum AWS_REGION=us-east-1 npm run deploy
```

The deploy script checks the AWS account, builds a bundled Node.js 22 ARM64 Lambda artifact, uploads it to the POC artifact bucket, deploys the stack, and copies only the two staging API keys from `.env` to Secrets Manager. Keys are excluded from the template, Lambda configuration, source, artifacts, and command arguments. `.env` uses the key names in `.env.example`.

Deployment defaults to `ENABLE_POLLER=false DRY_RUN=true`. To enable delivery for the two configured clients:

```sh
AWS_PROFILE=medplum AWS_REGION=us-east-1 ENABLE_POLLER=true DRY_RUN=false npm run deploy
```

Each deploy temporarily disables the schedule while updating resources and credentials. To stop automatic polling, deploy with `ENABLE_POLLER=false`. The processed-message table and populated secret are retained if a successful stack is deleted; resources created by a failed initial deployment are cleaned up automatically. The artifact bucket remains separately managed by the deploy script.

## Console testing

Open [AgentCore Harnesses in us-east-1](https://us-east-1.console.aws.amazon.com/bedrock-agentcore/harnesses?region=us-east-1) in the Medplum account and select **OliveAgentsStaging**. The poller uses the named `staging` endpoint pinned to the version deployed by CloudFormation. Console edits update `DEFAULT`; redeploy through CloudFormation to promote reviewed instructions to the poller's endpoint.

```sh
AWS_PROFILE=medplum AWS_REGION=us-east-1 npm run verify:harness
```

This invokes the real deployed Harness with 20 synthetic cases, covering first/repeated topics, client authorization, partial answers (including "Tim"), different answer orders, incomplete/invalid dates, refusal, prompt injection, a full multi-turn exchange, the ankle-interruption regression, recovery from a premature acknowledgment, and a policy with an extra requested detail. It checks decisions with the same evidence/completeness validation and corrective retry used by Lambda, then checks relevant response content without requiring exact identity wording. The adversarial injection case accepts either a legitimate collection follow-up or safe no-action; conversational continuity is not required for that case. It creates copy/paste JSON inputs under `.local/console-fixtures/`. Paste one JSON object as a user message in a fresh console test session. These tests never call Connect. The Harness has no Connect key or delivery tool; Lambda owns sending. Console-only invocations use the prompt but do not execute Lambda's evidence validator; use this script to exercise both together.

Before deployment, run `VERIFY_LOCAL_PROMPT=true AWS_PROFILE=medplum npm run verify:harness` to test the local CloudFormation prompt as an invocation-only override. This does not change the deployed Harness. Run again without the flag after deployment to verify the pinned `staging` endpoint.

Use `VERIFY_CASE=identity-tim` (or another fixture name) to run one scenario, or `VERIFY_CASE=multi-turn` to run the four-message exchange. Runtime and console fixture serialization both place the identity trigger after its history. Preserve this ordering: model behavior proved sensitive to presentation during testing. The first-topic input layout is unchanged.

To test the poller role's permission to invoke the Harness with a fixed synthetic input, invoke Lambda with `{"type":"olive.harness.smoke"}`. Success returns `verified: true` and `delivered: false`; this branch never calls Connect. Ordinary scheduled events run the real poller.

Harness requests explicitly include the current message, prior messages, client, response policy, and member identifier. Profile names, DOB, provider information and patient notes from the Medusa context response are not included; patient-supplied details in message bodies are included. Identity collection uses only the current conversation, including visible automated care-team prompts. Harness Memory is disabled; each message uses an isolated session and the Harness reconstructs collection progress from the supplied transcript. Lambda logs identifiers and outcomes, not message bodies or model topic labels. AgentCore manages its own session and telemetry lifecycle.

## Local polling

Set `OLIVE_HARNESS_ARN`, AWS profile/region and the response texts in the local environment, then run `npm run poll:local`. It runs one poll. Dry-run is the default. Live local delivery requires `PROCESSED_MESSAGES_TABLE`; the in-memory store is for dry-run and tests.

## POC boundaries

- The discovery window overlaps by two minutes. It is not a durable event feed; an outage longer than the window needs explicit recovery, and the API's maximum recent window is 15 minutes. Unqualified timestamps are interpreted as UTC, matching the inspected staging API.
- Topic evidence consists of the full current conversation plus the member's last five feed messages. The documented APIs do not provide a complete lifetime archive across every closed conversation. The configured maximum is 200 prior messages; larger contexts fail closed rather than silently discarding older evidence.
- DynamoDB conditionally claims each `message_id` before deciding/sending. Claims are retained for 30 days. Errors after claiming require manual review; the POC does not automatically retry them. This avoids blindly resending after an ambiguous Connect timeout, but is not an exactly-once delivery guarantee. Connect HTTP 202 means accepted, not delivery confirmed.
- Dry-run decisions also consume their message IDs. Switching delivery on processes new messages; it does not replay dry-run results.
- Identity collection is model-driven and reconstructed from the current conversation, not a separate persistent field store. Evidence validation prevents completion without all declared fields, but matching text does not establish clinical meaning or authenticate the patient. It does not verify demographics, update a member record, or authorize access. Content boundaries (including not claiming verification) are prompt instructions, not a deterministic semantic guarantee. Dates currently accept ISO year-month-day, US month/day/year, and English month-name/day/year forms; unsupported or ambiguous formats require clarification. Transcript availability and outbound-message visibility affect continuity; eventual consistency can cause redundant follow-ups during rapid message bursts. Full demographic verification and a persistent identity-verification workflow are not implemented.

API patterns: [Medusa](medusa-calls.md) and [Connect](connect-olive-calls.md).
Official integration references: [Harness getting started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-get-started.html), [Harness security/IAM](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-security.html), [Harness versioning](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-versioning.html), [InvokeHarness](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_InvokeHarness.html). The project pins AWS SDK v3.1129.0, which includes `InvokeHarnessCommand`; the installed AWS CLI 2.34.21 predates the direct Harness commands, so use the SDK for invocation.
