# Fieldwork router lab

A fresh sibling experiment built with **Svelte AI Elements from day one**. It has its own dependencies, process, database, workspace files, and port. Neither `claude-agent-local-lab` nor `claude-agent-poc` is used at runtime.

## AWS deployment

The same project now has local and AWS deployment modes. The Medplum Terraform stack, container entry point, Cognito login, PostgreSQL/S3 storage adapters and AgentCore Runtime integration are documented in [infra/aws/README.md](infra/aws/README.md). Local development still uses SQLite and demo identities. Earlier experiment stacks are independent.

## Run

Requires Node 22.13+ (tested on Node 25), npm, and an Anthropic API key in the parent repo's `.env` as `ANTHROPIC_API_KEY`.

```sh
cd fieldwork-router-lab
npm ci
npx playwright install chromium
npm run dev
```

Open **http://127.0.0.1:5373**. Choose Mia or Tim, then either choose a framework or describe a task. Strands asks for clarification when needed, recommends an available framework, and prepares a brief. Accepting a recommendation transfers the saved context into the chosen agent in the same conversation. You can choose a different available framework before handoff.

`npm run dev` is a local experiment with real model calls. Demo identities are disabled in cloud mode, which uses Cognito. Agents run locally in dev and in AgentCore Runtime in the AWS deployment. This does not establish a BAA-covered configuration. Strands currently uses Anthropic's API model provider, not Bedrock.

## What actually runs

| Framework                  | Current capabilities                                                | Credentials                                                    |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| AWS Strands TypeScript SDK | Conversational routing; direct planning/writing; approved documents | `ANTHROPIC_API_KEY`                                            |
| Claude Agent SDK           | WebSearch/WebFetch, explanations and writing, approved documents    | `ANTHROPIC_API_KEY`                                            |
| OpenAI Codex SDK           | Implemented read-only engineering adapter; no document-export tool  | `OPENAI_API_KEY` + `OPENAI_API_ENDPOINT`; disabled when absent |

Codex has been live-tested with the configured API key through `https://us.api.openai.com/v1`. The launcher deliberately isolates HOME and does not borrow the developer's personal Codex/Claude sign-in or AWS credentials. Set `OPENAI_API_KEY` and `OPENAI_API_ENDPOINT` in the parent `.env` and restart to configure Codex. A bare endpoint origin gets `/v1` appended; an explicit API path is preserved. A missing endpoint fails closed, without falling back to the global endpoint. Do not put keys in frontend environment variables.

These are configured capability profiles, not rankings of the frameworks. Claude has no arbitrary shell or repository-write tools in this experiment. Codex's workspace starts empty; repository mounting and writable engineering workflows are future work.

## UI and protocol

The interface uses the actual [Svelte AI Elements registry](https://svelte-ai-elements.vercel.app/docs): Prompt Input, Conversation, Message/Markdown response, Suggestion, Confirmation, Tool, Sources, and Plan, together with shadcn-svelte and Tailwind. Source components live in `src/lib/components/ai-elements` and are intentionally vendored. A local compatibility fix gives Confirmation reactive context getters rather than calling Svelte `setContext` from a later watcher. The registry's missing Scroll Area dependency was installed separately. Conversation Content has a bounded scroll viewport and a single element ref so long replies and handoff cards remain reachable; its scroll button has an accessible label.

Svelte components render the UI; `@ag-ui/client` consumes the backend's AG-UI SSE stream. The provider adapters normalize text, tool lifecycle, run status, and custom recommendation/approval/document events. This is an application-owned adapter, not a claim that every SDK natively speaks AG-UI.

```text
SvelteKit + Svelte AI Elements
            │ AG-UI over SSE
     SvelteKit server
            │
     Strands coordinator
            │ recommendation + saved task brief
      User accepts a fit
            │
   Strands / Claude / Codex adapter
```

Assuming “a2s” meant **A2A**: [Strands supports A2A](https://strandsagents.com/docs/user-guide/concepts/multi-agent/agent-to-agent/). It becomes useful when the coordinator delegates to separately deployed services with discovery, task status, and independent lifecycles. This first experiment performs an explicit server-side handoff in one process. A2A is not required for this flow and is not implemented here. AG-UI would still connect the browser to the application even if A2A later connected agents behind it.

The AWS mode retains this UI contract and invokes the shared adapters in AgentCore Runtime. Cognito supplies identity; PostgreSQL and S3 supply persistence. Durable provider checkpoint/resume, organization policies and production operational review remain follow-up work. See the deployment guide for the current validation status.

## Storage and controls

- `.local/fieldwork.sqlite` (see launcher for configured filename): owner-scoped conversations, messages, events, approvals, and document records.
- `.local/workspaces/<conversation-id>/documents/`: saved files. No S3 is used.
- `.local/home/`: isolated SDK home, with empty AWS configuration files.
- Cookie-based demo sessions expire after 24 hours; mutations require same-origin requests.
- Run leases prevent duplicate execution. Runs time out after 210 seconds; conversations have a 40-run limit. Claude runs also have a $1 budget and 12-turn limit.
- Saving `.txt`, `.md`, `.csv`, `.json`, `.html`, or `.pdf` requires a one-time, owner-checked approval expiring after 90 seconds.
- HTML previews use sanitization, restrictive CSP and a sandboxed iframe. PDF rendering uses Chromium with JavaScript and network requests disabled.
- Refresh restores saved messages and polls an in-progress run. The local process must remain alive; this is not a durable job queue. SDK context is reconstructed from saved text history per run, not an opaque provider session.

## Verification

```sh
npm test
npm run check
npm run build
# With npm run dev running; performs paid live API calls:
npm run test:browser
node tests/verify.mjs
```

The browser flow exercises identity selection, a live Strands recommendation, Claude handoff, file approval, and text download. `verify.mjs` continues that flow with reload, PDF creation, mobile layout, owner isolation, and invalid-framework rejection. Screenshots are saved under `.local/` and are ignored by git.

`node tests/codex-live.mjs` checks the regional Codex SDK connection; `node tests/codex-browser.mjs` checks the full browser → AG-UI → Codex path. Both make live API calls.

## Research and handoff components

- **Tool** renders current-run AG-UI tool arguments, results, and running/completed/error states in Activity. An interrupted call without a result is identified explicitly.
- **Sources** lists deduplicated HTTP(S) Markdown citations beneath each assistant response. It reflects cited links, not independent verification that an agent visited the pages. Code, images, credential-bearing URLs, and local download links are excluded.
- **Plan** renders the coordinator recommendation and saved handoff brief. Its collapse control does not hide the agent-selection actions. It is not an invented execution plan or progress tracker.

Registry compatibility fixes include the Tool export file, clipboard hook path, stable Svelte IDs, and removing Plan Trigger's nested button. Code/Copy Button and Shimmer are supporting registry dependencies.

`node tests/elements-browser.mjs` verifies these components with browser-only fixture responses (no model charges or saved-conversation mutations).

## Context and token usage

The composer includes the Svelte AI Elements **Context** component. Hover, focus, or click the token indicator to inspect it. All adapters publish the same versioned usage snapshot through AG-UI shared state; the client reads that contract without provider-specific branches. Snapshots are stored with run events, survive reload, and reset for each new run/handoff. Older runs without these events display “No token metrics”.

- Claude: latest model-request input (including cache), SDK-reported context-window limit, aggregate model usage, and SDK-estimated cost. A percentage represents that last input's share of the reported window, not live occupancy or a prediction of the next request.
- Strands: last-request input and accumulated per-request totals. The current Anthropic adapter does not report a window limit; the count is shown without a percentage.
- Codex: SDK turn totals, including cache and reasoning breakdown. Its TypeScript turn event does not report the current context occupancy or window limit, so no context percentage is fabricated.

Input includes cache tokens. Cache read/write counts are subsets of input; reasoning is a subset of output. Unknown values stay unavailable. Cumulative snapshots replace earlier snapshots rather than being summed. The vendored Context component's placeholder pricing is not used; no provider cost is inferred from it. Current context snapshots exclude the user's unsent draft and may change as the harness compacts or rebuilds its prompt.

`npm test` covers provider-specific accounting. `node tests/usage-live.mjs` makes a small live call through all three configured adapters and verifies saved metrics and the browser display.

## File uploads

Use the composer paperclip or drag files into it. Svelte AI Elements attachment components provide previews and removal; multipart uploads return private conversation-scoped references, following the ICU upload pattern. Files remain available after a Strands handoff, appear in messages and the Files panel, and survive reload.

Supported: PNG/JPEG/WebP images, UTF-8 TXT/Markdown/CSV/JSON/log files, and text-based PDFs. Limits: 5 files per upload, 5 MB per file, 20 files per conversation, 50 PDF pages, 50,000 extracted characters per file and 150,000 per conversation. Scanned PDFs require page images; OCR is not included.

Originals live under `.local/workspaces/<thread>/uploads/`, with metadata in SQLite. Owner checks protect uploads and downloads; file contents are validated and treated as untrusted input. All three adapters receive extracted text and native image inputs; images are normalized and resized before model use. This adds image attachments, not image generation.

`npm test` covers upload validation. With the dev server running, `node tests/uploads-live.mjs` checks text, PDF, and image understanding through all three real agents and owner isolation; `node tests/uploads-browser.mjs` checks composer previews/removal, upload, routing handoff, file links, and reload. Both live tests incur model usage.

## Profile and AgentCore Memory

Open **Profile & memory** from your avatar, or visit `/settings`. Memory is opt-in for each demo identity. The controls govern cloud event storage, recall across conversations, sharing across frameworks, and preference/summary retrieval. Settings persist in SQLite. Disabling memory stops agent-triggered memory reads/writes; explicit inspection/reset actions remain available. Changes affect future requests, not context already sent to an in-flight agent. Explicit handoffs still carry the current conversation history.

All adapters use one shared backend memory service. Actor IDs include the authenticated owner, reset generation, and framework; server-selected namespaces prevent cross-user recall. Sharing broadens retrieval across that user's three framework namespaces. With cross-conversation recall off, events use `extractionMode: SKIP`; with it on, AWS extracts preferences and session summaries asynchronously. Type toggles filter retrieval, not extraction. No historical chats are backfilled. Only new conversation text is sent, capped at 12,000 characters per message and 20 messages per completed run; uploaded bytes and raw tool outputs are not directly copied, though responses can discuss them.

The **Memory** inspector tab shows context retrieved for the current run. Retrieval is capped and injected as untrusted optional context. AWS failures leave local chat working and are surfaced as memory status. SQLite remains the source of visible chat history, approvals, and artifact metadata; this version does not restore chats from AWS short-term events. Raw AWS events expire after 7 days; extracted records persist until deleted.

Reset rotates the user's namespace generation immediately and deletes known AWS events and records from retired generations. A concurrent extraction can create a late record in retired storage; it cannot be recalled. The UI reports this limitation, and repeating reset retries cleanup of retired generations. This is not a guarantee of immediate physical erasure across AWS asynchronous processing.

### Provisioning

Terraform lives in `infra/memory/` with independent, ignored local state. It provisions only a Memory resource and two built-in strategies in `us-east-1`, using profile `ai`; it does not change either sibling stack.

```sh
node scripts/deploy-memory.mjs
npm run dev
```

The deployment script plans and applies the resource, writes the non-secret Memory ID to `.local/memory.json`, and asks you to restart. `FIELDWORK_MEMORY_ID` can also supply the ID. The launcher passes the original AWS configuration paths to the server's explicit `ai` credential provider while keeping the isolated HOME and empty default AWS config for agent processes. Credentials are never sent to the browser or included in model context.

**Earlier `ai` account blocker (2026-09-09):** listing Memory resources succeeded, but AWS rejected Terraform's `CreateMemory` with `AccessDeniedException: Access Denied during CreateMemory: Unable to perform operation. Contact customer support for assistance.` No Memory resource was created. The profile/settings UI and SDK integration are implemented, but real AWS write, extraction, retrieval, and deletion remain unverified until provisioning succeeds. No local mock is used as a cloud-memory fallback.

`npm test` includes mocked AWS boundary tests for opt-in, namespaces, framework/kind filtering, settings changes during runs, failures, and reset. `node tests/memory-settings-browser.mjs` checks the settings UI and recalled-memory panel without model calls and restores the user's original settings.

## Conversation management

The expanded sidebar searches titles and saved message text within the current person's conversations. Pinned threads appear first; **Archived** has its own searchable view and a Restore action. Each thread's options provide Rename, Pin/Unpin, and Archive/Restore. Archiving is reversible and does not delete messages or files; a running conversation must be stopped before it can be archived.

New threads use a whitespace-normalized first-message title. During conversational routing, Strands is prompted to supply a concise task title with its recommendation; the server applies that title only for the current run and never overwrites a manual rename. Direct-agent chats use the first-message fallback without an extra model call. Older threads remain compatible with the optional metadata fields.

`npm test` covers owner isolation, message search, pin/archive ordering, title validation, and manual-title precedence. `node tests/conversations-browser.mjs` exercises the real local API and UI without model calls; it leaves its synthetic thread archived.

## Python execution with AgentCore Code Interpreter

All three execution agents expose the same `run_python` tool. Strands uses a native tool, Claude uses its in-process MCP server, and Codex connects to a run-scoped MCP endpoint with an ephemeral bearer token. The coordinator recommends an agent before execution.

Try: **Run Python to calculate the sum of the squares from 1 to 100. Print the result and create a CSV of the values named squares.csv.** Review the code and click **Run in AWS**.

Each approved call starts a fresh `aws.codeinterpreter.v1` session in `us-east-1`. Only explicitly selected attachments from that conversation are copied into the sandbox. The AWS work has a 60-second deadline; the session is stopped in `finally` with a five-minute AWS session timeout as a backstop. The approval covers the exact code, input mapping, and requested output files. Denied requests do not contact AWS. There is no local execution fallback.

Outputs support TXT, Markdown, CSV, JSON, PNG and PDF (five files, 5 MB each). They are stored in the conversation's local document store and downloaded through the existing owner-checked route. Output names receive a unique prefix to avoid overwriting earlier files. Stdout/stderr and failures appear in tool activity. Generated files and tool output remain untrusted content.

The built-in interpreter does not require a new Terraform resource. Server credentials use AWS profile `ai` through the explicit credential paths set by the dev launcher; agents receive neither AWS credentials nor the AWS client. For a different local port, set `FIELDWORK_PORT`; a deployed server must set `FIELDWORK_MCP_URL` to its private reachable MCP endpoint. This run-token registry is process-local, like the existing run controllers.

**Earlier `ai` account blocker observed September 9, 2026:** the applied quota “Total number of concurrent active code interpreter sessions per account” (`L-CAF6F552`) is **0**, while API request-rate quotas are 30. Starting a session returned `ServiceQuotaExceededException: maxCodeInterpreterSessions limit exceeded`. Live successful execution is unverified until AWS enables sessions. Live checks confirmed that Strands, Claude and Codex each request approval and reach this AWS quota error. Browser code preview and denial were verified. Unit tests use injected AWS responses; the app itself always calls AWS.

References: [AWS Code Interpreter API examples](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-api-reference-examples.html), [Codex MCP configuration](https://developers.openai.com/codex/mcp).

## AG-UI integration

`HttpAgent` owns streaming message and shared-state updates. The Svelte page consumes `onMessagesChanged` and `onStateChanged`; it does not concatenate text deltas or apply JSON Patch itself. A server `MESSAGES_SNAPSHOT` establishes the canonical conversation, including attachment metadata and agent attribution.

`src/lib/agui.ts` uses AG-UI's `defaultApplyEvents` and `transformChunks` for saved-event replay, including partial runs. Both reconnect recovery and expired-run recovery use that same reducer. The Svelte boundary passes `$state.snapshot` values so reactive proxies are not passed to AG-UI's cloning code. A small compatibility translation reads older custom events as shared state; new runs publish state events directly.

Approvals, routing recommendations, document lists, usage and recalled memory use `STATE_SNAPSHOT` / `STATE_DELTA`. Tool cards consume the tool calls/results maintained in AG-UI messages. Native Codex tools are translated into standard tool lifecycles; its plan updates use `ACTIVITY_SNAPSHOT`, and private reasoning is excluded. Shared MCP tool calls are recorded once by the common tool wrapper. Outgoing events are typed against the AG-UI event union and validated with `EventSchemas` before persistence or encoding.

Approval decisions still use the owner-checked server endpoint while the SDK tool awaits the user. This is the shared-state human-in-the-loop pattern, not a durable interrupt/resume implementation. AG-UI interrupts end one run and start another; adopting that lifecycle requires checkpoint/resume support in each provider adapter and is not interchangeable with a live tool callback. Application notifications such as handoff and AWS session lifecycle remain custom events.

Run `npm test` for offline protocol replay, snapshots/deltas, tool normalization, ownership, approval, and cancellation checks. The test runner uses a separate Node TypeScript configuration to avoid applying SvelteKit's bundler resolution to dependencies. `npm run test:browser` exercises the live routing, document approval/download, and reload flow with configured model credentials.

## AgentCore observability

The AWS stack enables CloudWatch Transaction Search and AgentCore's unified trace destination. The agent container starts the AWS Distro for OpenTelemetry Node.js instrumentation before loading the application. Each conversation is a stable AgentCore session; each turn gets a distributed X-Ray/W3C trace that follows the Runtime invocation into Fieldwork's framework, memory and tool spans. Code Interpreter requests receive the active trace headers. The Activity panel exposes the current trace ID and a CloudWatch link.

Fieldwork's custom spans contain operational metadata only: framework, phase, run/session identifiers, duration, outcome, tool name and provider-reported token totals. They exclude prompts, responses, file contents, memory text, tool arguments and tool results. Automatic generative-AI message capture is disabled, and automatic instrumentation is limited to HTTP and AWS SDK calls. Strands 1.17 emits payload values in its built-in OpenTelemetry spans, so its internal exporter is deliberately suppressed in favor of the shared content-free adapter. AWS service-provided logs are governed separately; review their payload settings, retention and access controls before using this POC with regulated data.

Terraform owns the account-level X-Ray destination, the 1% Transaction Search indexing rule, the X-Ray-to-CloudWatch resource policy, the Runtime execution-role permissions, and 30-day retention for the ECS and AgentCore Runtime log groups. The shared `aws/spans` log group also retains traces for 30 days. Transaction Search can take about ten minutes to show new spans after first enablement.
