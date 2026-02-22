#!/usr/bin/env tsx
/**
 * Backfill Arabic article-level text for existing qa-law-* seed records.
 *
 * - Reads current data/seed JSONs.
 * - For each qa-law-* record with empty provisions, fetches LawViewWord HTML.
 * - Parses article-level provisions and updates the seed in place.
 * - Falls back to LawPage/LawArticles when LawViewWord is unavailable (HTTP 500, etc.).
 * - Keeps metadata-only records when no article-level text is available.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchTextFromUrl, isAntiBotChallengeHtml } from './lib/fetcher.js';
import { parseLawViewWordLegislation } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const SEED_DIR = path.resolve(ROOT_DIR, 'data/seed');
const LAWVIEW_CACHE_DIR = path.resolve(ROOT_DIR, 'data/source/lawviewword/ar');
const LAWPAGE_CACHE_DIR = path.resolve(ROOT_DIR, 'data/source/lawpage/ar');
const LAWARTICLES_CACHE_DIR = path.resolve(ROOT_DIR, 'data/source/lawarticles/ar');
const REPORT_FILE = path.resolve(ROOT_DIR, 'data/source/almeezan-arabic-backfill-report.json');

interface Args {
  skipFetch: boolean;
  refresh: boolean;
  limit: number | null;
  fromLawId: number | null;
  workers: number;
}

interface SeedDoc {
  id: string;
  type: 'statute';
  title: string;
  title_en?: string;
  short_name?: string;
  status: string;
  url?: string;
  description?: string;
  provisions?: Array<{
    provision_ref: string;
    section: string;
    title?: string;
    content: string;
  }>;
  definitions?: Array<{
    term: string;
    definition: string;
    source_provision?: string;
  }>;
}

interface LawArticleRef {
  articleId: string;
  section: string | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let skipFetch = false;
  let refresh = false;
  let limit: number | null = null;
  let fromLawId: number | null = null;
  let workers = 6;

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
      const value = Number.parseInt(args[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
      }
      i += 1;
      continue;
    }
    if (arg === '--from-law-id' && args[i + 1]) {
      const value = Number.parseInt(args[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        fromLawId = value;
      }
      i += 1;
      continue;
    }

    if (arg === '--workers' && args[i + 1]) {
      const value = Number.parseInt(args[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        workers = value;
      }
      i += 1;
      continue;
    }
  }

  if (skipFetch && refresh) {
    throw new Error('--skip-fetch and --refresh cannot be used together');
  }

  return { skipFetch, refresh, limit, fromLawId, workers };
}

function lawViewUrl(lawId: number): string {
  return `https://www.almeezan.qa/LawViewWord.aspx?LawID=${lawId}&mode=DOC&language=ar`;
}

function lawViewCachePath(lawId: number): string {
  return path.join(LAWVIEW_CACHE_DIR, `${lawId}-ar.html`);
}

function lawPageUrl(lawId: number): string {
  return `https://www.almeezan.qa/LawPage.aspx?id=${lawId}&language=ar`;
}

function lawPageCachePath(lawId: number): string {
  return path.join(LAWPAGE_CACHE_DIR, `${lawId}-ar.html`);
}

function lawArticleUrl(lawId: number, articleId: string): string {
  return `https://www.almeezan.qa/LawArticles.aspx?LawArticleID=${articleId}&LawId=${lawId}&language=ar`;
}

function lawArticleCachePath(lawId: number, articleId: string): string {
  return path.join(LAWARTICLES_CACHE_DIR, `${lawId}-${articleId}-ar.html`);
}

async function loadHtmlWithCache(url: string, cachePath: string, args: Args): Promise<string> {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  if (args.skipFetch) {
    if (!fs.existsSync(cachePath)) {
      throw new Error(`Missing cached file: ${cachePath}`);
    }
    const cached = fs.readFileSync(cachePath, 'utf8');
    if (isAntiBotChallengeHtml(cached)) {
      throw new Error(`Cached anti-bot challenge page: ${cachePath}`);
    }
    return cached;
  }

  if (!args.refresh && fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath, 'utf8');
    if (!isAntiBotChallengeHtml(cached)) {
      return cached;
    }
  }

  const html = await fetchTextFromUrl(url);
  if (isAntiBotChallengeHtml(html)) {
    throw new Error(`Anti-bot challenge page returned for ${url}`);
  }
  fs.writeFileSync(cachePath, html, 'utf8');
  return html;
}

async function loadLawViewHtml(lawId: number, args: Args): Promise<string> {
  return loadHtmlWithCache(lawViewUrl(lawId), lawViewCachePath(lawId), args);
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
    .replace(/&#160;/gi, ' ');
}

const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

function normaliseDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, digit => DIGIT_MAP[digit] ?? digit);
}

function normaliseWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseSectionFromLawArticleLabel(label: string): string | null {
  const clean = normaliseDigits(normaliseWhitespace(decodeHtmlEntities(label).replace(/<[^>]+>/g, ' ')));
  if (!clean) return null;

  const arabic = clean.match(/^المادة\s+([0-9]+(?:\s+مكرر)?)/);
  if (arabic) return normaliseWhitespace(arabic[1]);

  const english = clean.match(/^Article\s+([0-9]+[A-Za-z]?)/i);
  if (english) return english[1];

  return null;
}

function extractLawArticleRefs(lawPageHtml: string, lawId: number): LawArticleRef[] {
  const regex = new RegExp(
    `LawArticles\\.aspx\\?LawArticleID=(\\d+)&LawId=${lawId}&language=ar['"][^>]*>([\\s\\S]*?)<\\/a>`,
    'gi',
  );

  const refs: LawArticleRef[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lawPageHtml)) !== null) {
    const articleId = match[1];
    if (seen.has(articleId)) continue;
    seen.add(articleId);

    refs.push({
      articleId,
      section: parseSectionFromLawArticleLabel(match[2] ?? ''),
    });
  }

  return refs;
}

async function parseLawViaLawArticles(lawId: number, args: Args): Promise<{
  provisions: NonNullable<SeedDoc['provisions']>;
  definitions: NonNullable<SeedDoc['definitions']>;
} | null> {
  const lawPageHtml = await loadHtmlWithCache(lawPageUrl(lawId), lawPageCachePath(lawId), args);
  const refs = extractLawArticleRefs(lawPageHtml, lawId);
  if (refs.length === 0) {
    return null;
  }

  const provisions: NonNullable<SeedDoc['provisions']> = [];
  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index]!;
    const articleHtml = await loadHtmlWithCache(
      lawArticleUrl(lawId, ref.articleId),
      lawArticleCachePath(lawId, ref.articleId),
      args,
    );

    const parsedArticle = parseLawViewWordLegislation(articleHtml);
    const provision = parsedArticle.provisions[0];
    if (!provision) {
      continue;
    }

    const section = ref.section ?? provision.section ?? String(index + 1);
    provisions.push({
      provision_ref: `art${ref.articleId}`,
      section,
      title: `Article (${section})`,
      content: provision.content,
    });
  }

  if (provisions.length === 0) {
    return null;
  }

  return { provisions, definitions: [] };
}

function parseLawId(seedId: string): number | null {
  const match = seedId.match(/^qa-law-(\d+)$/);
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}

function hasProvisionText(seed: SeedDoc): boolean {
  return Array.isArray(seed.provisions) && seed.provisions.length > 0;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log('Qatari Law MCP — Arabic Text Backfill');
  console.log('=====================================');
  if (args.skipFetch) console.log('Mode: --skip-fetch');
  if (args.refresh) console.log('Mode: --refresh');
  if (args.limit !== null) console.log(`Mode: --limit ${args.limit}`);
  if (args.fromLawId !== null) console.log(`Mode: --from-law-id ${args.fromLawId}`);
  console.log(`Workers: ${args.workers}`);

  const seedFiles = fs.readdirSync(SEED_DIR)
    .filter(file => file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const targets: Array<{ file: string; lawId: number }> = [];
  for (const file of seedFiles) {
    const fullPath = path.join(SEED_DIR, file);
    const seed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as SeedDoc;
    const lawId = parseLawId(seed.id);
    if (lawId === null) continue;
    if (args.fromLawId !== null && lawId < args.fromLawId) continue;
    if (hasProvisionText(seed)) continue;
    targets.push({ file, lawId });
  }

  const limited = args.limit !== null ? targets.slice(0, args.limit) : targets;
  console.log(`Candidates with empty provisions: ${targets.length}`);
  console.log(`Planned in this run: ${limited.length}`);

  let processed = 0;
  let upgraded = 0;
  let stillTextless = 0;
  let fetchFailed = 0;
  const failures: string[] = [];

  let cursor = 0;
  const processTarget = async (target: { file: string; lawId: number }): Promise<void> => {
    const fullPath = path.join(SEED_DIR, target.file);
    const seed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as SeedDoc;

    let lawViewError: string | null = null;
    let lawArticlesError: string | null = null;
    let parsed: { provisions: NonNullable<SeedDoc['provisions']>; definitions: NonNullable<SeedDoc['definitions']> } = {
      provisions: [],
      definitions: [],
    };
    let sourceUsed: 'lawview' | 'lawarticles' | null = null;

    try {
      const html = await loadLawViewHtml(target.lawId, args);
      const parsedLawView = parseLawViewWordLegislation(html);
      if (parsedLawView.provisions.length > 0) {
        parsed = parsedLawView;
        sourceUsed = 'lawview';
      }
    } catch (error) {
      lawViewError = error instanceof Error ? error.message : String(error);
    }

    if (parsed.provisions.length === 0) {
      try {
        const parsedLawArticles = await parseLawViaLawArticles(target.lawId, args);
        if (parsedLawArticles && parsedLawArticles.provisions.length > 0) {
          parsed = parsedLawArticles;
          sourceUsed = 'lawarticles';
        }
      } catch (error) {
        lawArticlesError = error instanceof Error ? error.message : String(error);
      }
    }

    if (parsed.provisions.length > 0) {
      if (sourceUsed === 'lawview') {
        seed.url = lawViewUrl(target.lawId);
        seed.description = 'Official legislation text retrieved from Al Meezan LawViewWord Arabic source.';
      } else {
        seed.url = lawPageUrl(target.lawId);
        seed.description = 'Official legislation text retrieved from Al Meezan LawArticles Arabic source (LawViewWord unavailable).';
      }
      seed.provisions = parsed.provisions;
      seed.definitions = parsed.definitions;
      upgraded += 1;
    } else {
      seed.url = lawViewUrl(target.lawId);
      seed.provisions = [];
      seed.definitions = [];

      if (lawViewError || lawArticlesError) {
        const messageParts: string[] = [];
        if (lawViewError) messageParts.push(`LawViewWord: ${lawViewError}`);
        if (lawArticlesError) messageParts.push(`LawArticles fallback: ${lawArticlesError}`);
        const message = messageParts.join(' | ');
        seed.description = `Official Al Meezan metadata retained. Text fetch failed: ${message}`;
        fetchFailed += 1;
        failures.push(`${seed.id}: ${message}`);
      } else {
        seed.description = 'Official Al Meezan metadata retained. LawViewWord returned no article-level text.';
        stillTextless += 1;
      }
    }

    fs.writeFileSync(fullPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
    processed += 1;

    if (processed === 1 || processed % 25 === 0 || processed === limited.length) {
      console.log(`  ${processed}/${limited.length} -> ${seed.id}`);
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= limited.length) {
        return;
      }
      await processTarget(limited[index]!);
    }
  };

  const workers = Math.max(1, args.workers);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const report = {
    generated_at: new Date().toISOString(),
    options: args,
    summary: {
      candidates_total: targets.length,
      processed,
      upgraded,
      still_textless: stillTextless,
      fetch_failed: fetchFailed,
    },
    failures,
  };
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('\nBackfill summary');
  console.log('---------------');
  console.log(`Processed: ${processed}`);
  console.log(`Upgraded with text: ${upgraded}`);
  console.log(`Still textless: ${stillTextless}`);
  console.log(`Fetch failed: ${fetchFailed}`);
  console.log(`Report: ${REPORT_FILE}`);
}

main().catch(error => {
  console.error('Fatal backfill error:', error);
  process.exit(1);
});
