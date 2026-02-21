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
const MIN_DELAY_MS = 1200;

let lastRequestAt = 0;

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_DELAY_MS) {
    await sleep(MIN_DELAY_MS - elapsed);
  }
  lastRequestAt = Date.now();
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

function isTlsVerificationError(error: unknown): boolean {
  const message = collectErrorMessages(error);
  return /UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|SSL certificate/i.test(message);
}

function fetchViaCurl(url: string, binary: boolean): Buffer {
  const output = execFileSync(
    'curl',
    ['-k', '-fsSL', '-A', USER_AGENT, url],
    { encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (typeof output === 'string') {
    return Buffer.from(output, 'utf8');
  }

  return output;
}

async function fetchWithRetry(url: string, accept: string, maxRetries = 3): Promise<Response> {
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
  try {
    const response = await fetchWithRetry(url, 'text/html, text/plain, */*');
    return response.text();
  } catch (error) {
    if (!isTlsVerificationError(error)) {
      throw error;
    }

    await enforceRateLimit();
    return fetchViaCurl(url, false).toString('utf8');
  }
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

    await enforceRateLimit();
    return fetchViaCurl(url, true);
  }
}

export function toAbsoluteAlMeezanUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const trimmed = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `https://www.almeezan.qa${trimmed}`;
}
