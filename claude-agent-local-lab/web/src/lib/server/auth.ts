import {error,type RequestEvent} from '@sveltejs/kit';
import {getItem} from '../../../../shared/store';
export async function verifyToken(token:string){
 const item=getItem('AUTH',token);
 if(!item || item.expiresAt<Date.now())throw new Error('Session expired');
 return {id:item.userId,email:item.email};
}
export function requireUser(event:RequestEvent){if(!event.locals.user)error(401,'Choose a local demo identity.');return event.locals.user;}
export function requireOrigin(event:RequestEvent){if(event.request.headers.get('origin')!==event.url.origin)error(403,'Invalid request origin');}
