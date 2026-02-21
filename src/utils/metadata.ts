/**
 * Response metadata utilities for Qatari Law MCP.
 */

import type Database from '@ansvar/mcp-sqlite';

export interface ResponseMetadata {
  data_source: string;
  jurisdiction: string;
  disclaimer: string;
  freshness?: string;
}

export interface ToolResponse<T> {
  results: T;
  _metadata: ResponseMetadata;
}

export function generateResponseMetadata(
  db: InstanceType<typeof Database>,
): ResponseMetadata {
  let freshness: string | undefined;
  try {
    const row = db.prepare(
      "SELECT value FROM db_metadata WHERE key = 'built_at'"
    ).get() as { value: string } | undefined;
    if (row) freshness = row.value;
  } catch {
    // Ignore
  }

  return {
    data_source: 'Al Meezan Legal Portal (almeezan.qa) — Ministry of Justice, State of Qatar',
    jurisdiction: 'QA',
    disclaimer:
      'This data is sourced from Al Meezan Legal Portal. ' +
      'Authoritative legal texts are maintained by the State of Qatar. ' +
      'Always verify citations against the official portal before relying on them.',
    freshness,
  };
}
