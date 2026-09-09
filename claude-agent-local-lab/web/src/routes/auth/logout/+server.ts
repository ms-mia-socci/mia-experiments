import {redirect} from '@sveltejs/kit';
import {requireOrigin} from '$lib/server/auth';
import type {RequestHandler} from './$types';
export const POST:RequestHandler=event=>{requireOrigin(event);event.cookies.delete('poc_session',{path:'/'});redirect(303,'/auth/login');};
