# Fieldwork router lab

A fresh sibling experiment built with **Svelte AI Elements from day one**. It has its own dependencies, process, database, workspace files, and port. Neither `claude-agent-local-lab` nor `claude-agent-poc` is used at runtime.

## Run

Requires Node 22.13+ (tested on Node 25), npm, and an Anthropic API key in the parent repo's `.env` as `ANTHROPIC_API_KEY`.

```sh
cd fieldwork-router-lab
npm ci
npx playwright install chromium
npm run dev
```

Open **http://127.0.0.1:5373**. Choose Mia or Tim, then either choose a framework or describe a task. Strands asks for clarification when needed, recommends an available framework, and prepares a brief. Accepting a recommendation transfers the saved context into the chosen agent in the same conversation. You can choose a different available framework before handoff.

This is a local experiment with real model calls. Demo identities are not authentication suitable for deployment. Nothing in this project deploys to AWS or establishes a BAA-covered configuration. Strands currently uses Anthropic's API model provider, not Bedrock.

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

An AWS version can move these adapters behind remote services while retaining this UI contract. Deployment work still needs real identity, durable task execution, persistent storage, authorization, organization policies, observability, and provider/data-processing review. This prototype validates local routing and the frontend integration; it does not prove cloud hosting.

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

The composer includes the Svelte AI Elements **Context** component. Hover, focus, or click the token indicator to inspect it. All adapters emit the same versioned `CUSTOM usage_snapshot` AG-UI event; the client reads that contract without provider-specific branches. Snapshots are stored with run events, survive reload, and reset for each new run/handoff. Older runs without these events display “No token metrics”.

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
