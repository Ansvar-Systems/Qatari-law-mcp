/**
 * Parsers for Al Meezan legislation ingestion.
 *
 * This module parses:
 * 1) The English laws index page (HTML table)
 * 2) Individual DOCX / legacy DOC files into article-level provisions
 * 3) Arabic LawViewWord HTML pages when English DOCX text is unavailable
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ListedLaw {
  raw_title: string;
  title_en: string;
  title_ar?: string;
  title: string;
  pdf_path: string;
  docx_path: string;
  pdf_url: string;
  docx_url: string;
  docx_file_name: string;
}

export interface ParsedProvision {
  provision_ref: string;
  section: string;
  title: string;
  content: string;
}

export interface ParsedDefinition {
  term: string;
  definition: string;
  source_provision?: string;
}

export interface ParsedDocument {
  id: string;
  type: 'statute';
  title: string;
  title_en: string;
  short_name: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  url: string;
  description: string;
  provisions: ParsedProvision[];
  definitions: ParsedDefinition[];
}

export interface TargetLawConfig {
  id: string;
  short_name: string;
  docx_file_name: string;
}

export interface SeedBuildOptions {
  sourceUrl?: string;
  sourceDescription?: string;
}

function cleanHrefPath(value: string): string {
  return decodeHtmlEntities(value).replace(/[\r\n\t]/g, '').trim();
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

function toAbsoluteAlMeezanUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const trimmed = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `https://www.almeezan.qa${trimmed}`;
}

function splitBilingualTitle(rawTitle: string): { title_en: string; title_ar?: string; title: string } {
  const cleaned = normaliseWhitespace(decodeHtmlEntities(stripHtml(rawTitle)));
  const arabicStart = cleaned.search(/[\u0600-\u06FF]/);

  if (arabicStart === -1) {
    return {
      title_en: cleaned,
      title: cleaned,
    };
  }

  const title_en = cleaned.slice(0, arabicStart).trim();
  const title_ar = cleaned.slice(arabicStart).trim();

  return {
    title_en: title_en || title_ar,
    title_ar,
    title: title_ar || title_en,
  };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parse Al Meezan English law list table rows.
 */
export function parseEnglishLawsList(html: string): ListedLaw[] {
  const rowRegex = /<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>\s*<a[^>]+href="([^"]+\.pdf)"[\s\S]*?<\/td>\s*<td[^>]*>\s*<a[^>]+href="([^"]+\.docx)"[\s\S]*?<\/td>\s*<\/tr>/gi;

  const laws: ListedLaw[] = [];
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(html)) !== null) {
    const rawTitle = match[1];
    const pdfPath = cleanHrefPath(match[2]);
    const docxPath = cleanHrefPath(match[3]);

    const titles = splitBilingualTitle(rawTitle);
    const decodedDocxPath = safeDecodeURIComponent(docxPath);
    const docxFileName = path.basename(decodedDocxPath);

    laws.push({
      raw_title: normaliseWhitespace(decodeHtmlEntities(stripHtml(rawTitle))),
      title_en: titles.title_en,
      title_ar: titles.title_ar,
      title: titles.title,
      pdf_path: pdfPath,
      docx_path: docxPath,
      pdf_url: toAbsoluteAlMeezanUrl(pdfPath),
      docx_url: toAbsoluteAlMeezanUrl(docxPath),
      docx_file_name: docxFileName,
    });
  }

  return laws;
}

function normaliseFileName(value: string): string {
  return normaliseWhitespace(value).toLowerCase();
}

export function findLawByDocxFileName(laws: ListedLaw[], fileName: string): ListedLaw | undefined {
  const needle = normaliseFileName(fileName);
  return laws.find(law => normaliseFileName(law.docx_file_name) === needle);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#160;/g, ' ')
    .replace(/\u00a0/g, ' ');
}

function readDocxXml(docxFilePath: string): string {
  return execFileSync('unzip', ['-p', docxFilePath, 'word/document.xml'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function extractParagraphsFromDocxXml(xml: string): string[] {
  const paragraphRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
  const paragraphs: string[] = [];

  let paragraphMatch: RegExpExecArray | null;
  while ((paragraphMatch = paragraphRegex.exec(xml)) !== null) {
    const paragraphXml = paragraphMatch[0]
      .replace(/<w:tab\s*\/?\s*>/g, '\t')
      .replace(/<w:br\s*\/?\s*>/g, '\n')
      .replace(/<w:br\s+[^>]*\/>/g, '\n');

    const textParts: string[] = [];
    const textRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g;

    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(paragraphXml)) !== null) {
      textParts.push(decodeXmlEntities(textMatch[1]));
    }

    if (textParts.length === 0) {
      continue;
    }

    const combined = textParts.join('');
    const cleaned = combined
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();

    if (!cleaned) {
      continue;
    }

    const underscoreOnly = cleaned.replace(/[\s_]/g, '') === '';
    if (underscoreOnly) {
      continue;
    }

    paragraphs.push(cleaned);
  }

  return paragraphs;
}

function extractParagraphsFromPlainText(text: string): string[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const paragraphs: string[] = [];
  let current: string[] = [];

  const flushCurrent = (): void => {
    if (current.length === 0) return;
    const combined = normaliseWhitespace(current.join(' '));
    current = [];
    if (!combined) return;

    const underscoreOnly = combined.replace(/[\s_]/g, '') === '';
    if (underscoreOnly) return;

    paragraphs.push(combined);
  };

  for (const rawLine of lines) {
    const line = normaliseWhitespace(rawLine);
    if (!line) {
      flushCurrent();
      continue;
    }
    current.push(line);
  }
  flushCurrent();

  return paragraphs;
}

function convertLegacyWordToText(wordFilePath: string): string | null {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'almeezan-doc-'));
  try {
    execFileSync('soffice', [
      '--headless',
      '--convert-to',
      'txt:Text',
      '--outdir',
      tempDir,
      wordFilePath,
    ], {
      stdio: 'ignore',
      maxBuffer: 64 * 1024 * 1024,
    });

    const expected = path.join(
      tempDir,
      `${path.basename(wordFilePath, path.extname(wordFilePath))}.txt`,
    );

    if (fs.existsSync(expected)) {
      return fs.readFileSync(expected, 'utf8');
    }

    const txtFiles = fs.readdirSync(tempDir).filter(file => file.toLowerCase().endsWith('.txt'));
    if (txtFiles.length === 0) {
      return null;
    }

    return fs.readFileSync(path.join(tempDir, txtFiles[0]!), 'utf8');
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

function readLegislationParagraphs(wordFilePath: string): string[] {
  try {
    const xml = readDocxXml(wordFilePath);
    return extractParagraphsFromDocxXml(xml);
  } catch (docxError) {
    const legacyText = convertLegacyWordToText(wordFilePath);
    if (legacyText) {
      return extractParagraphsFromPlainText(legacyText);
    }

    const message = docxError instanceof Error ? docxError.message : String(docxError);
    throw new Error(`Unable to read legislation source (${wordFilePath}): ${message}`);
  }
}

interface HeadingMatch {
  section: string;
  consumed: number;
  inlineText?: string;
}

const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

const ORDINAL_SECTION_MAP: Record<string, string> = {
  'first': '1',
  'second': '2',
  'third': '3',
  'fourth': '4',
  'fifth': '5',
  'sixth': '6',
  'seventh': '7',
  'eighth': '8',
  'ninth': '9',
  'tenth': '10',
  'eleventh': '11',
  'twelfth': '12',
  'thirteenth': '13',
  'fourteenth': '14',
  'fifteenth': '15',
  'sixteenth': '16',
  'seventeenth': '17',
  'eighteenth': '18',
  'nineteenth': '19',
  'twentieth': '20',
  'twenty-first': '21',
  'twenty-second': '22',
  'twenty-third': '23',
  'twenty-fourth': '24',
  'twenty-fifth': '25',
  'twenty-sixth': '26',
  'twenty-seventh': '27',
  'twenty-eighth': '28',
  'twenty-ninth': '29',
  'thirtieth': '30',
  // Arabic ordinal headings commonly used in decrees/announcements.
  'اولا': '1',
  'ثانيا': '2',
  'ثالثا': '3',
  'رابعا': '4',
  'خامسا': '5',
  'سادسا': '6',
  'سابعا': '7',
  'ثامنا': '8',
  'تاسعا': '9',
  'عاشرا': '10',
  'الحادي-عشر': '11',
  'الثاني-عشر': '12',
  'الثالث-عشر': '13',
  'الرابع-عشر': '14',
  'الخامس-عشر': '15',
  'السادس-عشر': '16',
  'السابع-عشر': '17',
  'الثامن-عشر': '18',
  'التاسع-عشر': '19',
  'العشرون': '20',
};

function normaliseDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, digit => DIGIT_MAP[digit] ?? digit);
}

function normaliseArabicOrdinal(value: string): string {
  return value
    .replace(/[\u064B-\u065F\u0670]/g, '') // diacritics
    .replace(/\u0640/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\u0621-\u064A\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-');
}

function parseSectionToken(value: string): string | null {
  const normalised = normaliseDigits(normaliseWhitespace(value))
    .replace(/[()]/g, '')
    .replace(/[.:،]/g, '')
    .trim();
  const numeric = normalised.match(/^([0-9]+[A-Za-z]?)$/);
  if (numeric) {
    return numeric[1];
  }

  const ordinalKey = normalised
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-');
  if (ordinalKey in ORDINAL_SECTION_MAP) {
    return ORDINAL_SECTION_MAP[ordinalKey];
  }

  const arabicOrdinalKey = normaliseArabicOrdinal(normalised);
  if (arabicOrdinalKey && arabicOrdinalKey in ORDINAL_SECTION_MAP) {
    return ORDINAL_SECTION_MAP[arabicOrdinalKey];
  }

  return null;
}

function matchOrdinalHeading(line: string): { section: string; inlineText?: string } | null {
  const compact = normaliseWhitespace(normaliseDigits(line));
  if (!compact) return null;

  const withText = compact.match(/^([A-Za-z\u0600-\u06FF]+(?:[-\s][A-Za-z\u0600-\u06FF]+)?)\s*[:.)\-،]\s*(.*)$/);
  if (withText) {
    const section = parseSectionToken(withText[1]);
    if (!section) return null;
    const inlineText = normaliseWhitespace(withText[2]);
    return { section, inlineText: inlineText || undefined };
  }

  const standalone = compact.match(/^([A-Za-z\u0600-\u06FF]+(?:[-\s][A-Za-z\u0600-\u06FF]+)?)\s*[:.)\-،]?$/);
  if (!standalone) return null;
  const section = parseSectionToken(standalone[1]);
  if (!section) return null;
  return { section };
}

function matchEnglishArticleHeading(line: string): { section: string; inlineText?: string } | null {
  const compact = normaliseWhitespace(normaliseDigits(line));
  const singleLine = compact.match(
    /^Article\s*\(?\s*([0-9]+[A-Za-z]?)\s*\)?(?:\s*[-–:.]\s*(.*)|\s+(.+))?(?:\s*\([^)]*\))?\s*$/i,
  );
  if (!singleLine) return null;

  const inlineText = normaliseWhitespace(singleLine[2] ?? singleLine[3] ?? '');
  return {
    section: singleLine[1],
    inlineText: inlineText || undefined,
  };
}

function matchArabicArticleHeading(line: string): { section: string; inlineText?: string } | null {
  const compact = normaliseWhitespace(normaliseDigits(line));
  const singleLine = compact.match(
    /^(?:المادة|مادة)\s*\(?\s*([0-9]+)\s*\)?(?:\s*[-–:.]\s*(.*)|\s+(.+))?(?:\s*\([^)]*\))?\s*$/,
  );
  if (!singleLine) return null;

  const inlineText = normaliseWhitespace(singleLine[2] ?? singleLine[3] ?? '');
  return {
    section: singleLine[1],
    inlineText: inlineText || undefined,
  };
}

function matchArticleHeading(lines: string[], index: number): HeadingMatch | null {
  const line = normaliseWhitespace(lines[index] ?? '');
  if (!line) return null;

  const englishHeading = matchEnglishArticleHeading(line);
  if (englishHeading) {
    return {
      section: englishHeading.section,
      consumed: 1,
      inlineText: englishHeading.inlineText,
    };
  }

  const arabicHeading = matchArabicArticleHeading(line);
  if (arabicHeading) {
    return {
      section: arabicHeading.section,
      consumed: 1,
      inlineText: arabicHeading.inlineText,
    };
  }

  const ordinalHeading = matchOrdinalHeading(line);
  if (ordinalHeading) {
    return {
      section: ordinalHeading.section,
      consumed: 1,
      inlineText: ordinalHeading.inlineText,
    };
  }

  const next = normaliseWhitespace(lines[index + 1] ?? '');
  if (next) {
    const lineDigits = normaliseDigits(line);
    const nextDigits = normaliseDigits(next);

    if (/^Article\s*\(?$/i.test(lineDigits) || /^Article$/i.test(lineDigits)) {
      const token = parseSectionToken(nextDigits);
      if (token) {
        return {
          section: token,
          consumed: 2,
        };
      }
    }

    if (/^(?:المادة|مادة)\s*\(?$/.test(lineDigits) || /^(?:المادة|مادة)$/.test(lineDigits)) {
      const token = parseSectionToken(nextDigits);
      if (token) {
        return {
          section: token,
          consumed: 2,
        };
      }
    }

    const combined = normaliseWhitespace(`${line} ${next}`);

    const combinedEnglish = matchEnglishArticleHeading(combined);
    if (combinedEnglish && line.length <= 80 && next.length <= 120) {
      return {
        section: combinedEnglish.section,
        consumed: 2,
        inlineText: combinedEnglish.inlineText,
      };
    }

    const combinedArabic = matchArabicArticleHeading(combined);
    if (combinedArabic && line.length <= 80 && next.length <= 120) {
      return {
        section: combinedArabic.section,
        consumed: 2,
        inlineText: combinedArabic.inlineText,
      };
    }

    const combinedOrdinal = matchOrdinalHeading(combined);
    if (combinedOrdinal && line.length <= 80 && next.length <= 200) {
      return {
        section: combinedOrdinal.section,
        consumed: 2,
        inlineText: combinedOrdinal.inlineText,
      };
    }
  }

  return null;
}

function makeProvisionRef(section: string): string {
  const normalised = section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `art${normalised || section.toLowerCase()}`;
}

function extractDefinitions(provisions: ParsedProvision[]): ParsedDefinition[] {
  const definitions: ParsedDefinition[] = [];
  const seen = new Set<string>();

  const candidates = provisions.filter(p =>
    /^1$/i.test(p.section) || /definition/i.test(p.title) || /means/i.test(p.content)
  );

  const definitionRegex = /(?:^|[.;]\s+)(?:"|“|')?([A-Za-z][A-Za-z0-9\-()\/, ]{1,80})(?:"|”|')?\s+means\s+([^.;\n]{10,500})/gi;

  for (const provision of candidates) {
    let match: RegExpExecArray | null;
    while ((match = definitionRegex.exec(provision.content)) !== null) {
      const term = normaliseWhitespace(match[1]);
      const definition = normaliseWhitespace(match[2]);
      if (term.length < 2 || definition.length < 10) continue;

      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      definitions.push({
        term,
        definition,
        source_provision: provision.provision_ref,
      });

      if (definitions.length >= 50) {
        return definitions;
      }
    }
  }

  return definitions;
}

function parseLinesToDocument(lines: string[]): { provisions: ParsedProvision[]; definitions: ParsedDefinition[] } {
  if (lines.length === 0) {
    return { provisions: [], definitions: [] };
  }

  const provisions: ParsedProvision[] = [];

  let currentSection: string | null = null;
  let currentLines: string[] = [];

  const flushCurrent = (): void => {
    if (!currentSection) return;

    const content = currentLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!content) {
      currentSection = null;
      currentLines = [];
      return;
    }

    provisions.push({
      provision_ref: makeProvisionRef(currentSection),
      section: currentSection,
      title: `Article (${currentSection})`,
      content,
    });

    currentSection = null;
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const heading = matchArticleHeading(lines, i);
    if (heading) {
      flushCurrent();
      currentSection = heading.section;
      currentLines = [];
      if (heading.inlineText) {
        currentLines.push(heading.inlineText);
      }
      i += heading.consumed - 1;
      continue;
    }

    if (!currentSection) {
      continue;
    }

    currentLines.push(lines[i]);
  }

  flushCurrent();

  // Dedupe by provision_ref while keeping the most complete content.
  const byRef = new Map<string, ParsedProvision>();
  for (const provision of provisions) {
    const existing = byRef.get(provision.provision_ref);
    if (!existing || provision.content.length > existing.content.length) {
      byRef.set(provision.provision_ref, provision);
    }
  }

  const deduped = Array.from(byRef.values());
  const definitions = extractDefinitions(deduped);

  return { provisions: deduped, definitions };
}

function buildSingleProvisionFallback(lines: string[]): { provisions: ParsedProvision[]; definitions: ParsedDefinition[] } | null {
  const meaningful = lines
    .map(line => normaliseWhitespace(line))
    .filter(line => line.length > 0)
    .filter(line => !/^فهرس الموضوعات$/.test(line))
    .filter(line => !/^المواد$/.test(line))
    .filter(line => !/^عدد المواد\s*:/.test(line))
    .filter(line => !/^الميزان\s*\|/.test(line))
    .filter(line => !/^الرجاء عدم اعتبار/.test(line));

  if (meaningful.length === 0) {
    return null;
  }

  const content = meaningful.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (content.length < 40) {
    return null;
  }

  return {
    provisions: [
      {
        provision_ref: 'art1',
        section: '1',
        title: 'Article (1)',
        content,
      },
    ],
    definitions: [],
  };
}

function extractElementInnerHtmlById(html: string, elementId: string, tagName = 'div'): string | null {
  const startRegex = new RegExp(`<${tagName}\\b[^>]*\\bid=["']${elementId}["'][^>]*>`, 'i');
  const startMatch = startRegex.exec(html);
  if (!startMatch) return null;

  const contentStart = startMatch.index + startMatch[0].length;
  const tokenRegex = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, 'gi');
  tokenRegex.lastIndex = contentStart;

  let depth = 1;
  let token: RegExpExecArray | null;
  while ((token = tokenRegex.exec(html)) !== null) {
    if (/^<\//.test(token[0])) {
      depth -= 1;
    } else {
      depth += 1;
    }

    if (depth === 0) {
      return html.slice(contentStart, token.index);
    }
  }

  return null;
}

function htmlToCleanLines(html: string): string[] {
  const text = decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|td|table|h[1-6])>/gi, '\n')
      .replace(/<hr\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, ''),
  );

  return text
    .split('\n')
    .map(line => normaliseWhitespace(line))
    .filter(line => line.length > 0)
    .filter(line => !/^فهرس الموضوعات$/.test(line))
    .filter(line => !/^المواد$/.test(line))
    .filter(line => !/^الميزان\s*\|/.test(line))
    .filter(line => !/^الرجاء عدم اعتبار/.test(line));
}

function extractLawViewWordLines(html: string): string[] {
  const treeDetails = extractElementInnerHtmlById(html, 'divTreeDetails');
  if (treeDetails) {
    return htmlToCleanLines(treeDetails);
  }

  const notes = extractElementInnerHtmlById(html, 'NotesHolders');
  if (notes) {
    return htmlToCleanLines(notes);
  }

  return htmlToCleanLines(html);
}

export function parseDocxLegislation(docxFilePath: string): { provisions: ParsedProvision[]; definitions: ParsedDefinition[] } {
  const paragraphs = readLegislationParagraphs(docxFilePath);
  return parseLinesToDocument(paragraphs);
}

export function parseLawViewWordLegislation(html: string): { provisions: ParsedProvision[]; definitions: ParsedDefinition[] } {
  const primaryLines = extractLawViewWordLines(html);
  const primary = parseLinesToDocument(primaryLines);
  if (primary.provisions.length > 0) {
    return primary;
  }

  // Fallback parser pass on full HTML body if main content wrappers are not present.
  const fallbackLines = htmlToCleanLines(html);
  const fallback = parseLinesToDocument(fallbackLines);
  if (fallback.provisions.length > 0) {
    return fallback;
  }

  const singleFromPrimary = buildSingleProvisionFallback(primaryLines);
  if (singleFromPrimary) {
    return singleFromPrimary;
  }

  const singleFromFallback = buildSingleProvisionFallback(fallbackLines);
  if (singleFromFallback) {
    return singleFromFallback;
  }

  return fallback;
}

export function buildSeedDocument(
  target: TargetLawConfig,
  law: ListedLaw,
  parsed: { provisions: ParsedProvision[]; definitions: ParsedDefinition[] },
  options: SeedBuildOptions = {},
): ParsedDocument {
  const title = law.title_ar || law.title_en;
  const titleEn = law.title_en || law.title;

  return {
    id: target.id,
    type: 'statute',
    title,
    title_en: titleEn,
    short_name: target.short_name,
    status: 'in_force',
    url: options.sourceUrl ?? law.docx_url,
    description: options.sourceDescription ?? 'Official legislation text retrieved from Al Meezan Legal Portal.',
    provisions: parsed.provisions,
    definitions: parsed.definitions,
  };
}
