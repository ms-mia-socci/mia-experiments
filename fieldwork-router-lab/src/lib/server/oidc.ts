import * as oidc from "openid-client";
let config: Promise<oidc.Configuration>;
export function oidcConfig() {
  return (config ??= oidc.discovery(
    new URL(process.env.FIELDWORK_OIDC_ISSUER!),
    process.env.FIELDWORK_OIDC_CLIENT_ID!,
    undefined,
    oidc.None(),
  ));
}
export const loginCookie = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 600,
};
