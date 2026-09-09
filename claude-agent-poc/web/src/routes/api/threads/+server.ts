import { json } from '@sveltejs/kit';
import { requireUser, requireOrigin } from '$lib/server/auth';
import { listThreads,createThread } from '$lib/server/store';
import type { RequestHandler } from './$types';
export const GET:RequestHandler=async event=>json(await listThreads(requireUser(event).id));
export const POST:RequestHandler=async event=>{requireOrigin(event);return json(await createThread(requireUser(event).id));};
