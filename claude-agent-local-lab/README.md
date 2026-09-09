# Claude AgentCore local lab

A separate experiment inside `mia-experiments` for the full SvelteKit → AG-UI → Claude Agent SDK interaction using AWS's `agentcore dev` command. The sibling `claude-agent-poc` Terraform stack is independent.

## Run

Use Node 22.16+ (or a newer supported Node release; developed with Node 25). The launcher reads only `ANTHROPIC_API_KEY` from `../.env`.

```sh
cd /Users/miasocci/CODE/local/mia-experiments/claude-agent-local-lab
npm ci
npx playwright install chromium
npm run dev
```

Open [http://127.0.0.1:5273](http://127.0.0.1:5273). Select **Open the local lab**, choose Mia or Tim, and click **Research the AG-UI framework** for a sourced research answer, or **Find and fix the shipping bug** for the approval demo. Review the proposed configuration, approve it, and inspect the tests and patch. The **Events** tab shows the actual AG-UI events.

Ask Claude to save a research answer as `ag-ui-research.txt`. The save tool shows the exact contents for approval, writes to the conversation workspace, and adds a download link under **Changes**. Text, Markdown, CSV, JSON, HTML and PDF documents are supported; names cannot include directory paths. Downloading is how a hosted assistant delivers a file to your computer.

Try denying a change in a fresh conversation, stopping a run while it waits for approval, or reloading the page during approval. To test user separation, open another browser profile/private window and choose the other identity.

Stop both servers with Ctrl+C in the launching terminal. Override ports with `LAB_WEB_PORT` and `LAB_AGENT_PORT` when needed.

## How it works

1. SvelteKit issues a local HttpOnly demo-session cookie and checks conversation ownership on server routes.
2. The browser's `@ag-ui/client` HttpAgent posts to a SvelteKit endpoint and receives an SSE event stream.
3. SvelteKit constructs the trusted run request and forwards it to the custom AG-UI runtime launched by `agentcore dev` on port 8181. A per-launch internal bearer token protects this endpoint.
4. The runtime calls Claude Agent SDK with the Anthropic key. A small adapter translates SDK text and managed-tool activity into AG-UI events. Native CLI support for the AGUI protocol does not automatically translate Claude SDK events; that adapter lives in `agent/src/server.ts`.
5. The assistant can answer general questions, research the web, and help with writing and planning. Three managed project tools read the sample project, run trusted configuration tests, and request an approved replacement of `shipping.json`. Only the built-in `WebSearch` and `WebFetch` tools are enabled; shell and arbitrary file tools remain unavailable. Research results are untrusted context and the prompt requests primary-source citations. Approval is tied to the exact proposed content and current run, expires after 90 seconds, and is checked by the write tool.
6. A fourth managed tool, `save_document`, saves approved documents under `.local/workspaces/<thread>/documents/` and stores their download contents in SQLite. Download endpoints check conversation ownership. Overwrites also require approval.
7. SQLite stores conversations, approvals, decisions, artifacts and event history. Reloading uses saved events and polling to recover the visible run. Warm SDK sessions support follow-up questions; after a runtime restart, recent conversation text and the saved file restore context.

The sample has a free-shipping threshold of 100 when the requirements say 50. Six trusted tests demonstrate the failure and correction. Each conversation has its own project copy. Runs have a $1 SDK budget, 12-turn limit and four-minute timeout; these are SDK/application limits, not an account billing cap.

## Isolation and scope

- All local data, SDK session files and sample workspaces live under this folder's ignored `.local/` directory. AgentCore CLI logs live under ignored `agentcore/.cli/`.
- The launcher supplies an isolated HOME, removes inherited AWS/Claude/Anthropic variables, and points AWS configuration files at empty local files. Only the agent process receives the Anthropic key; the browser and web server do not.
- Both servers bind to loopback. There are no Terraform files, deployment targets, AWS resource writes, or shared state files with `claude-agent-poc`.
- Mia and Tim are deliberately selectable demo identities. This is not organizational authentication. The local process and per-conversation folders do not provide the isolation of a hosted sandbox.
- Claude inference sends the prompt and tool results to Anthropic and incurs API charges. Web research additionally sends search terms and requested URLs through the SDK web tools. This lab is for synthetic sample data; it makes no BAA or production-readiness claim.

This verifies the local AgentCore development workflow and AG-UI integration. It does **not** verify AWS-hosted Runtime execution, Cognito, IAM invocation, microVM isolation, scaling or CloudFront. Those remain part of the separate cloud POC once the account restrictions are lifted. Port proven adapter/UI changes deliberately into that project; do not copy local authentication or SQLite configuration over the cloud implementation.

## Validation

```sh
npm run check
npm test
npm run build
```

With `npm run dev` running in another terminal:

```sh
npx playwright install chromium
npm run test:browser
```

The browser test makes paid Claude requests and leaves its demo conversations available for inspection. Screenshots go to `.local/`. Run builds before starting an interactive demo, since SvelteKit's generated build files can trigger development reloads.

AWS references: [local development](https://github.com/aws/agentcore-cli/blob/main/docs/local-development.md) and [runtime configuration](https://github.com/aws/agentcore-cli/blob/main/docs/configuration.md).

The web tools use the [Claude Agent SDK built-in tools](https://code.claude.com/docs/en/agent-sdk/agent-loop). Availability remains subject to Anthropic account and tool service behavior; this lab does not implement a corporate domain allowlist or an egress firewall.

HTML documents have a **Preview** button under **Changes**. The preview uses sanitized HTML in a sandboxed iframe with a restrictive Content Security Policy; scripts, navigation markup and remote assets are disabled. Inline CSS and common inline SVG elements are supported. The download retains the original approved HTML and its .html filename. This is a static infographic preview, not an application execution environment.

For a PDF, ask for a filename such as `ag-ui-summary.pdf`. Claude proposes self-contained HTML; after approval the server renders it with Chromium to actual PDF bytes. The renderer disables JavaScript, blocks network requests, uses a fresh browser context, and closes after 30 seconds; the resulting file is limited to 20 MB. PDFs are stored in the conversation documents directory and downloaded with `application/pdf`. Chromium must be installed on the host; a future cloud runtime image must include its browser binaries and OS dependencies.
