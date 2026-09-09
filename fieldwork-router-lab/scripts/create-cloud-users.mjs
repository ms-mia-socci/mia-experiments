import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const outputs = JSON.parse(readFileSync(new URL('.local/aws-deployment.json', root), 'utf8'));
const pool = outputs.user_pool_id.value;
const path = new URL('.local/medplum-login.json', root);
const accounts = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).accounts : [];
for (const [email, name] of [['mia.socci@121.health', 'Mia Socci'], ['tim.ritzema@121.health', 'Tim Ritzema']]) {
  const temporaryPassword = `Fw!${randomBytes(20).toString('base64url')}9a`;
  const temp = mkdtempSync(join(tmpdir(), 'fieldwork-user-'));
  const inputPath = join(temp, 'request.json');
  const payload = { UserPoolId: pool, Username: email, TemporaryPassword: temporaryPassword, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, { Name: 'name', Value: name }] };
  writeFileSync(inputPath, JSON.stringify(payload), { mode: 0o600 });
  const r = spawnSync('aws', ['cognito-idp', 'admin-create-user', '--cli-input-json', `file://${inputPath}`, '--profile', 'medplum', '--region', 'us-east-1', '--output', 'json'], {
    input: JSON.stringify({ UserPoolId: pool, Username: email, TemporaryPassword: temporaryPassword, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, { Name: 'name', Value: name }] }), encoding: 'utf8',
  });
  rmSync(temp, { recursive: true, force: true });
  if (r.status !== 0) {
    if (r.stderr.includes('UsernameExistsException')) { console.log(`${name}: account already exists; password unchanged`); continue; }
    throw Error(`Could not create ${name}: ${r.stderr}`);
  }
  accounts.push({ email, temporaryPassword });
  mkdirSync(new URL('.local/', root), { recursive: true });
  writeFileSync(path, JSON.stringify({ url: outputs.url.value, accounts }, null, 2), { mode: 0o600 });
  console.log(`${name}: account created; invitation email suppressed`);
}
console.log('Temporary passwords are in .local/medplum-login.json. Change them on first sign-in.');
