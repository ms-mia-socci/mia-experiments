import {error} from '@sveltejs/kit';
import {getItem,listItems,getArtifact} from '../../../../shared/store';
export * from '../../../../shared/store';
export async function ownedThread(id:string,userId:string){
 if(!/^[a-f0-9-]{36}$/.test(id))error(404,'Conversation not found');
 const item=getItem(id);if(!item || item.userId!==userId)error(404,'Conversation not found');return item;
}
export async function listThreads(userId:string){return listItems(`USER#${userId}`);}
export async function artifact(id:string,name:string){return getArtifact(id,name);}
