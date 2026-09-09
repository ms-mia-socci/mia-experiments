import { json,error } from '@sveltejs/kit';
import { requireUser,requireOrigin } from '$lib/server/auth';
import { ownedThread,db,table,key,TransactWriteCommand } from '$lib/server/store';
import type { RequestHandler } from './$types';
export const POST:RequestHandler=async event=>{
  requireOrigin(event);const user=requireUser(event);
  const thread=await ownedThread(event.params.id,user.id);
  const {id,decision}=await event.request.json();
  if(typeof id!=='string' || !['approved','denied'].includes(decision)) error(400,'Invalid decision');
  try{
    await db.send(new TransactWriteCommand({TransactItems:[
      {ConditionCheck:{TableName:table(),Key:key(event.params.id),ConditionExpression:'#s = :running AND activeRun = :run AND userId = :user',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':running':'running',':run':thread.activeRun,':user':user.id}}},
      {Update:{TableName:table(),Key:key(event.params.id,`APPROVAL#${id}`),UpdateExpression:'SET #s = :decision, decidedBy = :user, decidedAt = :now',ConditionExpression:'#s = :pending AND expiresAt > :now AND runId = :run',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':decision':decision,':user':user.id,':now':Date.now(),':pending':'pending',':run':thread.activeRun}}}
    ]}));
  }catch(e){if((e as {name:string}).name==='TransactionCanceledException') error(409,'Approval expired or already decided');throw e;}
  return json({ok:true});
};
