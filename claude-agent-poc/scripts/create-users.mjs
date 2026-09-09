import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CognitoIdentityProviderClient,AdminCreateUserCommand} from '@aws-sdk/client-cognito-identity-provider';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
process.env.AWS_PROFILE ||= 'ai';process.env.AWS_REGION ||= 'us-east-1';
const output=spawnSync('terraform',['output','-json'],{cwd:root+'/infra',encoding:'utf8'});
if(output.status!==0)throw Error('Deploy the infrastructure first');
const outputs=JSON.parse(output.stdout),pool=outputs.user_pool_id.value;
const emails=process.argv.slice(2);
const client=new CognitoIdentityProviderClient({});
if(!emails.length)throw Error('Provide one or more email addresses');
mkdirSync('.local',{recursive:true,mode:0o700});
const target='.local/logins.json';
const logins=existsSync(target)?JSON.parse(readFileSync(target,'utf8')):{url:outputs.url.value,accounts:[]};
for(const email of emails){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Invalid email');
  const password=randomBytes(20).toString('base64url')+'!aA7';
  const request={UserPoolId:pool,Username:email,TemporaryPassword:password,MessageAction:'SUPPRESS',UserAttributes:[{Name:'email',Value:email},{Name:'email_verified',Value:'true'}]};
  try{await client.send(new AdminCreateUserCommand(request));}
  catch(error){if(error.name==='UsernameExistsException'){console.log(`${email}: already exists; password unchanged`);continue;}throw error;}
  logins.accounts.push({email,temporaryPassword:password,mustChangePassword:true});
  writeFileSync(target,JSON.stringify(logins,null,2),{mode:0o600});
  console.log(`${email}: created without sending email`);
}
console.log('Temporary passwords saved to .local/logins.json (local only, mode 0600).');
