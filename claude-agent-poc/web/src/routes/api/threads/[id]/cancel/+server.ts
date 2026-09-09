import { json } from '@sveltejs/kit';
import { requireUser,requireOrigin } from '$lib/server/auth';
import { ownedThread,db,table,key,UpdateCommand } from '$lib/server/store';
import type { RequestHandler } from './$types';
export const POST:RequestHandler=async event=>{
  requireOrigin(event);await ownedThread(event.params.id,requireUser(event).id);
  await db.send(new UpdateCommand({TableName:table(),Key:key(event.params.id),UpdateExpression:'SET cancelRequested = :yes',ExpressionAttributeValues:{':yes':true}}));
  return json({ok:true});
};
