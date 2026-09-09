import { randomBytes, createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
export const GET: RequestHandler=({cookies,url})=>{
  if(!env.COGNITO_DOMAIN) error(503,'Login is not configured yet.');
  const state=randomBytes(24).toString('base64url'), verifier=randomBytes(32).toString('base64url'), nonce=randomBytes(24).toString('base64url');
  const options={path:'/auth',httpOnly:true,secure:url.protocol==='https:',sameSite:'lax' as const,maxAge:600};
  cookies.set('poc_oauth',JSON.stringify({state,verifier,nonce}),options);
  const target=new URL('/oauth2/authorize',env.COGNITO_DOMAIN);
  target.search=new URLSearchParams({response_type:'code',client_id:env.COGNITO_CLIENT_ID!,redirect_uri:`${url.origin}/auth/callback`,scope:'openid email profile',state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
  redirect(303,target.href);
};
