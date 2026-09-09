import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const table = process.env.SESSION_TABLE!;
export const key = (thread: string, sk = 'META') => ({pk: `THREAD#${thread}`,sk});
export async function getItem(thread: string, sk = 'META') {
  return (await db.send(new GetCommand({TableName:table,Key:key(thread,sk),ConsistentRead:true}))).Item;
}
export async function putItem(thread: string, sk: string, data: Record<string,unknown>) {
  await db.send(new PutCommand({TableName:table, Item:{...key(thread,sk),...data,ttl:Math.floor(Date.now()/1000)+604800}}));
}
export async function updateMeta(thread: string, data: Record<string,unknown>) {
  const entries = Object.entries(data);
  await db.send(new UpdateCommand({TableName:table, Key:key(thread), UpdateExpression:'SET '+entries.map((_,i)=>`#k${i} = :v${i}`).join(', '),ExpressionAttributeNames:Object.fromEntries(entries.map(([k],i)=>[`#k${i}`,k])),ExpressionAttributeValues:Object.fromEntries(entries.map(([,v],i)=>[`:v${i}`,v]))}));
}
export async function saveArtifact(thread: string, name: string, body: string) {
  await s3.send(new PutObjectCommand({Bucket:process.env.ARTIFACT_BUCKET,Key:`${thread}/${name}`,Body:body,ContentType:name.endsWith('.json')?'application/json':'text/plain'}));
}
export async function getArtifact(thread: string, name: string) {
  try { return await (await s3.send(new GetObjectCommand({Bucket:process.env.ARTIFACT_BUCKET,Key:`${thread}/${name}`}))).Body?.transformToString(); }
  catch (error) { if ((error as {name:string}).name === 'NoSuchKey') return undefined; throw error; }
}
