# Fieldwork router lab: focused code review

Scope: this project only. Reviewed conversation lifecycle, persistence, provider adapters, uploads/documents, and the page controller. This is a focused maintenance review, not a security audit.

## Cleaned up

- Ignore obsolete refresh responses after switching conversations or returning home, and ignore older overlapping poll responses.
- Clear messages, metrics, artifacts, and approval/recommendation state on New conversation.
- Recover expired run leases on thread reads. Preserve streamed partial messages, clear abandoned approvals, and allow a retry after a process restart.
- Only remove an active run controller if it still belongs to the finishing run.
- Index event replay by conversation, run, and sequence instead of scanning the event table.

## Next priorities

1. **Separate saved history from model context.** `store.ts` and `runner.ts` truncate persisted messages to 40. This removes visible history and attachment references, while old events and uploaded bytes remain stored. Preserve full history; apply a separate, explicit context budget in adapters, with attachment selection and eventually pagination.
2. **Split the page controller and provider adapters.** `+page.svelte` combines navigation, polling, uploads, streaming, approvals, and most of the UI. `providers.ts` contains all three adapters. Extract conversation state and lifecycle handling first, then move each provider behind the existing shared RunContext contract. Avoid cosmetic component splitting that leaves state ownership unclear.
3. **Strengthen boundary types.** Outgoing AG-UI events are now typed and validated. Client REST API responses and some SDK-specific conversions still use `any`. Define shared response DTOs and a discriminated union for custom events; validate incoming request shapes at route boundaries. SDK-specific conversion should remain inside each adapter.
4. **Make document persistence atomic.** `documents.ts` writes both a workspace file and SQLite content, which can diverge on failure. Cancellation/run identity should be checked again after asynchronous rendering and before committing. Choose a canonical artifact store and publish metadata only after the artifact succeeds.
5. **Make lifecycle ownership durable before cloud hosting.** Controllers are process-local. Cancellation, lease renewal, approval mutations, and completion need run-ID-conditional updates throughout before multiple workers are possible. Expired-lease recovery helps local restart behavior but is not distributed orchestration.
6. **Make browser checks reproducible.** Several existing scripts depend on previously saved conversations or make paid model calls. Keep isolated fixture-based UI regressions separate from opt-in live SDK checks, and provide one documented command for each group.
7. **Add retention and metadata queries.** SQLite stores sessions, artifacts, and threads in generic JSON rows; conversation lists load full thread data, and events/uploads have no cleanup policy. Add expiry/retention and query metadata separately as data grows.
