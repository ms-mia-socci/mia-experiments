# Working in mia-experiments

Keep experiments in their existing subfolders. `fieldwork-router-lab/` is the current Fieldwork app with Strands, Claude Agent SDK, and Codex; read its README before changing it. The earlier local lab and AWS POC are separate projects.

## Documentation indexes

Use these `llms.txt` indexes to find relevant official documentation before implementing or refactoring an integration. Read the specific linked pages needed for the task instead of loading every documentation page. Check examples against the project's installed package versions, and distinguish draft protocol features from supported APIs.

Prefer existing library APIs for streaming, message accumulation, state synchronization, and tool lifecycles before writing custom equivalents. Keep application-specific authorization, persistence, and provider translation where needed.

URLs verified September 9, 2026:

| Technology | Documentation index | Use for |
| --- | --- | --- |
| AG-UI | https://docs.ag-ui.com/llms.txt | Protocol events, client subscriptions, messages, shared state, interrupts, and serialization. |
| Svelte and SvelteKit | https://svelte.dev/llms.txt | Svelte reactivity, components, routing, server endpoints, and framework conventions. |
| Svelte AI Elements | https://svelte-ai-elements.vercel.app/llms.txt | The AI UI component registry used by Fieldwork, including conversation, tool, approval, and input components. |
| AWS Strands Agents | https://strandsagents.com/llms.txt | Agent configuration, TypeScript tools, streaming, sessions, and orchestration. Select the TypeScript documentation for our TypeScript adapter. |
| Claude API and Agent SDK | https://platform.claude.com/llms.txt | Claude Agent SDK, custom tools, permissions, streaming, and model API behavior. |
| OpenAI Codex | https://developers.openai.com/codex/llms.txt | Codex SDK, configuration, MCP, and sandbox behavior. Currently redirects to https://learn.chatgpt.com/docs/llms.txt. |
| OpenAI API | https://developers.openai.com/llms.txt | API endpoints, authentication, model APIs, and other OpenAI platform integration details. |
| Amazon Bedrock AgentCore | https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/llms.txt | Managed Runtime, Memory, Code Interpreter, identity, and AWS integration. |
| Model Context Protocol | https://modelcontextprotocol.io/llms.txt | MCP tool schemas, transports, lifecycle, and authorization used by the agent tool bridges. |

These are documentation references, not evidence that a capability is enabled in our AWS account or implemented in this repository. Verify actual configuration and behavior separately.
