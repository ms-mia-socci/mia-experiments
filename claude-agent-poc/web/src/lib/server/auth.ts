import { env } from '$env/dynamic/private';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { error, type RequestEvent } from '@sveltejs/kit';
let jwks: ReturnType<typeof createRemoteJWKSet>;
export async function verifyToken(token: string) {
  const issuer=`https://cognito-idp.${env.AWS_REGION || 'us-east-1'}.amazonaws.com/${env.COGNITO_USER_POOL_ID}`;
  jwks ||= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const {payload}=await jwtVerify(token,jwks,{issuer,audience:env.COGNITO_CLIENT_ID});
  if(payload.token_use!=='id' || !payload.sub) throw new Error('Invalid token');
  return {id:payload.sub,email:String(payload.email || ''),nonce:payload.nonce};
}
export function requireUser(event: RequestEvent) {
  if(!event.locals.user) error(401,'Please sign in.');
  return event.locals.user;
}
export function requireOrigin(event: RequestEvent) {
  if(event.request.headers.get('origin')!==event.url.origin) error(403,'Invalid request origin');
}
