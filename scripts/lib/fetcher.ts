/**
 * HTTP fetch utilities for Al Meezan ingestion.
 *
 * - Uses a descriptive User-Agent.
 * - Applies a minimum delay between requests (1.2s).
 * - Retries transient 429/5xx failures.
 * - Falls back to curl -k for environments with broken CA bundles.
 */

import { execFileSync } from 'child_process';

const USER_AGENT = 'Ansvar-Qatari-Law-MCP/1.0 (+https://github.com/Ansvar-Systems/Qatari-law-mcp)';
const MIN_DELAY_MS = 1000;

let lastRequestAt = 0;
let rateLimitChain: Promise<void> = Promise.resolve();

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function enforceRateLimit(): Promise<void> {
  let release!: () => void;
  const previous = rateLimitChain;
  rateLimitChain = new Promise<void>(resolve => {
    release = resolve;
  });

  await previous;
  try {
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    if (elapsed < MIN_DELAY_MS) {
      await sleep(MIN_DELAY_MS - elapsed);
    }
    lastRequestAt = Date.now();
  } finally {
    release();
  }
}

function collectErrorMessages(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current) {
    if (typeof current === 'object' && current !== null && 'message' in current) {
      const msg = String((current as { message?: unknown }).message ?? '');
      if (msg) parts.push(msg);
      current = (current as { cause?: unknown }).cause;
      continue;
    }

    parts.push(String(current));
    break;
  }

  return parts.join(' | ');
}

/**
 * Detect Al Meezan anti-bot interstitial pages (obfuscated JS challenge).
 * These responses are not law content and must be retried.
 */
export function isAntiBotChallengeHtml(html: string): boolean {
  if (!html) return false;

  return /cookiesession\d+/i.test(html)
    && /eval\(function\(p,a,c,k,e,d\)/i.test(html)
    && /LawViewWord\.aspx/i.test(html);
}

function isTlsVerificationError(error: unknown): boolean {
  const message = collectErrorMessages(error);
  return /UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|SSL certificate/i.test(message);
}

function fetchViaCurl(url: string, binary: boolean): Buffer {
  const output = execFileSync(
    'curl',
    ['-k', '-fsSL', '--connect-timeout', '4', '--max-time', '8', '-A', USER_AGENT, url],
    { encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (typeof output === 'string') {
    return Buffer.from(output, 'utf8');
  }

  return output;
}

function isCurlTransientError(error: unknown): boolean {
  const message = collectErrorMessages(error);
  return /Empty reply from server|timed out|Timeout|Failed to connect|Connection reset|HTTP\/2 stream/i.test(message);
}

async function fetchViaCurlWithRetry(url: string, binary: boolean, maxRetries = 0): Promise<Buffer> {
  await enforceRateLimit();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fetchViaCurl(url, binary);
    } catch (error) {
      if (!isCurlTransientError(error) || attempt >= maxRetries) {
        throw error;
      }

      const backoffMs = Math.pow(2, attempt + 1) * 1000;
      await sleep(backoffMs);
      await enforceRateLimit();
    }
  }

  throw new Error(`curl fallback failed for ${url}`);
}

async function fetchWithRetry(url: string, accept: string, maxRetries = 0): Promise<Response> {
  await enforceRateLimit();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': accept,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });

      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        await sleep(backoffMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching ${url}`);
      }

      return response;
    } catch (error) {
      if (isTlsVerificationError(error)) {
        throw error;
      }

      if (attempt >= maxRetries) {
        throw error;
      }

      const backoffMs = Math.pow(2, attempt + 1) * 1000;
      await sleep(backoffMs);
    }
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}

export async function fetchTextFromUrl(url: string): Promise<string> {
  const accept = 'text/html, text/plain, */*';

  // LawViewWord performs better and more consistently via curl in this environment.
  if (/LawViewWord\.aspx/i.test(url)) {
    const curlBody = (await fetchViaCurlWithRetry(url, false)).toString('utf8');
    if (!isAntiBotChallengeHtml(curlBody)) {
      return curlBody;
    }

    const response = await fetchWithRetry(url, accept);
    const fetchBody = await response.text();
    if (!isAntiBotChallengeHtml(fetchBody)) {
      return fetchBody;
    }

    throw new Error(`Received anti-bot challenge via both curl and fetch for ${url}`);
  }

  let bodyFromFetch: string | null = null;
  let fetchError: unknown = null;

  try {
    const response = await fetchWithRetry(url, accept);
    bodyFromFetch = await response.text();
  } catch (error) {
    fetchError = error;
    if (!isTlsVerificationError(error)) {
      // Non-TLS failures still get a curl recovery attempt below.
      bodyFromFetch = null;
    }
  }

  if (bodyFromFetch && !isAntiBotChallengeHtml(bodyFromFetch)) {
    return bodyFromFetch;
  }

  // Curl fallback handles TLS issues and anti-bot challenge pages observed from fetch().
  const curlBody = (await fetchViaCurlWithRetry(url, false)).toString('utf8');
  if (isAntiBotChallengeHtml(curlBody)) {
    if (fetchError) {
      throw new Error(`Received anti-bot challenge via both fetch and curl for ${url}: ${collectErrorMessages(fetchError)}`);
    }
    throw new Error(`Received anti-bot challenge via both fetch and curl for ${url}`);
  }

  return curlBody;
}

export async function fetchBinaryFromUrl(url: string): Promise<Buffer> {
  try {
    const response = await fetchWithRetry(url, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/octet-stream, */*');
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes);
  } catch (error) {
    if (!isTlsVerificationError(error)) {
      throw error;
    }

    return fetchViaCurlWithRetry(url, true);
  }
}

export function toAbsoluteAlMeezanUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const trimmed = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `https://www.almeezan.qa${trimmed}`;
}
