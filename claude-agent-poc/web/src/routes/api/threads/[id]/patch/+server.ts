import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { ownedThread,artifact } from '$lib/server/store';
import type { RequestHandler } from './$types';
export const GET:RequestHandler=async event=>{
  await ownedThread(event.params.id,requireUser(event).id);
  const patch=await artifact(event.params.id,'changes.patch');
  if(patch===undefined) error(404,'No patch saved yet');
  return new Response(patch,{headers:{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="changes.patch"'}});
};
