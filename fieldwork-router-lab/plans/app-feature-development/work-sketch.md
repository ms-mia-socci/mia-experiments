# Application feature development: work sketch

Status: planning research  
Scope: discussion notes for a future implementation plan  
Last updated: 2026-09-09

## Why this feature matters

A common Fieldwork task should be able to start with a product request or Linear ticket and end with a reviewable GitHub pull request:

1. Identify or create the Linear ticket.
2. Select the repository and synchronize its default branch.
3. Create or resume the ticket's feature branch.
4. Research the request and the existing code.
5. Produce and refine an implementation plan.
6. Change the code and tests.
7. Run formatting, tests, builds, and other required checks.
8. Review and refine the result.
9. Commit and push the feature branch.
10. Open a draft pull request linked to the ticket.
11. Observe CI and review feedback and continue the task when necessary.

Fieldwork already has much of the user-facing control plane for this: authentication, conversations, framework routing, AG-UI streaming, approvals, files, memory, observability, and AgentCore Runtime hosting. The main missing capability is a durable, isolated development workspace with governed access to GitHub, Linear, shell commands, and project secrets.

## Product goal

Let an authorized user delegate a normal feature-development workflow to Fieldwork while preserving the controls the organization expects from an engineer's workstation and CI system.

The result should be inspectable throughout the run. A user should always be able to answer:

- Which ticket, repository, base commit, branch, and agent are involved?
- What plan was approved?
- Which files changed, and why?
- Which commands and tests ran?
- Which credentials or named secrets were used?
- What is awaiting approval?
- What was pushed, and where is the pull request?
- Can the task safely resume after the browser or runtime stops?

## Current Fieldwork baseline

Useful pieces already implemented:

- Cognito identity in AWS mode.
- AgentCore Runtime deployment.
- Strands, Claude Agent SDK, and OpenAI Codex adapters.
- An application-owned Strands handoff among the three adapters.
- AG-UI streaming, shared state, tool lifecycles, and approvals.
- PostgreSQL conversation, event, approval, and artifact persistence.
- Private S3-backed uploads and generated artifacts in AWS mode.
- AgentCore Memory with user controls.
- AgentCore Code Interpreter for approved, short-lived Python execution.
- CloudWatch/X-Ray/OpenTelemetry observability.

Important limitations in the current implementation:

- Codex is intentionally read-only and starts with an empty workspace.
- Claude does not have arbitrary shell or repository-write tools.
- Code Interpreter is a fresh Python sandbox per approved call, not a Git repository workspace.
- A run is bounded and relies on a live worker; there is no durable multi-hour job state machine.
- Provider context is reconstructed from a bounded slice of saved messages.
- GitHub, Linear, package registries, and project environment profiles are not connected.
- The current handoff is in-process application orchestration, not A2A.

## Core design idea

Treat each development task as a durable object that owns one isolated workspace:

```text
Fieldwork conversation
        |
        v
Development task record
  - user and policy
  - Linear issue
  - repository and base SHA
  - feature branch
  - approved plan version
  - runtime session
  - checks and approvals
        |
        v
AgentCore Runtime session
        |
        v
/mnt/workspace/repository
        |
        +--> GitHub branch / draft PR
        +--> clean verification runner
```

One conversation may eventually contain multiple development tasks, but the first implementation should keep a one-to-one mapping. That makes ownership, resumption, cleanup, and auditing much clearer.

## AgentCore workspace research

AgentCore Runtime appears capable of being the coding workspace rather than merely hosting the chat adapter:

- Each Runtime session receives an isolated microVM with separate compute, memory, and filesystem resources.
- Agent and deterministic command invocations using the same runtime session share the filesystem and environment.
- MicroVM sessions can run for up to eight hours per compute lifecycle.
- Managed session storage can mount a per-session persistent directory such as `/mnt/workspace` and restore it after stop/resume.
- AWS documents normal development operations such as `git`, `npm`, `pip`, and `cargo` on managed session storage.
- AgentCore also supports asynchronous tasks that continue after the frontend disconnects.

Managed microVM session storage is currently Preview. Its documented lifecycle includes a 14-day idle expiry and reset when the Runtime version changes. Therefore:

- GitHub must remain the durable source of code history.
- PostgreSQL must remain the durable source of workflow state and approvals.
- Important task artifacts and checkpoints should be written to S3 or PostgreSQL.
- Work should be pushed to the task branch at intentional checkpoints after approval.
- Runtime storage loss must be recoverable by cloning the branch and restoring task metadata.

An Instances runtime with a capacity-provider volume may be appropriate later for longer-lived or more demanding workspaces, but it adds operational and isolation considerations. The POC should first determine whether managed microVM session storage and Runtime command execution are enabled and sufficient in the target account.

Research references:

- [AgentCore Runtime sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html)
- [AgentCore Runtime filesystem configurations](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-filesystem-configurations.html)
- [AgentCore Runtime command execution](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-execute-command.html)
- [AgentCore asynchronous and long-running agents](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-long-run.html)
- [AgentCore Runtime security practices](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html)

## Development task lifecycle

The workflow should be explicit state, not something inferred only from chat messages. A first state model could include:

```text
intake
ticket_resolved
workspace_starting
workspace_ready
researching
plan_proposed
plan_approved
implementing
verifying
changes_ready
commit_approved
pushing
pr_open
ci_running
changes_requested
complete
failed
cancelled
```

Transitions should be persisted and idempotent. Retrying after a timeout must not create a second ticket, branch, commit, push, or pull request.

The browser should reconnect to the task record and current Runtime session rather than owning the execution lifecycle. AG-UI remains the live presentation protocol, while the task record remains authoritative when no client is connected.

Questions to resolve:

- Should Step Functions own the coarse workflow, or should the application use a PostgreSQL-backed task queue and workers?
- Which operations belong inside one long-running Runtime invocation, and which should be deterministic commands between agent turns?
- How often should Fieldwork checkpoint by committing or pushing work?
- How should a user recover or fork a task whose workspace cannot be restored?
- What is the maximum workspace lifetime, and what happens before cleanup?

## GitHub connection

Use a GitHub App rather than personal access tokens or GitHub passwords.

The GitHub connection should support:

- Installation on selected organizations and repositories.
- Repository selection limited by both the installation and the current user.
- Reading repository metadata, branches, rules, checks, pull requests, and templates.
- Cloning and fetching repository contents.
- Creating and updating task branches.
- Opening and updating draft pull requests.
- Receiving webhooks for pushes, checks, reviews, merges, and installation changes.
- Suspending work promptly when installation or user authorization is revoked.

Token choice needs an explicit policy:

- Installation tokens attribute automation to the Fieldwork GitHub App.
- User access tokens attribute actions to both the user and the app and also respect the user's permissions.
- Actions performed at a user's request should prefer user access tokens when organizational attribution and authorization require it.
- Tokens must be short-lived, cached only for their valid lifetime, and revoked when the task or connection is removed.

Initial repository permissions likely include:

- Metadata: read.
- Contents: read and write.
- Pull requests: read and write.
- Checks and commit statuses: read.
- Issues: only if GitHub issues become part of the workflow.

The exact set should be validated against the operations used by the POC. Do not request organization-wide administration permissions for convenience.

Research references:

- [GitHub App best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- [Authorizing GitHub Apps](https://docs.github.com/en/apps/using-github-apps/authorizing-github-apps)
- [GitHub pull request API](https://docs.github.com/en/rest/pulls/pulls)

## Linear connection

Use a Linear OAuth application for interactive users. Consider client-credentials authorization only for explicitly approved service automation.

The Linear tool surface should support:

- Resolve an issue by identifier or URL.
- Search issues visible to the current user.
- Read the title, description, acceptance criteria, comments, labels, project, and attachments.
- Create an issue after user approval when none exists.
- Derive the canonical branch name.
- Add the GitHub branch and PR links.
- Transition issue state according to workspace policy.
- Receive verified webhooks for relevant issue changes and revoked authorization.

The first vertical slice can require an existing Linear issue URL. Ticket creation, search, automatic transitions, and webhook synchronization can follow after the GitHub loop works.

Research references:

- [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication)
- [Linear GraphQL API](https://linear.app/developers/graphql)
- [Linear webhooks](https://linear.app/developers/webhooks)

## Repository environment definition

Supporting arbitrary repositories requires more than cloning source. A project profile must describe how to create a useful development environment.

Candidate project settings:

- Repository and default base branch.
- Allowed feature-branch pattern.
- Runtime/toolchain image or supported language family.
- Working directory for a monorepo.
- Package manager and dependency install command.
- Bootstrap command.
- Format, lint, type-check, unit-test, integration-test, and build commands.
- Required checks before commit, push, and PR creation.
- Permitted outbound network destinations.
- Private package registries.
- Paths that must not be changed.
- Resource limits: CPU, memory, storage, time, and model/tool budget.
- Environment profiles available to the repository.
- Approval policy.

Possible configuration sources, in precedence order:

1. Organization policy that a repository cannot override.
2. Centrally managed Fieldwork project configuration.
3. A reviewed, versioned repository file such as `.fieldwork/project.yml`.
4. Task-specific user choices allowed by policy.

Repository instructions are untrusted input. A checked-in configuration file can request commands, but the server must enforce organization limits independently.

Open questions:

- Do we support `devcontainer.json`, or maintain a smaller catalog of approved Runtime images?
- How do repositories that require Docker services run integration tests?
- Are databases and dependent services provisioned per task, shared in a test environment, or delegated to CI?
- Which toolchains must the first POC image contain?
- How are dependency caches keyed, scanned, and invalidated?

## Environment variables and secrets

Environment management should be a first-class feature rather than a free-form `.env` text box.

### Configuration classes

| Class | Suggested source | Examples |
| --- | --- | --- |
| Public/project configuration | Versioned project config, database, or AppConfig | base URL, test feature flag |
| Non-secret environment values | Parameter Store or project settings | test tenant ID, region |
| Secrets | Secrets Manager | database password, registry token |
| External user authorization | AgentCore Identity or provider token broker | GitHub, Linear |
| AWS authorization | Runtime/task IAM role and short-lived STS credentials | S3 or test-service access |

### Desired settings experience

A project environment screen should show:

- Variable name and human-readable purpose.
- Secret versus non-secret classification.
- Owning organization, project, user, or task.
- Environment, such as local, development, test, or production.
- Source reference without displaying the secret value.
- Which agents, tools, and commands may receive it.
- Whether it is required.
- Rotation or expiry information.
- Last use metadata and audit link.

At task start, Fieldwork should resolve the selected environment profile and report missing requirements before implementation begins. A missing secret should create a structured request rather than inviting the user to paste the value into chat.

### Injection rules

- Do not place secret values in prompts, chat history, memory, task metadata, AG-UI events, traces, or generated artifacts.
- Prefer process-level injection into only the command that needs the value.
- Avoid materializing a `.env` file. If a tool absolutely requires one, create it only inside the isolated workspace for the shortest possible period and remove it afterward.
- Block secret environment names from client-visible SvelteKit variables such as `PUBLIC_*`.
- Redact known values and common credential patterns from stdout, stderr, tool results, and telemetry.
- Scan diffs and commits before push for credentials and `.env` files.
- Use short-lived registry, GitHub, Linear, database, and AWS credentials wherever possible.
- Make production secrets unavailable to development agents by default.
- Require an explicit reason and stronger approval for any exceptional sensitive-environment access.

There is an unavoidable boundary: code that can use a credential can attempt to read, print, or transmit it. Secret safety therefore depends on least privilege, short lifetimes, isolated sessions, restricted egress, test-only resources, redaction, and audit. Merely hiding the value from the model UI is insufficient.

## Governed coding tools

All agent frameworks should use one authorization and audit layer even if their SDK adapters differ.

Candidate tool groups:

### Repository inspection

- `repository_status`
- `repository_search`
- `read_file`
- `list_files`
- `read_diff`
- `read_history`

### Workspace changes

- `write_file`
- `apply_patch`
- `delete_file`
- `move_file`

### Commands and verification

- `run_command`
- `run_project_check`
- `run_test_suite`
- `run_clean_verification`

### Source control

- `fetch_repository`
- `create_or_resume_branch`
- `rebase_or_merge_base`
- `create_commit`
- `push_branch`
- `open_or_update_pull_request`

### Work management

- `get_linear_issue`
- `search_linear_issues`
- `create_linear_issue`
- `update_linear_issue`
- `link_pull_request`

The names are illustrative. Before implementation, compare them with native SDK, GitHub, Linear, AgentCore, MCP, and AG-UI APIs and avoid wrapping capabilities without a policy or translation reason.

A coding agent needs broad command flexibility, so a small command allowlist alone will not support real repositories. Control should combine:

- Per-session microVM isolation.
- A non-root runtime identity where supported.
- A tightly scoped Runtime execution role.
- Network egress policy.
- Resource and time limits.
- Project policy and approval rules.
- Complete command and outcome auditing.
- Separate clean verification.

## Research and planning

Research should be distinguishable from implementation:

- Repository research: code search, architecture, tests, dependency versions, recent history, and related changes.
- Ticket research: issue text, comments, linked documents, and acceptance criteria.
- External research: current official documentation with citations, when permitted.
- Organizational context: applicable project conventions, prior decisions, and approved memories.

The resulting plan should be a versioned task artifact with:

- Goal and non-goals.
- Current behavior and relevant code paths.
- Proposed approach.
- Files or components likely to change.
- Data, API, and migration implications.
- Test strategy.
- Operational and security considerations.
- Risks and unresolved questions.

Users should be able to comment, edit, ask for revisions, and approve a specific plan version. The task record should identify which plan version governed the implementation. Later agent reasoning may refine execution details, but a material scope change should return to plan review.

## Approvals

Approvals should sit at meaningful policy boundaries rather than interrupt every routine command.

Candidate approval points:

- Create a new Linear ticket.
- Accept the implementation plan.
- Grant a task access to a sensitive named secret or environment.
- Run a command classified as high risk by policy.
- Make a destructive or broad repository change.
- Commit the finished change.
- Push the branch.
- Open or update a pull request.

Organization profiles could allow routine actions automatically in a test repository while requiring additional approval in sensitive repositories. Approvals must bind to the exact task, actor, repository, branch, operation, and relevant content hash so an approval cannot authorize later altered work.

## Git behavior

The implementation must handle more than the happy path:

- Record the immutable base SHA used to begin work.
- Fetch before creating or resuming a branch.
- Detect an existing local or remote ticket branch.
- Confirm the remote branch and PR before retrying a mutation.
- Detect when the base branch advances.
- Present merge or rebase conflicts as structured task state.
- Never force-push unless repository policy allows it and the user explicitly approves.
- Never push directly to a protected base branch.
- Respect signing, DCO, commit-message, branch-name, and PR-template policies.
- Detect changes made to the branch outside Fieldwork.
- Start with draft pull requests.

A pull request description should include the Linear issue, approved-plan summary, implementation summary, tests run, unresolved risks, and Fieldwork task/audit reference.

## Test and verification model

Use two layers of verification:

1. Fast feedback inside the development workspace while the agent iterates.
2. An authoritative clean run against the exact pushed commit before or immediately after opening the PR.

The clean runner could be AWS CodeBuild or the repository's existing GitHub Actions workflow. CodeBuild is attractive when Fieldwork needs an AWS-controlled preflight environment; GitHub Actions should remain authoritative when that is already the repository's merge gate.

Verification results should be structured data, not only terminal text:

- Command and suite name.
- Commit SHA.
- Start/end time and duration.
- Exit status.
- Counts of passed, failed, and skipped tests when available.
- Links to full logs and artifacts.
- Redaction status.
- Whether the run used the clean or iterative environment.

Questions to resolve:

- Do we reproduce the repository's CI locally, trigger CI remotely, or both?
- What is the minimum required clean check before a PR may be opened?
- Can the agent automatically fix a failed check, or must the user approve another iteration?
- How are flaky tests represented?
- How are test databases and other integration dependencies supplied?

## User experience additions

### Connections

- GitHub App installation and user authorization.
- Linear OAuth connection.
- Package registry and other approved provider connections.
- Clear connection status, scope, expiry, and revocation.

### Projects

- Repository selection and default branch.
- Linear team/project mapping.
- Environment profiles.
- Build and test commands.
- Runtime/toolchain selection.
- Repository policy and required approvals.

### Development task workspace

- Ticket, repository, branch, base SHA, agent, and status.
- Plan and plan history.
- Current activity and commands.
- Changed-file list and rendered diff.
- Test and clean-verification results.
- Pending approvals.
- Commit history and PR status.
- Resume, stop, archive, and cleanup controls.

### Administration

- Allowed organizations and repositories.
- Agent and model availability.
- Budgets and quotas.
- Environment and secret policy.
- Egress policy.
- Audit search and retention.

## Agent routing and handoff

The existing application-owned handoff is sufficient for the initial feature. A2A would add value only if Strands, Claude, and Codex become separately deployed services with independent ownership, discovery, task lifecycles, or scaling requirements.

The handoff should pass a structured task envelope rather than rely on transcript prose:

```text
task ID
user and authorization context
Linear issue ID and snapshot
repository ID
base SHA
branch name
workspace/session ID
approved plan ID and version
project policy version
available tools and environment profile
```

All agents working on the same task need access to the same repository state or an explicit patch/commit handoff. With the current single Runtime containing all adapters, one session workspace is the simplest POC architecture.

## Security and compliance concerns

Repository contents, issue descriptions, pull request comments, dependency documentation, command output, uploaded files, and web pages are all untrusted inputs. They may contain instructions designed to make the agent disclose data or bypass policy.

Controls to research and design before enabling writable repositories:

- Server-side authorization for every external mutation.
- Session-to-user ownership enforced by Fieldwork; AgentCore does not enforce that mapping.
- Least-privilege Runtime and integration roles.
- Egress allowlists and VPC endpoints where appropriate.
- Secret and sensitive-data detection before prompts, logs, commits, and pushes.
- Dependency, SAST, license, and malware scanning appropriate to the repository.
- Audit events for GitHub, Linear, secrets, commands, files, agents, and approvals.
- Cleanup and retention policies for workspaces, logs, plans, and task artifacts.
- Limits on repository size, file counts, command duration, process count, and output volume.

Hosting the agent on AWS does not by itself place direct Anthropic, OpenAI, GitHub, Linear, registry, or telemetry traffic under an AWS BAA. Each external data path and provider agreement must be evaluated before regulated data is allowed.

## Reliability cases to design deliberately

- Browser closes during a run.
- Runtime invocation times out while work continues.
- Runtime session stops and resumes.
- Runtime version update removes managed session storage.
- GitHub or Linear token expires mid-operation.
- GitHub webhook arrives more than once or out of order.
- Agent crashes after a push but before Fieldwork records it.
- Agent creates a commit but the push fails.
- A PR already exists for the branch.
- User revokes a provider connection.
- Main advances or the branch is modified externally.
- Clean verification disagrees with workspace tests.
- User cancels while a command or remote mutation is running.

## Suggested first vertical slice

The first useful proof should complete the entire loop with narrow scope:

1. One GitHub organization and one test repository.
2. Existing Linear issue supplied by URL; no issue creation yet.
3. One approved Node/TypeScript Runtime image.
4. One development task mapped to one AgentCore Runtime session.
5. Managed session storage mounted at `/mnt/workspace`, if enabled in the account.
6. Clone the default branch and create the Linear-named branch.
7. Codex receives governed read, write, and command capabilities.
8. Claude may perform cited external research when the user requests it.
9. Strands selects the agent and creates the structured task handoff.
10. A versioned implementation plan requires approval.
11. The user can inspect the diff and test results.
12. Commit, push, and draft-PR creation require explicit approval.
13. A clean verification runs against the pushed commit.
14. The PR and CI status appear in the Fieldwork task.
15. Only test environment variables and narrowly scoped credentials are available.

This slice proves the value of AWS-hosted development rather than only proving that an agent can chat or run a Python snippet.

## Likely follow-up increments

### Increment 2

- Linear search and ticket creation.
- Automatic issue/branch/PR linking and status updates.
- GitHub and Linear webhook synchronization.
- Project settings and environment profiles.
- Secrets Manager and AgentCore Identity brokerage.
- Review-comment and CI-failure iteration.

### Increment 3

- Multiple repositories and monorepos.
- Multiple approved toolchain images.
- Integration-test dependencies and preview environments.
- Organization-wide policy management.
- Workspace pooling and cache optimization.
- Richer security checks and evaluation metrics.
- Separate agent services and A2A only if their operational boundaries justify it.

## Metrics for the POC

- Percentage of tasks that reach a valid draft PR.
- Percentage of clean verification runs that pass.
- Median user interventions per task.
- Time from ticket intake to first reviewable diff and PR.
- Rate of workspace recovery after disconnect or runtime restart.
- Duplicate or inconsistent external mutations; target zero.
- Secret-detection or policy-block events.
- Agent, Runtime, storage, and verification cost per task.
- Human acceptance rate of proposed plans and resulting pull requests.

## Decisions that can wait

- A2A between agent frameworks.
- Autonomous merging.
- Production environment access.
- Multi-repository changes in one task.
- Fully general user-supplied containers.
- Long-lived shared workspaces.
- Automatic deployment after merge.

## Decisions needed before an implementation plan

1. Which test GitHub organization and repository will be used?
2. Should GitHub mutations be attributed to the user, the Fieldwork app, or vary by operation?
3. Which Linear workspace/team and branch naming convention apply?
4. Is AgentCore managed session storage enabled and acceptable despite Preview status?
5. Which toolchain and repository type should the first Runtime image support?
6. What commands constitute the repository's required verification?
7. Which network destinations must the workspace reach?
8. Which test-only environment values and secrets are required?
9. Which operations require approval in the first POC?
10. Should clean verification use CodeBuild, GitHub Actions, or both?
11. How long should inactive task workspaces and audit artifacts persist?
12. What data classifications are explicitly prohibited during the POC?

