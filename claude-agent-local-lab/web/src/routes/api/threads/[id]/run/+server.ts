import {env} from '$env/dynamic/private';
import {error} from '@sveltejs/kit';
import {RunAgentInputSchema} from '@ag-ui/core';
import {requireUser,requireOrigin} from '$lib/server/auth';
import {ownedThread,beginRun,updateMeta} from '$lib/server/store';
import type {RequestHandler} from './$types';
export const POST:RequestHandler=async event=>{
 requireOrigin(event);const user=requireUser(event);await ownedThread(event.params.id,user.id);
 const raw=await event.request.text();if(raw.length>100000)error(413,'Message too large');
 let body;try{body=JSON.parse(raw);}catch{error(400,'Invalid JSON');}
 const parsed=RunAgentInputSchema.safeParse(body);if(!parsed.success)error(400,'Invalid AG-UI request');
 const message=parsed.data.messages.filter(m=>m.role==='user').at(-1);
 if(!message || typeof message.content!=='string' || !message.content.trim() || message.content.length>8000)error(400,'Send a message of 1–8,000 characters');
 let run;try{run=beginRun(event.params.id,user.id,message.content);}catch{error(409,'Conversation is busy or has reached its limit');}
 try{
  const response=await fetch(`${env.LAB_AGENT_URL}/invocations`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream','Authorization':`Bearer ${env.LAB_INTERNAL_TOKEN}`},body:JSON.stringify({threadId:event.params.id,runId:run.activeRun,messages:[{id:message.id,role:'user',content:message.content}],state:{},tools:[],context:[],forwardedProps:{}})});
  if(!response.ok || !response.body)throw new Error('Agent returned '+response.status);
  return new Response(response.body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
 }catch{updateMeta(event.params.id,{status:'error'});error(502,'Local agent unavailable. Check the agentcore dev terminal.');}
};
