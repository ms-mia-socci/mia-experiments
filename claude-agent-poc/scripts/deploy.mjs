import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {SecretsManagerClient,PutSecretValueCommand} from '@aws-sdk/client-secrets-manager';
const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
process.env.AWS_PROFILE ||= 'ai';process.env.AWS_REGION ||= 'us-east-1';
function run(command,args,cwd=root,capture=false,input){
  const result=spawnSync(command,args,{cwd,encoding:'utf8',env:process.env,input,stdio:capture||input!==undefined?['pipe','pipe','pipe']:'inherit'});
  if(result.status!==0){if(result.stderr)console.error(result.stderr);throw new Error(`${command} failed`);}
  return result.stdout;
}
run('npm',['run','check']);run('npm',['test']);
const bootstrap=resolve(root,'infra/bootstrap'),infra=resolve(root,'infra');
run('terraform',['init','-input=false'],bootstrap);
run('terraform',['plan','-input=false','-out=bootstrap.tfplan'],bootstrap);
run('terraform',['apply','-input=false','bootstrap.tfplan'],bootstrap);
const foundation=JSON.parse(run('terraform',['output','-json'],bootstrap,true));
const key=parseEnv(readFileSync(resolve(root,'../.env'),'utf8')).ANTHROPIC_API_KEY;
if(!key) throw new Error('Root .env is missing ANTHROPIC_API_KEY');
await new SecretsManagerClient({}).send(new PutSecretValueCommand({SecretId:foundation.secret_arn.value,SecretString:key}));
const tag=process.argv[2] || `poc-${new Date().toISOString().replace(/[^0-9]/g,'')}`;
const repos=foundation.repositories.value;
const password=run('aws',['ecr','get-login-password'],root,true);
run('docker',['login','--username','AWS','--password-stdin',repos.agent.split('/')[0]],root,true,password);
for(const target of ['agent','web']){
  run('docker',['build','--platform','linux/arm64','--provenance=false','-f',`${target}/Dockerfile`,'-t',`${repos[target]}:${tag}`,'.']);
  run('docker',['push',`${repos[target]}:${tag}`]);
}
writeFileSync(resolve(infra,'deployment.auto.tfvars'),`image_tag = ${JSON.stringify(tag)}\n`,{mode:0o600});
run('terraform',['init','-input=false'],infra);
run('terraform',['plan','-input=false','-out=deployment.tfplan'],infra);
run('terraform',['apply','-input=false','deployment.tfplan'],infra);
const outputs=JSON.parse(run('terraform',['output','-json'],infra,true));
mkdirSync('.local',{recursive:true,mode:0o700});
writeFileSync('.local/deployment.json',JSON.stringify(outputs,null,2),{mode:0o600});
console.log(`Deployed: ${outputs.url.value}`);
