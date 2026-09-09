import {json} from '@sveltejs/kit';
import {requireUser} from '$lib/server/auth';
import {ownedThread,listItems,artifact,getEvents} from '$lib/server/store';
import type {RequestHandler} from './$types';
export const GET:RequestHandler=async event=>{
 const thread=await ownedThread(event.params.id,requireUser(event).id);
 const events=thread.activeRun?getEvents(event.params.id,thread.activeRun):[];
 return json({id:thread.id,status:thread.status,messages:thread.messages,pendingApproval:thread.pendingApproval,usage:thread.usage,updatedAt:thread.updatedAt,audit:listItems(event.params.id,'AUDIT#'),patch:await artifact(event.params.id,'changes.patch')||'',events,documents:listItems(event.params.id,'DOCUMENT#').map(({filename,updatedAt})=>({filename,updatedAt,url:`/api/threads/${event.params.id}/documents/${encodeURIComponent(filename)}`}))});
};
