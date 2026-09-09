import type { Handle } from '@sveltejs/kit';
import { verifyToken } from '$lib/server/auth';
export const handle: Handle=async({event,resolve})=>{
  event.locals.user=null;
  const token=event.cookies.get('poc_session');
  if(token){try{event.locals.user=await verifyToken(token);}catch{event.cookies.delete('poc_session',{path:'/'});}}
  const response=await resolve(event);
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy','same-origin');
  response.headers.set('X-Frame-Options','DENY');
  if(event.url.pathname.startsWith('/api/') || event.url.pathname.startsWith('/auth/')) response.headers.set('Cache-Control','no-store');
  return response;
};
