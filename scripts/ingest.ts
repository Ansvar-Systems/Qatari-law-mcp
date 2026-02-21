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
  parseDocxLegislation,
  parseEnglishLawsList,
  parseLawViewWordLegislation,
  type ListedLaw,
  type TargetLawConfig,
} from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../data/source');
const SOURCE_DOCX_DIR = path.resolve(SOURCE_DIR, 'docx');
const SOURCE_LAWVIEW_DIR = path.resolve(SOURCE_DIR, 'lawviewword');
const SOURCE_INDEX_FILE = path.resolve(SOURCE_DIR, 'almeezan-english-laws-list.html');
const SEED_DIR = path.resolve(__dirname, '../data/seed');

const INDEX_URL = 'https://www.almeezan.qa/EnglishLawsList.aspx';

interface ArabicFallbackConfig {
  lawId: string;
  language: 'ar';
}

const FIXED_TARGETS_BY_DOCX: Record<string, TargetLawConfig> = {
  '132016.docx': {
    id: 'qa-pdp-law',
    short_name: 'Law 13/2016 (PDP)',
    docx_file_name: '132016.docx',
  },
  '142014.docx': {
    id: 'qa-cybercrime-law',
    short_name: 'Law 14/2014 (Cybercrime)',
    docx_file_name: '142014.docx',
  },
  '012021.docx': {
    id: 'qa-ncsa-establishment',
    short_name: 'Amiri Decision 1/2021',
    docx_file_name: '012021.docx',
  },
  '182010.docx': {
    id: 'qa-egov-policies',
    short_name: 'CoM Decision 18/2010',
    docx_file_name: '182010.docx',
  },
  '092022.docx': {
    id: 'qa-right-to-access-information',
    short_name: 'Law 9/2022',
    docx_file_name: '092022.docx',
  },
  'Law No. 11 of 2004 Promulgating the Penal Code.docx': {
    id: 'qa-penal-code',
    short_name: 'Law 11/2004 (Penal Code)',
    docx_file_name: 'Law No. 11 of 2004 Promulgating the Penal Code.docx',
  },
  'Law No. (20) of 2019 on the Promulgation of Anti-Money Laundering and Terrorism Financing Law.docx': {
    id: 'qa-aml-cft-law',
    short_name: 'Law 20/2019 (AML/CFT)',
    docx_file_name: 'Law No. (20) of 2019 on the Promulgation of Anti-Money Laundering and Terrorism Financing Law.docx',
  },
  'The Council of Ministers Decision No. (41) of 2019 on issuance of the Executive Regulation of The Anti-Money Laundering and Terrorism Financing Law Promulgated by Law No. (20) of 2019.docx': {
    id: 'qa-aml-cft-exec-regulation',
    short_name: 'CoM Decision 41/2019',
    docx_file_name: 'The Council of Ministers Decision No. (41) of 2019 on issuance of the Executive Regulation of The Anti-Money Laundering and Terrorism Financing Law Promulgated by Law No. (20) of 2019.docx',
  },
  '242015.docx': {
    id: 'qa-tenders-auctions-law',
    short_name: 'Law 24/2015 (Tenders)',
    docx_file_name: '242015.docx',
  },
  '162019.docx': {
    id: 'qa-tenders-auctions-exec-regulation',
    short_name: 'CoM Decision 16/2019',
    docx_file_name: '162019.docx',
  },
};

const ARABIC_FALLBACK_BY_DOCX: Record<string, ArabicFallbackConfig> = {
  'Law No. (16) of 2018 on the Regulation of Non-Qataris’ Ownership and Usage of Real Estate.docx': {
    lawId: '7797',
    language: 'ar',
  },
  'Law No. (17) of 2018 on Establishing Workers’ Support and Insurance Fund.docx': {
    lawId: '7798',
    language: 'ar',
  },
};

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
  fs.mkdirSync(SOURCE_LAWVIEW_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });
}

function clearSeedFiles(): void {
  const files = fs.readdirSync(SEED_DIR).filter(file => file.endsWith('.json'));
  for (const file of files) {
    fs.unlinkSync(path.join(SEED_DIR, file));
  }
}

function normaliseFileKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortNameFromTitle(title: string): string {
  const compact = title.replace(/\s+/g, ' ').trim();
  if (compact.length <= 120) {
    return compact;
  }
  return `${compact.slice(0, 117).trim()}...`;
}

function generateAutoId(law: ListedLaw, ordinal: number, usedIds: Set<string>): string {
  const fileStem = path.basename(law.docx_file_name, path.extname(law.docx_file_name));
  let slug = slugify(fileStem);

  if (!slug || /^\d+$/.test(slug)) {
    slug = slugify(law.title_en || law.title || `law-${ordinal + 1}`);
  }

  if (!slug) {
    slug = `law-${ordinal + 1}`;
  }

  if (slug.length > 72) {
    slug = slug.slice(0, 72).replace(/-+$/g, '');
  }

  let candidate = `qa-${slug}`;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `qa-${slug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function buildTargets(laws: ListedLaw[]): TargetLawConfig[] {
  const usedIds = new Set<string>();
  const fixedByDocx = new Map<string, TargetLawConfig>(
    Object.values(FIXED_TARGETS_BY_DOCX).map(target => [normaliseFileKey(target.docx_file_name), target]),
  );

  return laws.map((law, index) => {
    const fixed = fixedByDocx.get(normaliseFileKey(law.docx_file_name));
    if (fixed) {
      usedIds.add(fixed.id);
      return fixed;
    }

    const id = generateAutoId(law, index, usedIds);
    usedIds.add(id);

    return {
      id,
      short_name: shortNameFromTitle(law.title_en || law.title || law.docx_file_name),
      docx_file_name: law.docx_file_name,
    };
  });
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

function buildLawViewWordUrl(fallback: ArabicFallbackConfig): string {
  return `https://www.almeezan.qa/LawViewWord.aspx?LawID=${fallback.lawId}&mode=DOC&language=${fallback.language}`;
}

async function loadLawViewWordHtml(
  fallback: ArabicFallbackConfig,
  localPath: string,
  skipFetch: boolean,
): Promise<string> {
  if (skipFetch && fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, 'utf8');
  }

  const url = buildLawViewWordUrl(fallback);
  const html = await fetchTextFromUrl(url);
  fs.writeFileSync(localPath, html, 'utf8');
  return html;
}

function fallbackByDocxFile(fileName: string): ArabicFallbackConfig | undefined {
  const key = normaliseFileKey(fileName);
  for (const [rawFileName, fallback] of Object.entries(ARABIC_FALLBACK_BY_DOCX)) {
    if (normaliseFileKey(rawFileName) === key) {
      return fallback;
    }
  }
  return undefined;
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

  const allTargets = buildTargets(listedLaws);
  const ingestionItems = listedLaws.map((law, index) => ({
    law,
    target: allTargets[index],
  }));
  const items = limit ? ingestionItems.slice(0, limit) : ingestionItems;

  clearSeedFiles();

  let written = 0;
  let skipped = 0;
  let fallbackUsed = 0;
  let totalProvisions = 0;
  let totalDefinitions = 0;
  const skipReasons: string[] = [];

  console.log(`\nDiscovered laws: ${listedLaws.length}`);
  console.log(`Planned ingestion count: ${items.length}`);

  for (const { law, target } of items) {
    const localDocxPath = path.join(SOURCE_DOCX_DIR, law.docx_file_name);
    let parsed: ReturnType<typeof parseDocxLegislation> | null = null;
    let sourceUrl = law.docx_url;
    let sourceDescription = 'Official legislation text retrieved from Al Meezan Legal Portal (English laws list source).';
    let usedArabicFallback = false;

    process.stdout.write(`  Fetching ${target.id}...`);

    try {
      await loadDocxFile(law.docx_url, localDocxPath, skipFetch);
      parsed = parseDocxLegislation(localDocxPath);
    } catch (docxError) {
      const fallback = fallbackByDocxFile(law.docx_file_name);
      if (!fallback) {
        const reason = `docx unavailable or unparseable (${law.docx_file_name})`;
        console.log(` skip (${reason})`);
        skipped += 1;
        skipReasons.push(`${target.id}: ${reason}`);
        continue;
      }

      const localHtmlPath = path.join(SOURCE_LAWVIEW_DIR, `${fallback.lawId}-${fallback.language}.html`);
      try {
        const fallbackHtml = await loadLawViewWordHtml(fallback, localHtmlPath, skipFetch);
        parsed = parseLawViewWordLegislation(fallbackHtml);
        sourceUrl = buildLawViewWordUrl(fallback);
        sourceDescription = 'Official legislation text retrieved from Al Meezan LawViewWord Arabic source (English translation unavailable).';
        usedArabicFallback = true;
        fallbackUsed += 1;
      } catch (fallbackError) {
        const reason = `fallback failed (${fallback.lawId}/${fallback.language})`;
        const docxMessage = docxError instanceof Error ? docxError.message : String(docxError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.log(` skip (${reason})`);
        skipped += 1;
        skipReasons.push(`${target.id}: ${reason}; docx=${docxMessage}; fallback=${fallbackMessage}`);
        continue;
      }
    }

    if (!parsed || parsed.provisions.length === 0) {
      const reason = 'no article-level provisions found';
      console.log(` skip (${reason})`);
      skipped += 1;
      skipReasons.push(`${target.id}: ${reason}`);
      continue;
    }

    const seed = buildSeedDocument(target, law, parsed, {
      sourceUrl,
      sourceDescription,
    });
    written += 1;
    totalProvisions += seed.provisions.length;
    totalDefinitions += seed.definitions.length;

    const outFile = path.join(SEED_DIR, `${String(written).padStart(2, '0')}-${target.id}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

    if (usedArabicFallback) {
      console.log(` ok (${seed.provisions.length} provisions, ${seed.definitions.length} definitions, arabic fallback)`);
    } else {
      console.log(` ok (${seed.provisions.length} provisions, ${seed.definitions.length} definitions)`);
    }
  }

  console.log('\nIngestion summary');
  console.log('-----------------');
  console.log(`Listed laws discovered: ${listedLaws.length}`);
  console.log(`Seed files written: ${written}`);
  console.log(`Targets skipped: ${skipped}`);
  console.log(`Arabic fallback used: ${fallbackUsed}`);
  console.log(`Total provisions: ${totalProvisions}`);
  console.log(`Total definitions: ${totalDefinitions}`);
  if (skipReasons.length > 0) {
    console.log('\nSkipped details:');
    for (const reason of skipReasons) {
      console.log(`  - ${reason}`);
    }
  }

  if (written === 0) {
    throw new Error('Ingestion produced zero seed files');
  }
}

main().catch(error => {
  console.error('Fatal ingestion error:', error);
  process.exit(1);
});
