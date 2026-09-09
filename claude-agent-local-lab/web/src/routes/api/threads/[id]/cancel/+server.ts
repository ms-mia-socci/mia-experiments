import {json} from '@sveltejs/kit';
import {requireUser,requireOrigin} from '$lib/server/auth';
import {ownedThread,updateMeta} from '$lib/server/store';
import type {RequestHandler} from './$types';
export const POST:RequestHandler=async event=>{requireOrigin(event);await ownedThread(event.params.id,requireUser(event).id);updateMeta(event.params.id,{cancelRequested:true});return json({ok:true});};
