export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(
      `HTTP ${response.status} from ${new URL(url).origin}`,
      response.status,
      body.slice(0, 500),
    );
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Expected JSON from ${new URL(url).origin}`);
  }
}
