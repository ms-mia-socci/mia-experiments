import * as oidc from "openid-client";
import { error, redirect } from "@sveltejs/kit";
import { oidcConfig, loginCookie } from "$lib/server/oidc";
export const GET: import("./$types").RequestHandler = async ({ cookies }) => {
  if (!process.env.FIELDWORK_OIDC_ISSUER) error(404);
  const state = oidc.randomState(),
    verifier = oidc.randomPKCECodeVerifier(),
    nonce = oidc.randomNonce();
  cookies.set(
    "fieldwork_login",
    JSON.stringify({ state, verifier, nonce }),
    loginCookie,
  );
  const url = oidc.buildAuthorizationUrl(await oidcConfig(), {
    redirect_uri: `${process.env.ORIGIN}/auth/callback`,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  });
  redirect(303, url.href);
};
