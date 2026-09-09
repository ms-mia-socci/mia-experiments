import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
const local=resolve(root,'.local');mkdirSync(local,{recursive:true,mode:0o700});
const home=resolve(local,'home');mkdirSync(home,{recursive:true,mode:0o700});
const key=parseEnv(readFileSync(resolve(root,'../.env'),'utf8')).ANTHROPIC_API_KEY;
if(!key)throw new Error('The parent .env is missing ANTHROPIC_API_KEY');
const agentPort=Number(process.env.LAB_AGENT_PORT||8181),webPort=Number(process.env.LAB_WEB_PORT||5273);
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('AWS_')&&!name.startsWith('ANTHROPIC_')&&!name.startsWith('CLAUDE_')));
const internalToken=randomBytes(32).toString('base64url');
const common={...safeEnv,LAB_BROWSER_EXECUTABLE:chromium.executablePath(),HOME:home,AWS_EC2_METADATA_DISABLED:'true',AWS_CONFIG_FILE:resolve(local,'empty-aws-config'),AWS_SHARED_CREDENTIALS_FILE:resolve(local,'empty-aws-credentials'),AGENTCORE_SKIP_INSTALL:'1',LAB_DB:resolve(local,'lab.sqlite'),LAB_INTERNAL_TOKEN:internalToken,LAB_AGENT_URL:`http://127.0.0.1:${agentPort}`};
writeFileSync(common.AWS_CONFIG_FILE,'',{mode:0o600});writeFileSync(common.AWS_SHARED_CREDENTIALS_FILE,'',{mode:0o600});
const children=[];let stopping=false;
function start(name,args,env,cwd=root){
 const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit',detached:true});children.push(child);
 child.on('exit',code=>{if(!stopping){console.error(`${name} stopped (${code}).`);stop(code||1);}});return child;
}
function stop(code=0){if(stopping)return;stopping=true;for(const child of children){try{process.kill(-child.pid,'SIGTERM');}catch{}}setTimeout(()=>process.exit(code),500);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
start('AgentCore dev',['node_modules/@aws/agentcore/dist/cli/index.mjs','dev','--runtime','ClaudeAgui','--port',String(agentPort),'--logs'],{...common,ANTHROPIC_API_KEY:key,SAMPLE_DIR:resolve(root,'sample'),WORKSPACE_ROOT:resolve(local,'workspaces')});
let ready=false;
for(let i=0;i<120;i++){
 try{ready=(await fetch(`${common.LAB_AGENT_URL}/ping`)).ok;}catch{}
 if(ready)break;await new Promise(r=>setTimeout(r,500));
}
if(!ready){stop(1);throw new Error('AgentCore dev did not start; see logs above.');}
start('SvelteKit',[resolve(root,'node_modules/vite/bin/vite.js'),'dev','--host','127.0.0.1','--port',String(webPort),'--strictPort'],common,resolve(root,'web'));
console.log(`\nLocal lab: http://127.0.0.1:${webPort}\nAgentCore dev: http://127.0.0.1:${agentPort}\nNo AWS credentials or deployment targets are configured.\n`);
