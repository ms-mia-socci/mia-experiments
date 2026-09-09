import {json,error} from '@sveltejs/kit';
import {requireUser,requireOrigin} from '$lib/server/auth';
import {ownedThread,decideApproval} from '$lib/server/store';
import type {RequestHandler} from './$types';
export const POST:RequestHandler=async event=>{
 requireOrigin(event);const user=requireUser(event);await ownedThread(event.params.id,user.id);
 const {id,decision}=await event.request.json();
 if(typeof id!=='string' || !['approved','denied'].includes(decision))error(400,'Invalid decision');
 try{decideApproval(event.params.id,user.id,id,decision);}catch{error(409,'Approval expired, cancelled, or already decided');}
 return json({ok:true});
};
