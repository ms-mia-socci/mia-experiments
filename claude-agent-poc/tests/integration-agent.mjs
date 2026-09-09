// Explicit live integration test: uses Anthropic and the POC's AWS storage.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,PutCommand,GetCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
process.env.AWS_PROFILE ||= 'ai';process.env.AWS_REGION ||= 'us-east-1';
const table='claude-agent-poc',bucket='claude-agent-poc-700002442063-artifacts';
const db=DynamoDBDocumentClient.from(new DynamoDBClient({})),s3=new S3Client({});
const key=parseEnv(readFileSync('../.env','utf8')).ANTHROPIC_API_KEY;
const server=spawn('node',['agent/dist/server.js'],{env:{...process.env,PORT:'8081',SAMPLE_DIR:resolve('sample'),SESSION_TABLE:table,ARTIFACT_BUCKET:bucket,ANTHROPIC_API_KEY:key},stdio:['ignore','pipe','pipe']});
server.stdout.on('data',chunk=>process.stdout.write(chunk));server.stderr.on('data',chunk=>process.stderr.write(chunk));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const metaKey=id=>({pk:`THREAD#${id}`,sk:'META'});
async function getMeta(id){return (await db.send(new GetCommand({TableName:table,Key:metaKey(id),ConsistentRead:true}))).Item;}
async function run(decision,id=randomUUID(),prompt='Find and fix the shipping bug. Run the tests before and after the change.'){
  const runId=randomUUID(),old=await getMeta(id);
  const messages=[...(old?.messages||[]),{role:'user',content:prompt}];
  await db.send(new PutCommand({TableName:table,Item:{...metaKey(id),id,userId:'integration-test',runtimeSession:old?.runtimeSession||randomUUID(),status:'running',activeRun:runId,messages,ttl:Math.floor(Date.now()/1000)+3600}}));
  const response=await fetch('http://127.0.0.1:8081/invocations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:id,runId,messages:[{id:randomUUID(),role:'user',content:prompt}],state:{},tools:[],context:[],forwardedProps:{}})});
  assert.equal(response.status,200);
  let buffer='',approvals=0,artifact,terminal;const text=[];
  const decoder=new TextDecoder();
  for await(const chunk of response.body){
    buffer+=decoder.decode(chunk,{stream:true});
    const blocks=buffer.split('\n\n');buffer=blocks.pop();
    for(const block of blocks){
      const line=block.split('\n').find(x=>x.startsWith('data:'));
      if(!line)continue;
      const event=JSON.parse(line.slice(5));
      if(event.type==='TEXT_MESSAGE_CONTENT')text.push(event.delta);
      if(event.type==='TOOL_CALL_START')console.log('Tool:',event.toolCallName);
      if(event.type==='CUSTOM' && event.name==='approval_requested'){
        approvals++;
        await db.send(new UpdateCommand({TableName:table,Key:{pk:`THREAD#${id}`,sk:`APPROVAL#${event.value.id}`},UpdateExpression:'SET #s = :s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':decision}}));
      }
      if(event.type==='CUSTOM' && event.name==='artifact')artifact=event.value;
      if(event.type==='RUN_ERROR' || event.type==='RUN_FINISHED')terminal=event;
    }
  }
  console.log(JSON.stringify({id,decision,approvals,terminal:terminal?.type,text:text.join('').slice(-500),tests:artifact?.tests?.passed}));
  assert.equal(terminal?.type,'RUN_FINISHED');
  return {id,artifact,approvals,text:text.join('')};
}
try{
  for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:8081/ping')).ok)break;}catch{}await pause(100);}
  const approved=await run('approved');
  assert.equal(approved.approvals,1);assert.equal(approved.artifact.tests.passed,true);assert.match(approved.artifact.patch,/freeShippingThreshold/);
  const continued=await run('approved',approved.id,'Run the tests again and tell me the current free shipping threshold. Do not change any files.');
  assert.equal(continued.approvals,0);assert.equal(continued.artifact.tests.passed,true);
  const denied=await run('denied');
  assert.equal(denied.approvals,1);assert.equal(denied.artifact.tests.passed,false);assert.equal(denied.artifact.patch,'');
  const saved=await s3.send(new GetObjectCommand({Bucket:bucket,Key:`${approved.id}/shipping.json`}));
  assert.equal(JSON.parse(await saved.Body.transformToString()).freeShippingThreshold,50);
  console.log('PASS: live SDK tools, approval, denial, follow-up, isolated workspace, and saved patch.');
}finally{server.kill('SIGTERM');}
