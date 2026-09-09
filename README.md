# Mia experiments

Independent experiments live in subfolders of this repository.

| Project | Purpose |
| --- | --- |
| [Fieldwork router lab](fieldwork-router-lab/README.md) | Current SvelteKit workspace with Svelte AI Elements, AG-UI, Strands routing, Claude Agent SDK, Codex SDK, file uploads, document exports, and token usage. Runs locally on port 5373. |
| [Claude local lab](claude-agent-local-lab/README.md) | Earlier AgentCore local development experiment with managed tools, approvals, research, and document exports. |
| [Claude AWS POC](claude-agent-poc/README.md) | Terraform and deployment code for the AWS-hosted proof of concept. Deployment remains subject to AWS account verification and service quotas. |

Each project has its own setup instructions and checks. Credentials, local conversations, uploaded/generated documents, dependencies, build output, and Terraform state are excluded from git. Live model tests use the configured API credentials and incur usage charges.
