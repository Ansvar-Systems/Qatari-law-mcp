#!/usr/bin/env tsx
/**
 * Real-data ingestion for Qatari Law MCP.
 *
 * Source portal: https://www.almeezan.qa/EnglishLawsList.aspx
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchBinaryFromUrl, fetchTextFromUrl } from './lib/fetcher.js';
import {
  buildSeedDocument,
  findLawByDocxFileName,
  parseDocxLegislation,
  parseEnglishLawsList,
  type TargetLawConfig,
} from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../data/source');
const SOURCE_DOCX_DIR = path.resolve(SOURCE_DIR, 'docx');
const SOURCE_INDEX_FILE = path.resolve(SOURCE_DIR, 'almeezan-english-laws-list.html');
const SEED_DIR = path.resolve(__dirname, '../data/seed');

const INDEX_URL = 'https://www.almeezan.qa/EnglishLawsList.aspx';

const TARGET_LAWS: TargetLawConfig[] = [
  {
    id: 'qa-pdp-law',
    short_name: 'Law 13/2016 (PDP)',
    docx_file_name: '132016.docx',
  },
  {
    id: 'qa-cybercrime-law',
    short_name: 'Law 14/2014 (Cybercrime)',
    docx_file_name: '142014.docx',
  },
  {
    id: 'qa-ncsa-establishment',
    short_name: 'Amiri Decision 1/2021',
    docx_file_name: '012021.docx',
  },
  {
    id: 'qa-egov-policies',
    short_name: 'CoM Decision 18/2010',
    docx_file_name: '182010.docx',
  },
  {
    id: 'qa-right-to-access-information',
    short_name: 'Law 9/2022',
    docx_file_name: '092022.docx',
  },
  {
    id: 'qa-penal-code',
    short_name: 'Law 11/2004 (Penal Code)',
    docx_file_name: 'Law No. 11 of 2004 Promulgating the Penal Code.docx',
  },
  {
    id: 'qa-aml-cft-law',
    short_name: 'Law 20/2019 (AML/CFT)',
    docx_file_name: 'Law No. (20) of 2019 on the Promulgation of Anti-Money Laundering and Terrorism Financing Law.docx',
  },
  {
    id: 'qa-aml-cft-exec-regulation',
    short_name: 'CoM Decision 41/2019',
    docx_file_name: 'The Council of Ministers Decision No. (41) of 2019 on issuance of the Executive Regulation of The Anti-Money Laundering and Terrorism Financing Law Promulgated by Law No. (20) of 2019.docx',
  },
  {
    id: 'qa-tenders-auctions-law',
    short_name: 'Law 24/2015 (Tenders)',
    docx_file_name: '242015.docx',
  },
  {
    id: 'qa-tenders-auctions-exec-regulation',
    short_name: 'CoM Decision 16/2019',
    docx_file_name: '162019.docx',
  },
];

function parseArgs(): { skipFetch: boolean; limit: number | null } {
  const args = process.argv.slice(2);
  let skipFetch = false;
  let limit: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip-fetch') {
      skipFetch = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      const parsed = Number.parseInt(args[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
      i += 1;
    }
  }

  return { skipFetch, limit };
}

function ensureDirs(): void {
  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  fs.mkdirSync(SOURCE_DOCX_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });
}

function clearSeedFiles(): void {
  const files = fs.readdirSync(SEED_DIR).filter(file => file.endsWith('.json'));
  for (const file of files) {
    fs.unlinkSync(path.join(SEED_DIR, file));
  }
}

async function loadIndexHtml(skipFetch: boolean): Promise<string> {
  if (skipFetch && fs.existsSync(SOURCE_INDEX_FILE)) {
    return fs.readFileSync(SOURCE_INDEX_FILE, 'utf8');
  }

  const html = await fetchTextFromUrl(INDEX_URL);
  fs.writeFileSync(SOURCE_INDEX_FILE, html, 'utf8');
  return html;
}

async function loadDocxFile(docxUrl: string, localPath: string, skipFetch: boolean): Promise<void> {
  if (skipFetch && fs.existsSync(localPath)) {
    return;
  }

  const encodedUrl = encodeURI(docxUrl);
  const body = await fetchBinaryFromUrl(encodedUrl);
  fs.writeFileSync(localPath, body);
}

async function main(): Promise<void> {
  const { skipFetch, limit } = parseArgs();

  console.log('Qatari Law MCP — Real Data Ingestion');
  console.log('====================================');
  console.log(`Source index: ${INDEX_URL}`);
  if (skipFetch) console.log('Mode: --skip-fetch');
  if (limit) console.log(`Mode: --limit ${limit}`);

  ensureDirs();

  const indexHtml = await loadIndexHtml(skipFetch);
  const listedLaws = parseEnglishLawsList(indexHtml);
  if (listedLaws.length === 0) {
    throw new Error('No laws found in EnglishLawsList.aspx parsing step');
  }

  const targets = limit ? TARGET_LAWS.slice(0, limit) : TARGET_LAWS;

  clearSeedFiles();

  let written = 0;
  let skipped = 0;
  let totalProvisions = 0;
  let totalDefinitions = 0;

  console.log(`\nTarget laws: ${targets.length}`);

  for (const target of targets) {
    const law = findLawByDocxFileName(listedLaws, target.docx_file_name);

    if (!law) {
      console.log(`  SKIP ${target.id}: docx not found in index (${target.docx_file_name})`);
      skipped += 1;
      continue;
    }

    const localDocxPath = path.join(SOURCE_DOCX_DIR, law.docx_file_name);

    process.stdout.write(`  Fetching ${target.id}...`);
    await loadDocxFile(law.docx_url, localDocxPath, skipFetch);

    const parsed = parseDocxLegislation(localDocxPath);
    if (parsed.provisions.length === 0) {
      console.log(' no article provisions found');
      skipped += 1;
      continue;
    }

    const seed = buildSeedDocument(target, law, parsed);
    written += 1;
    totalProvisions += seed.provisions.length;
    totalDefinitions += seed.definitions.length;

    const outFile = path.join(SEED_DIR, `${String(written).padStart(2, '0')}-${target.id}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

    console.log(` ok (${seed.provisions.length} provisions, ${seed.definitions.length} definitions)`);
  }

  console.log('\nIngestion summary');
  console.log('-----------------');
  console.log(`Listed laws discovered: ${listedLaws.length}`);
  console.log(`Seed files written: ${written}`);
  console.log(`Targets skipped: ${skipped}`);
  console.log(`Total provisions: ${totalProvisions}`);
  console.log(`Total definitions: ${totalDefinitions}`);

  if (written === 0) {
    throw new Error('Ingestion produced zero seed files');
  }
}

main().catch(error => {
  console.error('Fatal ingestion error:', error);
  process.exit(1);
});
