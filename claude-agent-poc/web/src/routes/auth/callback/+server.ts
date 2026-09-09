import { env } from '$env/dynamic/private';
import { verifyToken } from '$lib/server/auth';
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
export const GET: RequestHandler=async({cookies,url})=>{
  const saved=cookies.get('poc_oauth');cookies.delete('poc_oauth',{path:'/auth'});
  if(!saved) error(400,'Login expired. Please try again.');
  const {state,verifier,nonce}=JSON.parse(saved);
  if(url.searchParams.get('state')!==state || !url.searchParams.get('code')) error(400,'Invalid login response');
  const response=await fetch(`${env.COGNITO_DOMAIN}/oauth2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:env.COGNITO_CLIENT_ID!,code:url.searchParams.get('code')!,redirect_uri:`${url.origin}/auth/callback`,code_verifier:verifier})});
  if(!response.ok) error(401,'Login failed. Please try again.');
  const tokens=await response.json();
  const user=await verifyToken(tokens.id_token);
  if(user.nonce!==nonce) error(401,'Invalid login nonce');
  cookies.set('poc_session',tokens.id_token,{path:'/',httpOnly:true,secure:url.protocol==='https:',sameSite:'lax',maxAge:Math.min(tokens.expires_in,3600)});
  redirect(303,'/');
};
