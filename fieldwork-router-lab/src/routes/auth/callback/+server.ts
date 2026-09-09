import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import { error, redirect } from "@sveltejs/kit";
import { oidcConfig } from "$lib/server/oidc";
import { put } from "$lib/server/store";
export const GET: import("./$types").RequestHandler = async ({
  cookies,
  url,
}) => {
  if (!process.env.FIELDWORK_OIDC_ISSUER) error(404);
  const saved = cookies.get("fieldwork_login");
  cookies.delete("fieldwork_login", { path: "/" });
  if (!saved) error(400, "Login expired. Please sign in again.");
  let claims;
  try {
    const { state, verifier, nonce } = JSON.parse(saved);
    const tokens = await oidc.authorizationCodeGrant(await oidcConfig(), url, {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    claims = tokens.claims();
  } catch {
    error(401, "Could not verify login. Please sign in again.");
  }
  if (!claims?.sub || claims.email_verified !== true)
    error(403, "A verified account is required.");
  const token = randomBytes(32).toString("base64url");
  await put("sessions", token, {
    id: claims.sub,
    name: String(claims.name || claims.email),
    expires: Date.now() + 3600000,
  });
  cookies.set("fieldwork_person", token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 3600,
  });
  redirect(303, "/");
};
