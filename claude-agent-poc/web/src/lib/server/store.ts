import { env } from '$env/dynamic/private';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { error } from '@sveltejs/kit';
export const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:env.AWS_REGION || 'us-east-1'}));
export const table=()=>env.SESSION_TABLE;
export const key=(id:string,sk='META')=>({pk:`THREAD#${id}`,sk});
export async function ownedThread(id:string,userId:string){
  if(!/^[a-f0-9-]{36}$/.test(id)) error(404,'Conversation not found');
  const item=(await db.send(new GetCommand({TableName:table(),Key:key(id),ConsistentRead:true}))).Item;
  if(!item || item.userId!==userId || item.ttl<Math.floor(Date.now()/1000)) error(404,'Conversation not found');
  return item;
}
export async function listThreads(userId:string){
  return (await db.send(new QueryCommand({TableName:table(),KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':`USER#${userId}`},ScanIndexForward:false,Limit:30}))).Items||[];
}
export async function createThread(userId:string){
  const id=crypto.randomUUID(), now=new Date().toISOString(),ttl=Math.floor(Date.now()/1000)+604800;
  const item={...key(id),id,userId,runtimeSession:crypto.randomUUID(),status:'ready',messages:[],createdAt:now,updatedAt:now,ttl,runCount:0};
  await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table(),Item:item,ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:table(),Item:{pk:`USER#${userId}`,sk:now+'#'+id,id,createdAt:now,ttl}}}]}));
  return item;
}
export async function artifact(id:string,name:string){
  try{return await (await new S3Client({region:env.AWS_REGION || 'us-east-1'}).send(new GetObjectCommand({Bucket:env.ARTIFACT_BUCKET,Key:`${id}/${name}`}))).Body?.transformToString();}
  catch(e){if((e as {name:string}).name==='NoSuchKey') return undefined;throw e;}
}
export {GetCommand,QueryCommand,UpdateCommand,TransactWriteCommand};
