import { env } from "../config.js";
import { redact } from "../util/redact.js";

const BASE = "https://api.hubapi.com";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 4;

export class HubSpotError extends Error {
  /** `body` keeps HubSpot's raw reply for program logic (e.g. reading an existing id); `message` is always redacted. */
  constructor(public status: number, public body: string, public path: string) {
    super(redact(`HubSpot ${status} on ${path}: ${body}`, 300));
  }
}

/** Minimal HubSpot REST client: 15 s timeout, retries on timeouts, network errors, 429 and 5xx. */
export async function hs<T = any>(method: string, path: string, body?: unknown, attempt = 1): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env("HUBSPOT_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(700 * attempt);
      return hs<T>(method, path, body, attempt + 1);
    }
    throw new HubSpotError(0, e instanceof Error ? e.name : "network error", path);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
    const wait = Number(res.headers.get("retry-after")) * 1000 || 700 * attempt;
    await sleep(wait);
    return hs<T>(method, path, body, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new HubSpotError(res.status, text, path);
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
