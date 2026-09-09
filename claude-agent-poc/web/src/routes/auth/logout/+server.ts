import { env } from '$env/dynamic/private';
import { requireOrigin } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
export const POST: RequestHandler=event=>{
  requireOrigin(event);event.cookies.delete('poc_session',{path:'/'});
  const target=new URL('/logout',env.COGNITO_DOMAIN);
  target.search=new URLSearchParams({client_id:env.COGNITO_CLIENT_ID!,logout_uri:`${event.url.origin}/`}).toString();
  redirect(303,target.href);
};
