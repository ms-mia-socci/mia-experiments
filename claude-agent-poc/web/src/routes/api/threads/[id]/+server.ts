import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { ownedThread,db,table,key,QueryCommand,artifact } from '$lib/server/store';
import type { RequestHandler } from './$types';
export const GET:RequestHandler=async event=>{
  const thread=await ownedThread(event.params.id,requireUser(event).id);
  const audit=(await db.send(new QueryCommand({TableName:table(),KeyConditionExpression:'pk = :pk AND begins_with(sk, :sk)',ExpressionAttributeValues:{':pk':key(event.params.id).pk,':sk':'AUDIT#'},ScanIndexForward:false,Limit:30}))).Items||[];
  const patch=await artifact(event.params.id,'changes.patch');
  return json({id:thread.id,status:thread.status,messages:thread.messages,pendingApproval:thread.pendingApproval,usage:thread.usage,updatedAt:thread.updatedAt,audit,patch:patch||''});
};
