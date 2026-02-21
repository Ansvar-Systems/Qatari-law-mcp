/**
 * Contract tests for Qatari Law MCP.
 * Validates database integrity against the currently ingested real dataset.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DB_PATH = path.resolve(ROOT_DIR, 'data/database.db');
const SEED_DIR = path.resolve(ROOT_DIR, 'data/seed');

let db: InstanceType<typeof Database>;
let sampleProvision: { document_id: string; section: string; content: string } | undefined;

function seedFileCount(): number {
  return fs.readdirSync(SEED_DIR).filter(file => file.endsWith('.json')).length;
}

beforeAll(() => {
  db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = DELETE');

  sampleProvision = db.prepare(
    "SELECT document_id, section, content FROM legal_provisions WHERE section = '1' ORDER BY LENGTH(content) DESC LIMIT 1",
  ).get() as { document_id: string; section: string; content: string } | undefined;
});

describe('Database integrity', () => {
  it('should contain one legal document row per seed file', () => {
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM legal_documents WHERE id != 'eu-cross-references'",
    ).get() as { cnt: number };
    expect(row.cnt).toBe(seedFileCount());
  });

  it('should have at least one provision', () => {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM legal_provisions').get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it('should have a working FTS index', () => {
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM provisions_fts WHERE provisions_fts MATCH 'المادة OR Article OR law'",
    ).get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });
});

describe('Article retrieval', () => {
  it('should retrieve a known section 1 provision', () => {
    expect(sampleProvision).toBeDefined();
    expect(sampleProvision!.content.length).toBeGreaterThan(20);

    const row = db.prepare(
      'SELECT content FROM legal_provisions WHERE document_id = ? AND section = ? LIMIT 1',
    ).get(sampleProvision!.document_id, sampleProvision!.section) as { content: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.content).toBe(sampleProvision!.content);
  });
});

describe('Negative tests', () => {
  it('should return no results for fictional document', () => {
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM legal_provisions WHERE document_id = 'fictional-law-2099'",
    ).get() as { cnt: number };
    expect(row.cnt).toBe(0);
  });

  it('should return no results for invalid section on an existing document', () => {
    const docRow = db.prepare(
      'SELECT document_id FROM legal_provisions LIMIT 1',
    ).get() as { document_id: string } | undefined;
    expect(docRow).toBeDefined();

    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM legal_provisions WHERE document_id = ? AND section = ?',
    ).get(docRow!.document_id, '999ZZZ-INVALID') as { cnt: number };

    expect(row.cnt).toBe(0);
  });
});

describe('Coverage checks', () => {
  it('should include full-corpus style IDs (qa-law-*)', () => {
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM legal_documents WHERE id LIKE 'qa-law-%'",
    ).get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it('should have db_metadata table populated', () => {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM db_metadata').get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });
});
