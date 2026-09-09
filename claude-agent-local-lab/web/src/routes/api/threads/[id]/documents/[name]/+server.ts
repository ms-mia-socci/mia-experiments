import {error} from '@sveltejs/kit';
import {requireUser} from '$lib/server/auth';
import {ownedThread,getItem} from '$lib/server/store';
import {previewHtml,previewPolicy} from '$lib/server/preview';
import type {RequestHandler} from './$types';
export const GET:RequestHandler=async event=>{
 await ownedThread(event.params.id,requireUser(event).id);
 const item=getItem(event.params.id,`DOCUMENT#${event.params.name}`);
 if(!item)error(404,'Document not found');
 if(event.url.searchParams.get('preview')==='1'){
  if(!item.filename.endsWith('.html'))error(400,'Preview requires an HTML document');
  return new Response(previewHtml(item.content),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':previewPolicy,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 }
 const pdf=item.encoding==='base64' && item.filename.endsWith('.pdf');
 return new Response(pdf?new Uint8Array(Buffer.from(item.content,'base64')):item.content,{headers:{'Content-Type':pdf?'application/pdf':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${item.filename}"`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
};
