import { mkdirSync } from 'node:fs';
if (!['web', 'agent'].includes(process.env.FIELDWORK_SERVICE)) throw Error('FIELDWORK_SERVICE must be web or agent');
if (process.env.FIELDWORK_SERVICE === 'agent' && process.env.AGENT_OBSERVABILITY_ENABLED === 'true') {
  await import('@aws/aws-distro-opentelemetry-node-autoinstrumentation/register');
}
process.env.HOME = '/tmp/fieldwork-home';
process.env.FIELDWORK_WORKSPACES = '/tmp/fieldwork-workspaces';
process.env.FIELDWORK_MCP_URL = 'http://127.0.0.1:8080/api/agent-tools';
mkdirSync(process.env.HOME, { recursive: true, mode: 0o700 });
mkdirSync(process.env.FIELDWORK_WORKSPACES, { recursive: true, mode: 0o700 });
if (process.env.FIELDWORK_SERVICE === 'agent') {
  const { GetSecretValueCommand, SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const result = await client.send(new GetSecretValueCommand({ SecretId: process.env.FIELDWORK_MODEL_SECRET_ARN }));
  const keys = JSON.parse(result.SecretString);
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_API_ENDPOINT']) {
    if (!keys[key]) throw Error(`Missing ${key} in model credential secret`);
    process.env[key] = keys[key];
  }
  client.destroy();
}
if (process.env.FIELDWORK_SERVICE === 'web' && !process.env.FIELDWORK_RUNTIME_ARN) throw Error('Web service requires AgentCore Runtime');
await import('../build/index.js');
