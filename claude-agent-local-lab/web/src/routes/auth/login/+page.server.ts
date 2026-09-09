import {randomBytes} from 'node:crypto';
import {error,redirect} from '@sveltejs/kit';
import {requireOrigin} from '$lib/server/auth';
import {putItem} from '$lib/server/store';
import type {Actions} from './$types';
export const actions:Actions={default:async event=>{
 requireOrigin(event);const form=await event.request.formData();const user=form.get('user');
 if(user!=='mia' && user!=='tim')error(400,'Choose a demo identity');
 const token=randomBytes(32).toString('base64url');
 putItem('AUTH',token,{userId:user,email:`${user}@local.lab`,expiresAt:Date.now()+86400000});
 event.cookies.set('poc_session',token,{path:'/',httpOnly:true,secure:false,sameSite:'strict',maxAge:86400});
 redirect(303,'/');
}};
