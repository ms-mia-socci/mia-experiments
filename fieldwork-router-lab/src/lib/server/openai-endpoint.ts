export function codexBaseUrl(endpoint: string | undefined): string {
  if (!endpoint?.trim()) throw new Error('OPENAI_API_ENDPOINT is required for Codex.');
  const url = new URL(endpoint.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('OPENAI_API_ENDPOINT must be an HTTPS API base URL without credentials, query, or fragment.');
  }
  if (url.pathname === '/') url.pathname = '/v1';
  return url.toString().replace(/\/$/, '');
}
