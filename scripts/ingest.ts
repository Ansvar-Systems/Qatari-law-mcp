#!/usr/bin/env tsx
/**
 * Real-data ingestion for Qatari Law MCP.
 *
 * Sources:
 * 1) English DOCX corpus from https://www.almeezan.qa/EnglishLawsList.aspx
 * 2) Full Arabic laws corpus from year-index pages + LawViewWord text
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
const SOURCE_LAWVIEW_AR_DIR = path.resolve(SOURCE_LAWVIEW_DIR, 'ar');
const SOURCE_YEAR_DIR = path.resolve(SOURCE_DIR, 'laws-by-year');
const SOURCE_YEAR_AR_DIR = path.resolve(SOURCE_YEAR_DIR, 'ar');
const SOURCE_YEAR_EN_DIR = path.resolve(SOURCE_YEAR_DIR, 'en');
const SOURCE_INDEX_FILE = path.resolve(SOURCE_DIR, 'almeezan-english-laws-list.html');
const SOURCE_MANIFEST_FILE = path.resolve(SOURCE_DIR, 'almeezan-ingestion-manifest.json');
const SOURCE_SKIPPED_FILE = path.resolve(SOURCE_DIR, 'almeezan-ingestion-skipped.json');
const SEED_DIR = path.resolve(__dirname, '../data/seed');

const ENGLISH_INDEX_URL = 'https://www.almeezan.qa/EnglishLawsList.aspx';
const YEAR_PAGE_BASE_URL = 'https://www.almeezan.qa/LawsByYear.aspx';
const DEFAULT_DISCOVERY_YEAR = new Date().getUTCFullYear();

type CorpusMode = 'all' | 'ar' | 'en';
type Language = 'ar' | 'en';

interface ArabicFallbackConfig {
  lawId: string;
  language: Language;
}

interface CliArgs {
  skipFetch: boolean;
  refresh: boolean;
  limit: number | null;
  corpus: CorpusMode;
  arMetadataOnly: boolean;
}

interface YearSummary {
  year: number;
  count: number | null;
}

interface LawListing {
  law_id: string;
  title: string;
  year: number;
  language: Language;
  source_url: string;
}

interface EnglishIngestionStats {
  listed_laws_discovered: number;
  written: number;
  skipped: number;
  fallback_used: number;
  total_provisions: number;
  total_definitions: number;
}

interface ArabicIngestionStats {
  years_discovered: number;
  listed_laws_discovered: number;
  written: number;
  fetch_failed: number;
  textless_written: number;
  total_provisions: number;
  total_definitions: number;
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

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let skipFetch = false;
  let refresh = false;
  let limit: number | null = null;
  let corpus: CorpusMode = 'all';
  let arMetadataOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--skip-fetch') {
      skipFetch = true;
      continue;
    }

    if (arg === '--refresh') {
      refresh = true;
      continue;
    }

    if (arg === '--limit' && args[i + 1]) {
      const parsed = Number.parseInt(args[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
      i += 1;
      continue;
    }

    if (arg === '--corpus' && args[i + 1]) {
      const value = args[i + 1]?.trim().toLowerCase();
      if (value === 'all' || value === 'ar' || value === 'en') {
        corpus = value;
      }
      i += 1;
      continue;
    }

    if (arg === '--ar-metadata-only') {
      arMetadataOnly = true;
      continue;
    }
  }

  if (skipFetch && refresh) {
    throw new Error('--skip-fetch and --refresh cannot be used together');
  }

  return { skipFetch, refresh, limit, corpus, arMetadataOnly };
}

function ensureDirs(): void {
  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  fs.mkdirSync(SOURCE_DOCX_DIR, { recursive: true });
  fs.mkdirSync(SOURCE_LAWVIEW_DIR, { recursive: true });
  fs.mkdirSync(SOURCE_LAWVIEW_AR_DIR, { recursive: true });
  fs.mkdirSync(SOURCE_YEAR_DIR, { recursive: true });
  fs.mkdirSync(SOURCE_YEAR_AR_DIR, { recursive: true });
  fs.mkdirSync(SOURCE_YEAR_EN_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });
}

function clearSeedFiles(): void {
  const files = fs.readdirSync(SEED_DIR).filter(file => file.endsWith('.json'));
  for (const file of files) {
    fs.unlinkSync(path.join(SEED_DIR, file));
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#160;/gi, ' ');
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function normaliseWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normaliseFileKey(value: string): string {
  return normaliseWhitespace(value).toLowerCase();
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
  const compact = normaliseWhitespace(title);
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

function fallbackByDocxFile(fileName: string): ArabicFallbackConfig | undefined {
  const key = normaliseFileKey(fileName);
  for (const [rawFileName, fallback] of Object.entries(ARABIC_FALLBACK_BY_DOCX)) {
    if (normaliseFileKey(rawFileName) === key) {
      return fallback;
    }
  }
  return undefined;
}

function seedFilePath(index: number, id: string): string {
  return path.join(SEED_DIR, `${String(index).padStart(5, '0')}-${id}.json`);
}

function lawViewCachePath(lawId: string, language: Language): string {
  const base = language === 'ar' ? SOURCE_LAWVIEW_AR_DIR : SOURCE_LAWVIEW_DIR;
  return path.join(base, `${lawId}-${language}.html`);
}

function yearPageCachePath(year: number, page: number, language: Language): string {
  const base = language === 'ar' ? SOURCE_YEAR_AR_DIR : SOURCE_YEAR_EN_DIR;
  return path.join(base, `year-${year}-page-${page}.html`);
}

async function loadTextWithCache(url: string, localPath: string, opts: CliArgs): Promise<string> {
  if (opts.skipFetch) {
    if (!fs.existsSync(localPath)) {
      throw new Error(`Missing cached file for --skip-fetch: ${localPath}`);
    }
    return fs.readFileSync(localPath, 'utf8');
  }

  if (!opts.refresh && fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, 'utf8');
  }

  const html = await fetchTextFromUrl(url);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, html, 'utf8');
  return html;
}

async function loadBinaryWithCache(url: string, localPath: string, opts: CliArgs): Promise<void> {
  if (opts.skipFetch) {
    if (!fs.existsSync(localPath)) {
      throw new Error(`Missing cached file for --skip-fetch: ${localPath}`);
    }
    return;
  }

  if (!opts.refresh && fs.existsSync(localPath)) {
    return;
  }

  const body = await fetchBinaryFromUrl(encodeURI(url));
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, body);
}

function buildLawViewWordUrl(lawId: string, language: Language): string {
  return `https://www.almeezan.qa/LawViewWord.aspx?LawID=${lawId}&mode=DOC&language=${language}`;
}

function buildLawPageUrl(lawId: string, language: Language): string {
  return `https://www.almeezan.qa/LawPage.aspx?id=${lawId}&language=${language}`;
}

function buildYearPageUrl(year: number, page: number, language: Language): string {
  if (page <= 1) {
    return `${YEAR_PAGE_BASE_URL}?year=${year}&language=${language}`;
  }

  return `${YEAR_PAGE_BASE_URL}?status=0&kind=0&number=0&year=${year}&searchtext=&pageNumber=${page}&language=${language}`;
}

function parseYearSidebar(html: string, language: Language): YearSummary[] {
  const escapedLanguage = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<a[^>]+href="LawsByYear\\.aspx\\?year=(\\d{4})&language=${escapedLanguage}"[^>]*>([\\s\\S]*?)<\\/a>`,
    'gi',
  );

  const byYear = new Map<number, YearSummary>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const year = Number.parseInt(match[1], 10);
    if (!Number.isFinite(year)) continue;

    const text = normaliseWhitespace(decodeHtmlEntities(stripHtml(match[2])));
    const countMatch = text.match(/\((\d+)\)/);
    const count = countMatch ? Number.parseInt(countMatch[1], 10) : null;

    if (!byYear.has(year)) {
      byYear.set(year, { year, count });
      continue;
    }

    const existing = byYear.get(year)!;
    if (existing.count === null && count !== null) {
      byYear.set(year, { year, count });
    }
  }

  return Array.from(byYear.values()).sort((a, b) => b.year - a.year);
}

function parseMaxPageNumber(html: string): number {
  const matches = html.matchAll(/pageNumber=(\d+)/gi);
  let maxPage = 1;
  for (const match of matches) {
    const page = Number.parseInt(match[1], 10);
    if (Number.isFinite(page) && page > maxPage) {
      maxPage = page;
    }
  }
  return maxPage;
}

function parseLawsByYearPage(html: string, language: Language, year: number, sourceUrl: string): LawListing[] {
  const escapedLanguage = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRegex = new RegExp(
    `<a\\s+href="LawPage\\.aspx\\?id=(\\d+)&language=${escapedLanguage}"[^>]*id="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>`,
    'gi',
  );

  const list: LawListing[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const lawId = match[1];
    const anchorId = match[2] ?? '';

    if (
      !anchorId.startsWith('ContentPlaceHolder1_rptLaws_lawlink_')
      && anchorId !== 'ContentPlaceHolder1_aDoustourLink'
    ) {
      continue;
    }

    if (seen.has(lawId)) {
      continue;
    }
    seen.add(lawId);

    const title = normaliseWhitespace(decodeHtmlEntities(stripHtml(match[3] ?? '')));
    if (!title) {
      continue;
    }

    list.push({
      law_id: lawId,
      title,
      year,
      language,
      source_url: sourceUrl,
    });
  }

  return list;
}

async function discoverYearSummaries(language: Language, opts: CliArgs): Promise<YearSummary[]> {
  const candidates = [
    DEFAULT_DISCOVERY_YEAR,
    DEFAULT_DISCOVERY_YEAR - 1,
    2025,
    2024,
  ];
  const uniqueCandidates = Array.from(new Set(candidates));

  for (const year of uniqueCandidates) {
    try {
      const url = buildYearPageUrl(year, 1, language);
      const localPath = yearPageCachePath(year, 1, language);
      const html = await loadTextWithCache(url, localPath, opts);
      const years = parseYearSidebar(html, language);
      if (years.length > 0) {
        return years;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  WARN discover-year failed (${language}/${year}): ${message}`);
    }
  }

  throw new Error(`Unable to discover years from LawsByYear pages for language=${language}`);
}

async function crawlLawIndex(
  language: Language,
  opts: CliArgs,
  limit: number | null = null,
  skipReasons: string[] = [],
): Promise<{ years: YearSummary[]; laws: LawListing[] }> {
  const years = await discoverYearSummaries(language, opts);
  const byLawId = new Map<string, LawListing>();

  const addLaw = (law: LawListing): void => {
    if (limit !== null && byLawId.size >= limit && !byLawId.has(law.law_id)) {
      return;
    }

    const existing = byLawId.get(law.law_id);
    if (!existing) {
      byLawId.set(law.law_id, law);
      return;
    }

    // Keep the richer title and the earliest listing year encountered.
    const richerTitle = law.title.length > existing.title.length ? law.title : existing.title;
    const earlierYear = Math.min(law.year, existing.year);

    byLawId.set(law.law_id, {
      ...existing,
      title: richerTitle,
      year: earlierYear,
    });
  };

  for (const yearEntry of years) {
    if (limit !== null && byLawId.size >= limit) {
      break;
    }

    const year = yearEntry.year;
    let maxPage = 1;
    try {
      const firstUrl = buildYearPageUrl(year, 1, language);
      const firstPath = yearPageCachePath(year, 1, language);
      const firstHtml = await loadTextWithCache(firstUrl, firstPath, opts);
      maxPage = parseMaxPageNumber(firstHtml);
      const firstLaws = parseLawsByYearPage(firstHtml, language, year, firstUrl);
      firstLaws.forEach(addLaw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = `index:${language}:${year}:page1 failed; ${message}`;
      console.warn(`  WARN ${reason}`);
      skipReasons.push(reason);
      continue;
    }

    for (let page = 2; page <= maxPage; page++) {
      if (limit !== null && byLawId.size >= limit) {
        break;
      }
      try {
        const pageUrl = buildYearPageUrl(year, page, language);
        const pagePath = yearPageCachePath(year, page, language);
        const pageHtml = await loadTextWithCache(pageUrl, pagePath, opts);
        const laws = parseLawsByYearPage(pageHtml, language, year, pageUrl);
        laws.forEach(addLaw);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const reason = `index:${language}:${year}:page${page} failed; ${message}`;
        console.warn(`  WARN ${reason}`);
        skipReasons.push(reason);
      }
    }

    console.log(
      `  Indexed ${year}: ${byLawId.size} unique laws discovered so far (${language.toUpperCase()})`,
    );
  }

  const laws = Array.from(byLawId.values()).sort(
    (a, b) => Number.parseInt(a.law_id, 10) - Number.parseInt(b.law_id, 10),
  );
  return { years, laws };
}

async function ingestEnglishDocxCorpus(
  opts: CliArgs,
  startIndex: number,
  skipReasons: string[],
): Promise<{ nextIndex: number; stats: EnglishIngestionStats }> {
  const indexHtml = await loadTextWithCache(ENGLISH_INDEX_URL, SOURCE_INDEX_FILE, opts);
  const listedLaws = parseEnglishLawsList(indexHtml);
  if (listedLaws.length === 0) {
    throw new Error('No laws found in EnglishLawsList.aspx parsing step');
  }

  const allTargets = buildTargets(listedLaws);
  const ingestionItems = listedLaws.map((law, index) => ({
    law,
    target: allTargets[index],
  }));

  let currentIndex = startIndex;
  let written = 0;
  let skipped = 0;
  let fallbackUsed = 0;
  let totalProvisions = 0;
  let totalDefinitions = 0;

  console.log(`\nEnglish DOCX corpus: ${ingestionItems.length} listed laws`);

  for (const { law, target } of ingestionItems) {
    const localDocxPath = path.join(SOURCE_DOCX_DIR, law.docx_file_name);
    let parsed: ReturnType<typeof parseDocxLegislation> | null = null;
    let sourceUrl = law.docx_url;
    let sourceDescription = 'Official legislation text retrieved from Al Meezan Legal Portal (English laws list source).';
    let usedArabicFallback = false;

    process.stdout.write(`  [EN] ${target.id}...`);

    try {
      await loadBinaryWithCache(law.docx_url, localDocxPath, opts);
      parsed = parseDocxLegislation(localDocxPath);
    } catch (docxError) {
      const fallback = fallbackByDocxFile(law.docx_file_name);
      if (!fallback) {
        const reason = `english:${target.id}: docx unavailable or unparseable (${law.docx_file_name})`;
        console.log(' skip');
        skipped += 1;
        skipReasons.push(reason);
        continue;
      }

      const localHtmlPath = lawViewCachePath(fallback.lawId, fallback.language);
      try {
        const fallbackUrl = buildLawViewWordUrl(fallback.lawId, fallback.language);
        const fallbackHtml = await loadTextWithCache(fallbackUrl, localHtmlPath, opts);
        parsed = parseLawViewWordLegislation(fallbackHtml);
        sourceUrl = fallbackUrl;
        sourceDescription = 'Official legislation text retrieved from Al Meezan LawViewWord Arabic source (English translation unavailable).';
        usedArabicFallback = true;
        fallbackUsed += 1;
      } catch (fallbackError) {
        const docxMessage = docxError instanceof Error ? docxError.message : String(docxError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        const reason = `english:${target.id}: fallback failed (${fallback.lawId}/${fallback.language}); docx=${docxMessage}; fallback=${fallbackMessage}`;
        console.log(' skip');
        skipped += 1;
        skipReasons.push(reason);
        continue;
      }
    }

    if (!parsed || parsed.provisions.length === 0) {
      const reason = `english:${target.id}: no article-level provisions found`;
      console.log(' skip');
      skipped += 1;
      skipReasons.push(reason);
      continue;
    }

    const seed = buildSeedDocument(target, law, parsed, {
      sourceUrl,
      sourceDescription,
    });
    written += 1;
    totalProvisions += seed.provisions.length;
    totalDefinitions += seed.definitions.length;

    const outFile = seedFilePath(currentIndex, target.id);
    fs.writeFileSync(outFile, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
    currentIndex += 1;

    if (usedArabicFallback) {
      console.log(` ok (${seed.provisions.length} provisions, arabic fallback)`);
    } else {
      console.log(` ok (${seed.provisions.length} provisions)`);
    }
  }

  return {
    nextIndex: currentIndex,
    stats: {
      listed_laws_discovered: listedLaws.length,
      written,
      skipped,
      fallback_used: fallbackUsed,
      total_provisions: totalProvisions,
      total_definitions: totalDefinitions,
    },
  };
}

async function ingestArabicCorpus(
  opts: CliArgs,
  startIndex: number,
  skipReasons: string[],
): Promise<{ nextIndex: number; stats: ArabicIngestionStats }> {
  console.log('\nArabic corpus discovery: crawling LawsByYear index...');
  const { years, laws } = await crawlLawIndex('ar', opts, opts.limit, skipReasons);
  console.log(`Arabic index discovered ${laws.length} unique laws across ${years.length} years.`);

  let currentIndex = startIndex;
  let written = 0;
  let fetchFailed = 0;
  let textlessWritten = 0;
  let totalProvisions = 0;
  let totalDefinitions = 0;
  let completed = 0;
  let cursor = 0;

  const workerCount = opts.skipFetch ? 8 : 4;

  const processLaw = async (index: number): Promise<void> => {
    const law = laws[index]!;
    const lawId = law.law_id;
    const seedId = `qa-law-${lawId}`;
    const lawViewUrl = buildLawViewWordUrl(lawId, 'ar');
    const lawPageUrl = buildLawPageUrl(lawId, 'ar');
    const localLawViewPath = lawViewCachePath(lawId, 'ar');

    let parsed: ReturnType<typeof parseLawViewWordLegislation> | null = null;
    let fetchErrorMessage: string | null = null;

    if (!opts.arMetadataOnly) {
      try {
        const lawViewHtml = await loadTextWithCache(lawViewUrl, localLawViewPath, opts);
        parsed = parseLawViewWordLegislation(lawViewHtml);
      } catch (error) {
        fetchErrorMessage = error instanceof Error ? error.message : String(error);
        fetchFailed += 1;
        skipReasons.push(`arabic:${seedId}: lawview fetch/parse failed; ${fetchErrorMessage}`);
      }
    }

    const provisions = parsed?.provisions ?? [];
    const definitions = parsed?.definitions ?? [];
    const textMissing = provisions.length === 0;
    if (textMissing) {
      textlessWritten += 1;
    }

    const description = fetchErrorMessage
      ? `Official Al Meezan listing metadata retained. LawViewWord could not be fetched at ingestion time (${fetchErrorMessage}). Listed year: ${law.year}.`
      : opts.arMetadataOnly
        ? `Official Al Meezan listing metadata retained (LawViewWord fetching disabled by ingestion mode). Listed year: ${law.year}.`
      : textMissing
        ? `Official Al Meezan listing metadata retained. LawViewWord returned no article-level text at ingestion time. Listed year: ${law.year}.`
        : `Official legislation text retrieved from Al Meezan LawViewWord Arabic source. Listed year: ${law.year}.`;

    const seed: Record<string, unknown> = {
      id: seedId,
      type: 'statute',
      title: law.title,
      short_name: shortNameFromTitle(law.title),
      status: 'in_force',
      url: opts.arMetadataOnly ? lawPageUrl : lawViewUrl,
      description,
      provisions,
      definitions,
    };

    const outFile = seedFilePath(startIndex + index, seedId);
    fs.writeFileSync(outFile, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

    written += 1;
    totalProvisions += provisions.length;
    totalDefinitions += definitions.length;
    completed += 1;

    if (completed % 25 === 0 || completed === 1 || completed === laws.length) {
      console.log(`  [AR] ${completed}/${laws.length} (${seedId})`);
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= laws.length) {
        return;
      }
      await processLaw(index);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, workerCount) }, () => worker()));
  currentIndex = startIndex + laws.length;

  return {
    nextIndex: currentIndex,
    stats: {
      years_discovered: years.length,
      listed_laws_discovered: laws.length,
      written,
      fetch_failed: fetchFailed,
      textless_written: textlessWritten,
      total_provisions: totalProvisions,
      total_definitions: totalDefinitions,
    },
  };
}

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log('Qatari Law MCP — Real Data Ingestion');
  console.log('====================================');
  console.log(`Corpus mode: ${opts.corpus}`);
  if (opts.skipFetch) console.log('Mode: --skip-fetch');
  if (opts.refresh) console.log('Mode: --refresh');
  if (opts.arMetadataOnly) console.log('Mode: --ar-metadata-only');
  if (opts.limit !== null) console.log(`Arabic limit: --limit ${opts.limit}`);

  ensureDirs();
  clearSeedFiles();

  let seedIndex = 1;
  const skipReasons: string[] = [];

  let englishStats: EnglishIngestionStats | null = null;
  let arabicStats: ArabicIngestionStats | null = null;

  if (opts.corpus === 'all' || opts.corpus === 'en') {
    const englishResult = await ingestEnglishDocxCorpus(opts, seedIndex, skipReasons);
    seedIndex = englishResult.nextIndex;
    englishStats = englishResult.stats;
  }

  if (opts.corpus === 'all' || opts.corpus === 'ar') {
    const arabicResult = await ingestArabicCorpus(opts, seedIndex, skipReasons);
    seedIndex = arabicResult.nextIndex;
    arabicStats = arabicResult.stats;
  }

  const totalWritten = seedIndex - 1;
  if (totalWritten === 0) {
    throw new Error('Ingestion produced zero seed files');
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    source: {
      portal: 'https://www.almeezan.qa',
      english_index: ENGLISH_INDEX_URL,
      year_index: YEAR_PAGE_BASE_URL,
    },
    options: {
      corpus: opts.corpus,
      skip_fetch: opts.skipFetch,
      refresh: opts.refresh,
      limit: opts.limit,
    },
    summary: {
      seed_files_written: totalWritten,
      skipped_count: skipReasons.length,
    },
    english_docx: englishStats,
    arabic_corpus: arabicStats,
  };

  fs.writeFileSync(SOURCE_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(SOURCE_SKIPPED_FILE, `${JSON.stringify({ skipped: skipReasons }, null, 2)}\n`, 'utf8');

  console.log('\nIngestion summary');
  console.log('-----------------');
  console.log(`Seed files written: ${totalWritten}`);
  if (englishStats) {
    console.log(
      `English corpus: ${englishStats.written}/${englishStats.listed_laws_discovered} written, ${englishStats.skipped} skipped, ${englishStats.total_provisions} provisions`,
    );
  }
  if (arabicStats) {
    console.log(
      `Arabic corpus: ${arabicStats.written}/${arabicStats.listed_laws_discovered} written, ${arabicStats.fetch_failed} fetch-failed, ${arabicStats.textless_written} textless, ${arabicStats.total_provisions} provisions`,
    );
  }
  console.log(`Skipped details saved to: ${SOURCE_SKIPPED_FILE}`);
  console.log(`Manifest saved to: ${SOURCE_MANIFEST_FILE}`);
}

main().catch(error => {
  console.error('Fatal ingestion error:', error);
  process.exit(1);
});
