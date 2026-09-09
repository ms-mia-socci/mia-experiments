import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Opt-in live cloud verification. Creates a temporary Cognito test user without sending email.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const outputs = JSON.parse(readFileSync('.local/aws-deployment.json', 'utf8'));
const base = outputs.url.value, pool = outputs.user_pool_id.value;
function aws(command, payload) {
  const temp = mkdtempSync(join(tmpdir(), 'fieldwork-smoke-'));
  const inputPath = join(temp, 'request.json');
  writeFileSync(inputPath, JSON.stringify(payload), { mode: 0o600 });
  const r = spawnSync('aws', ['cognito-idp', command, '--cli-input-json', `file://${inputPath}`, '--profile', 'medplum', '--region', 'us-east-1', '--output', 'json'], { input: JSON.stringify(payload), encoding: 'utf8' });
  rmSync(temp, { recursive: true, force: true });
  if (r.status !== 0) throw Error(`${command}: ${r.stderr}`);
  return r.stdout ? JSON.parse(r.stdout) : {};
}
const username = `fieldwork-smoke-${Date.now()}@example.invalid`;
const password = `Fw!${randomBytes(24).toString('base64url')}9a`;
let browser;
let createdUser = false;
const created = [];
try {
  aws('admin-create-user', { UserPoolId: pool, Username: username, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: username }, { Name: 'email_verified', Value: 'true' }] });
  createdUser = true;
  aws('admin-set-user-password', { UserPoolId: pool, Username: username, Password: password, Permanent: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole('link', { name: /Sign in to Fieldwork/ }).click();
  await page.locator('input[name="username"]:visible').first().fill(username);
  await page.locator('input[type="password"]:visible').first().fill(password);
  await page.locator('input[type="submit"]:visible, button[type="submit"]:visible').first().click();
  await page.waitForURL(url => url.origin === base && url.pathname === '/', { timeout: 60000 });
  await page.getByRole('button', { name: 'New conversation', exact: true }).waitFor();
  console.log('Cognito OIDC login passed');
  const cookies = (await context.cookies(base)).map(c => `${c.name}=${c.value}`).join('; ');
  async function api(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { cookie: cookies, origin: base, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.ok, true, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
    return response.json();
  }
  await api('/api/memory', 'PATCH', { enabled: true, crossSession: true, shareAcrossAgents: true, usePreferences: true, useSummaries: true });
  async function run(thread, prompt, forwardedProps = {}) {
    let finished = false;
    const stream = fetch(base + `/api/threads/${thread.id}/run`, { method: 'POST', headers: { cookie: cookies, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ threadId: thread.id, runId: randomUUID(), messages: [{ id: randomUUID(), role: 'user', content: prompt }], tools: [], context: [], state: {}, forwardedProps }) }).then(async response => {
      const text = await response.text();
      assert.equal(response.ok, true, `${response.status}: ${text}`);
      return text;
    }).finally(() => { finished = true; });
    // Attach a handler immediately: polling must not cause an unhandled rejection.
    stream.catch(() => {});
    const approved = new Set();
    const deadline = Date.now() + 280000;
    while (!finished && Date.now() < deadline) {
      const current = await api(`/api/threads/${thread.id}`);
      const approval = current.pendingApproval;
      if (approval?.status === 'pending' && !approved.has(approval.id)) {
        approved.add(approval.id);
        await api(`/api/threads/${thread.id}/approval`, 'POST', { id: approval.id, decision: 'approved' });
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    assert.equal(finished, true, 'Run exceeded verification deadline');
    const text = await stream;
    const current = await api(`/api/threads/${thread.id}`);
    assert.equal(current.status, 'complete', JSON.stringify({ status: current.status, tail: text.slice(-1500) }));
    return current;
  }
  for (const framework of ['strands', 'claude', 'codex']) {
    const thread = await api('/api/threads', 'POST', { framework });
    created.push(thread.id);
    const result = await run(thread, 'Use run_python to calculate 6 * 7 and print it. Do not create any files. I prefer concise replies.');
    const tool = result.events.find(e => e.type === 'TOOL_CALL_RESULT' && e.content?.includes('"executed":true'));
    assert.ok(tool, `${framework} did not successfully execute Python: ${JSON.stringify(result.events.filter(e => e.type === 'TOOL_CALL_RESULT'))}`);
    assert.match(JSON.parse(tool.content).stdout, /42/);
    console.log(`${framework}: AgentCore Runtime + approved Code Interpreter execution passed`);
  }
  const routed = await api('/api/threads', 'POST', { framework: null });
  created.push(routed.id);
  const recommendation = await run(routed, 'Route this task to Claude: write a short hello-world explanation and save it as hello.txt.');
  assert.ok(recommendation.recommendation?.framework);
  const final = await run(routed, 'Start', { handoff: 'claude' });
  const doc = final.documents.find(d => d.filename === 'hello.txt');
  assert.ok(doc, 'Approved document missing');
  const response = await fetch(base + doc.url, { headers: { cookie: cookies } });
  assert.equal(response.status, 200);
  assert.ok((await response.text()).length > 0);
  console.log('Strands recommendation, Claude handoff, approved S3 document download passed');
  const memory = await api('/api/memory');
  assert.ok(memory.status?.message?.includes('saved'), JSON.stringify(memory));
  console.log('AgentCore Memory event capture passed');
  await page.reload();
  await page.getByRole('button', { name: 'New conversation', exact: true }).waitFor();
  mkdirSync('.local', { recursive: true });
  await page.screenshot({ path: '.local/aws-verified.png', fullPage: true });
  writeFileSync('.local/aws-verification.json', JSON.stringify({ at: new Date().toISOString(), url: base, frameworks: ['strands','claude','codex'], memoryCapture: true, artifacts: true }, null, 2));
  for (const id of created) await api(`/api/threads/${id}`, 'PATCH', { archived: true });
} finally {
  await browser?.close();
  if (createdUser) aws('admin-delete-user', { UserPoolId: pool, Username: username });
}
