/**
 * Parsers for Al Meezan legislation ingestion.
 *
 * This module parses:
 * 1) The English laws index page (HTML table)
 * 2) Individual DOCX files into article-level provisions
 */

import { execFileSync } from 'child_process';
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
    const pdfPath = normaliseWhitespace(decodeHtmlEntities(match[2]));
    const docxPath = normaliseWhitespace(decodeHtmlEntities(match[3]));

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
  try {
    return execFileSync('unzip', ['-p', docxFilePath, 'word/document.xml'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read DOCX XML (${docxFilePath}): ${message}`);
  }
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

interface HeadingMatch {
  section: string;
  consumed: number;
  inlineText?: string;
}

function parseSectionToken(value: string): string | null {
  const match = value.match(/^\(?\s*([0-9]+[A-Za-z]?)\s*\)?$/);
  return match ? match[1] : null;
}

function matchArticleHeading(lines: string[], index: number): HeadingMatch | null {
  const line = normaliseWhitespace(lines[index] ?? '');
  if (!line) return null;

  const singleLine = line.match(/^Article\s*\(?\s*([0-9]+[A-Za-z]?)\s*\)?(?:\s*[-–:.]\s*(.*))?$/i);
  if (singleLine) {
    const inlineText = singleLine[2]?.trim();
    return {
      section: singleLine[1],
      consumed: 1,
      inlineText: inlineText || undefined,
    };
  }

  const next = normaliseWhitespace(lines[index + 1] ?? '');
  if (next) {
    if (/^Article\s*\(?$/i.test(line) || /^Article$/i.test(line)) {
      const token = parseSectionToken(next);
      if (token) {
        return {
          section: token,
          consumed: 2,
        };
      }
    }

    const combined = normaliseWhitespace(`${line} ${next}`);
    const combinedLine = combined.match(/^Article\s*\(?\s*([0-9]+[A-Za-z]?)\s*\)?(?:\s*[-–:.]\s*(.*))?$/i);
    if (combinedLine && line.length <= 40 && next.length <= 40) {
      const inlineText = combinedLine[2]?.trim();
      return {
        section: combinedLine[1],
        consumed: 2,
        inlineText: inlineText || undefined,
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

export function parseDocxLegislation(docxFilePath: string): { provisions: ParsedProvision[]; definitions: ParsedDefinition[] } {
  const xml = readDocxXml(docxFilePath);
  const paragraphs = extractParagraphsFromDocxXml(xml);

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

  for (let i = 0; i < paragraphs.length; i++) {
    const heading = matchArticleHeading(paragraphs, i);
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

    currentLines.push(paragraphs[i]);
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

export function buildSeedDocument(
  target: TargetLawConfig,
  law: ListedLaw,
  parsed: { provisions: ParsedProvision[]; definitions: ParsedDefinition[] },
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
    url: law.docx_url,
    description: 'Official legislation text retrieved from Al Meezan Legal Portal (English laws collection).',
    provisions: parsed.provisions,
    definitions: parsed.definitions,
  };
}
