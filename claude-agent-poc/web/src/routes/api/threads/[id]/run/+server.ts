import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { RunAgentInputSchema } from '@ag-ui/core';
import { BedrockAgentCoreClient,InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { requireUser,requireOrigin } from '$lib/server/auth';
import { ownedThread,db,table,key,UpdateCommand } from '$lib/server/store';
import type { RequestHandler } from './$types';
const client=new BedrockAgentCoreClient({region:env.AWS_REGION || 'us-east-1',maxAttempts:1});
export const POST:RequestHandler=async event=>{
  requireOrigin(event);const user=requireUser(event);
  const thread=await ownedThread(event.params.id,user.id);
  const raw=await event.request.text();if(raw.length>100_000) error(413,'Message too large');
  const parsed=RunAgentInputSchema.safeParse(JSON.parse(raw));
  if(!parsed.success) error(400,'Invalid AG-UI request');
  const input=parsed.data;
  const message=input.messages.filter(m=>m.role==='user').at(-1);
  if(!message || typeof message.content!=='string' || !message.content.trim() || message.content.length>8000) error(400,'Send a message of 1–8,000 characters');
  const runId=crypto.randomUUID();
  const messages=[...(thread.messages||[]),{role:'user',content:message.content}].slice(-39);
  try{
    await db.send(new UpdateCommand({TableName:table(),Key:key(event.params.id),UpdateExpression:'SET #s = :running, activeRun = :run, runDeadline = :deadline, cancelRequested = :no, messages = :messages, updatedAt = :now, pendingApproval = :null ADD runCount :one',ConditionExpression:'(#s <> :running OR runDeadline < :expired) AND runCount < :limit',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':running':'running',':run':runId,':deadline':Date.now()+300_000,':no':false,':messages':messages,':now':new Date().toISOString(),':null':null,':one':1,':expired':Date.now(),':limit':30}}));
  }catch(e){if((e as {name:string}).name==='ConditionalCheckFailedException') error(409,'Conversation is busy or has reached its 30-run limit');throw e;}
  try{
    const result=await client.send(new InvokeAgentRuntimeCommand({agentRuntimeArn:env.AGENT_RUNTIME_ARN,runtimeSessionId:thread.runtimeSession,contentType:'application/json',accept:'text/event-stream',payload:new TextEncoder().encode(JSON.stringify({threadId:event.params.id,runId,messages:[{id:message.id,role:'user',content:message.content}],state:{},tools:[],context:[],forwardedProps:{}}))}));
    if(!result.response) throw new Error('No agent stream');
    const body=result.response as AsyncIterable<Uint8Array>;
    const iterator=body[Symbol.asyncIterator]();
    const stream=new ReadableStream<Uint8Array>({
      async pull(controller){try{const next=await iterator.next();if(next.done) controller.close();else controller.enqueue(next.value);}catch{controller.error(new Error('Agent connection interrupted. Refresh to recover the session.'));}},
      async cancel(){await iterator.return?.();}
    });
    return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
  }catch(e){
    console.error(JSON.stringify({event:'invoke_failed',threadId:event.params.id,errorType:(e as {name:string}).name}));
    await db.send(new UpdateCommand({TableName:table(),Key:key(event.params.id),UpdateExpression:'SET #s = :error',ConditionExpression:'activeRun = :run',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':error':'error',':run':runId}}));
    error(502,'Unable to start the agent. Please try again.');
  }
};
