# AG-UI integration audit

**Follow-up implemented September 9, 2026:** the findings below describe the pre-refactor code. Live message handling now uses `onMessagesChanged`; recovery uses the library reducer; tool cards use AG-UI messages; native Codex tools have standard lifecycle events; outgoing events are typed and validated; and approvals/recommendations/documents/usage/memory use shared state. See the project README’s AG-UI integration section for the current architecture and the intentional live-tool approval limitation.

September 9, 2026. Scope: `fieldwork-router-lab`, including the pending Code Interpreter changes. Application code was not changed by this audit.

## Verdict

AG-UI is genuinely used for the browser/server protocol. However, Fieldwork primarily consumes its transport layer and recreates part of its message/state management. The largest cleanup opportunity is the frontend reducer, not removing the provider adapters or application services.

## Confirmed library usage

- `src/routes/+page.svelte`: `HttpAgent` and `runAgent()` perform the agent HTTP request and consume the SSE stream. There is no hand-written browser SSE parser.
- `src/routes/api/threads/[id]/run/+server.ts`: `RunAgentInputSchema` validates the request before ownership, attachment and run checks.
- `src/lib/server/runner.ts`: `EventEncoder` serializes emitted AG-UI events. The surrounding `ReadableStream`, heartbeat and response headers are ordinary SvelteKit/server integration.
- Installed AG-UI packages: `@ag-ui/client`, `@ag-ui/core`, `@ag-ui/encoder`, version 0.0.59.

## Findings, in priority order

### 1. Frontend reimplements message accumulation already provided by AG-UI

`+page.svelte` manually handles `TEXT_MESSAGE_START` and appends `TEXT_MESSAGE_CONTENT` in `onEvent`, alongside the library's own internal message state. It does not consume `onMessagesChanged`, `agent.messages`, or the returned new messages. A new client is created per turn with only the latest user message; Fieldwork maintains its separate full transcript.

The reconnect/poll path in `refresh()` implements another text-event reducer. `store.ts` repeats similar reconstruction for expired runs. These paths currently understand text start/content rather than the complete message event model. For example, a standard `MESSAGES_SNAPSHOT` would update the library but would not update Fieldwork's displayed transcript through its existing event handler. Current providers do not emit snapshots, so this is a compatibility/maintenance gap rather than a demonstrated current transcript failure.

Recommended first change: let `onMessagesChanged` provide live AG-UI messages and use a small presentation mapping for framework labels and attachment metadata. Preserve server-authoritative conversation ownership and history. Consolidate replay/recovery handling and test it against the library behavior before replacing polling.

### 2. Native provider activity is not consistently normalized

Shared Fieldwork tools and Claude web tools emit standard `TOOL_CALL_*` events. Codex native non-message items instead become `CUSTOM/codex_activity` after completion. `toolActivity()` only recognizes `TOOL_CALL_START/ARGS/RESULT`, so those native Codex items do not become the same tool cards; the raw event list only shows the custom event name. The new shared `run_python` tool is an exception: its activity already uses the standard shared path for all three providers.

Recommended change: translate applicable native provider tool lifecycles to standard tool events, with stable IDs and results. Use custom events only where there is no appropriate standard representation. Do not expose private reasoning as activity.

### 3. Server emission bypasses the library's event types and runtime validation

`RunContext.emit` and the runner accept `Record<string, any>`, then cast to `BaseEvent`. In the installed encoder, `encodeSSE()` formats JSON; it does not validate event shape. Request validation is present, but outgoing event validation is not.

Recommended change: type standard events using the AG-UI discriminated event union, define typed payloads for Fieldwork custom events, and validate adapter fixtures with `EventSchemas`. Add event-order/lifecycle tests; schema validity alone does not establish correct ordering.

### 4. Approvals and durable UI state remain a Fieldwork-specific protocol

Approvals use custom requested/resolved events, a separate HTTP decision route, and server polling while the provider tool waits. Routing recommendations, memory and usage also use custom payloads. There are no emitted `STATE_SNAPSHOT`/`STATE_DELTA` events or client `onStateChanged` subscriptions. The installed library also exposes interrupt/resume types, but the application does not use them.

These are valid custom extensions, not proof that AG-UI is fake. They do mean a generic AG-UI client cannot automatically provide Fieldwork's controls. Approval persistence/authorization still belongs on the server regardless of protocol choice.

Recommended follow-up: place durable shared view state behind typed state snapshots/deltas where useful. Evaluate interrupt/resume separately, because pausing/resuming actual SDK tool execution requires backend support; changing an event name is insufficient. Keep application-specific notifications custom when that is clearer.

## Custom code that should remain

Authentication and ownership, durable storage, upload validation, artifact downloads, AWS sessions, memory preferences, SDK credential isolation, execution limits and cancellation are application responsibilities. Provider adapters are necessary in the current architecture to translate each SDK's output into a common protocol. Svelte AI Elements supplies presentation components; it does not replace AG-UI or implement the backend integration.

## Verification

- Read the application integration and the installed client/encoder/types, plus official AG-UI documentation.
- Validated all 1,267 persisted events present at audit time against `EventSchemas`: zero schema failures. This checks recorded payload shapes, not every possible future branch or lifecycle invariant.
- Ran an isolated `HttpAgent` against an in-memory SSE response produced by `EventEncoder`. It assembled two text deltas into `Hello world` and fired `onMessagesChanged` three times with no custom text reducer. No model or AWS call was needed.
- No application refactor, deployment, commit or push was performed as part of this audit.

References: [HttpAgent](https://docs.ag-ui.com/sdk/js/client/http-agent), [AgentSubscriber](https://docs.ag-ui.com/sdk/js/client/subscriber).
