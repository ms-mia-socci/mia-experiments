# Mia experiments

Experiments in giving users a shared web workspace for managed AI agents. Each project lives in its own subfolder with separate dependencies, configuration, and runtime state.

## Fieldwork router lab — current workspace

[Project README and setup](fieldwork-router-lab/README.md) · Local port **5373**

A SvelteKit app built with Svelte AI Elements and AG-UI. Users choose Claude Agent SDK, OpenAI Codex SDK, or AWS Strands directly—or describe a task to the Strands coordinator, which recommends a framework and hands over the conversation when they accept.

The workspace includes streaming responses, tool activity, cited sources, file uploads, conversation history, and token/context usage where the SDK reports it. Claude and Strands can create documents with approval, including HTML and PDF exports. Uploaded images, text files, and text-based PDFs work across all three adapters and stay with the conversation through handoffs.

**Status:** Working local multi-agent prototype with real API calls, selectable demo identities, and local storage. Strands uses Anthropic directly; this project does not yet deploy the agents to AWS. Start here to explore the latest UI and agent integrations.

## Claude AgentCore local lab — first end-to-end lab

[Project README and setup](claude-agent-local-lab/README.md) · Local port **5273**

The first Fieldwork interface connects SvelteKit to Claude Agent SDK through AG-UI and AWS's `agentcore dev` runtime. It supports web research, approved document exports, and a sample shipping-configuration investigation: Claude reads the project, runs managed tests, proposes a fix, and waits for approval before changing the file.

**Status:** Working local experiment for testing AgentCore development, streaming, tool controls, approvals, and conversation-scoped workspaces. It remains independent of the newer router lab and the cloud stack; local execution does not prove AWS-hosted execution.

## Claude AWS POC — cloud hosting experiment

[Project README and deployment instructions](claude-agent-poc/README.md)

The AWS deployment project pairs a SvelteKit frontend and Cognito sign-in with Claude Agent SDK in an AgentCore Runtime container. Terraform defines the supporting infrastructure, including ECS, CloudFront, DynamoDB, S3, IAM, and Secrets Manager integration. The agent calls Anthropic using an API key.

The intended demo is a controlled shipping-project repair: inspect files, run trusted tests, approve the exact proposed configuration change, and download the resulting patch. This tests the path toward centrally hosted agents with user ownership and managed tools.

**Status:** Infrastructure and deployment code are checked in. Full cloud validation remains pending resolution of the AWS account verification and service-quota blockers encountered during setup.

## Working in this repository

Follow each project's README for installation, credentials, and checks. Keep experiments in separate subfolders so changes to one do not affect another.

Credentials, local conversations, uploaded/generated documents, dependencies, build output, and Terraform state are excluded from git. Live model tests use configured API credentials and incur usage charges. These are prototypes, not production deployments or validated BAA-covered environments.
