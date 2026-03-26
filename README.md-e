# Qatari Law MCP Server

**The Qatar e-Legislation Portal alternative for the AI age.**

[![npm version](https://badge.fury.io/js/@ansvar%2Fqatari-law-mcp.svg)](https://www.npmjs.com/package/@ansvar/qatari-law-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/Qatari-law-mcp?style=social)](https://github.com/Ansvar-Systems/Qatari-law-mcp)
[![CI](https://github.com/Ansvar-Systems/Qatari-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/Qatari-law-mcp/actions/workflows/ci.yml)
[![Daily Data Check](https://github.com/Ansvar-Systems/Qatari-law-mcp/actions/workflows/check-updates.yml/badge.svg)](https://github.com/Ansvar-Systems/Qatari-law-mcp/actions/workflows/check-updates.yml)
[![Database](https://img.shields.io/badge/database-pre--built-green)](https://github.com/Ansvar-Systems/Qatari-law-mcp)
[![Provisions](https://img.shields.io/badge/provisions-71%2C155-blue)](https://github.com/Ansvar-Systems/Qatari-law-mcp)

Query **9,428 Qatari statutes** -- from قانون حماية البيانات الشخصية and قانون العقوبات to قانون التجارة, قانون الشركات, and more -- directly from Claude, Cursor, or any MCP-compatible client.

If you're building legal tech, compliance tools, or doing Qatari legal research, this is your verified reference database.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Why This Exists

Qatari legal research means navigating ميزان (almeezan.qa), Qatar's official legislative portal, across thousands of statutes in Arabic with limited cross-referencing tools. Whether you're:

- A **lawyer** validating citations in a brief or contract
- A **compliance officer** checking Qatar data protection or financial services obligations
- A **legal tech developer** building tools on Qatari law
- A **researcher** tracing legislative provisions across commercial, criminal, and civil codes

...you shouldn't need dozens of browser tabs and manual Arabic-language cross-referencing. Ask Claude. Get the exact provision. With context.

This MCP server makes Qatari law **searchable, cross-referenceable, and AI-readable**.

---

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version -- zero dependencies, nothing to install.

**Endpoint:** `https://qatari-law-mcp.vercel.app/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add qatari-law --transport http https://qatari-law-mcp.vercel.app/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** -- add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "qatari-law": {
      "type": "url",
      "url": "https://qatari-law-mcp.vercel.app/mcp"
    }
  }
}
```

**GitHub Copilot** -- add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "qatari-law": {
      "type": "http",
      "url": "https://qatari-law-mcp.vercel.app/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/qatari-law-mcp
```

**Claude Desktop** -- add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "qatari-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/qatari-law-mcp"]
    }
  }
}
```

**Cursor / VS Code:**

```json
{
  "mcp.servers": {
    "qatari-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/qatari-law-mcp"]
    }
  }
}
```

---

## Example Queries

Once connected, just ask naturally:

- *"البحث عن أحكام 'حماية البيانات الشخصية' في التشريعات القطرية"*
- *"ماذا يقول قانون العقوبات القطري عن الجرائم الإلكترونية؟"*
- *"أوجد أحكام القانون المدني القطري المتعلقة بالتعويضات"*
- *"ما هي القوانين التي تنظم التجارة الإلكترونية في قطر؟"*
- *"هل قانون حماية البيانات الشخصية لا يزال سارياً؟"*
- *"Search for provisions about financial services regulation in Qatari law"*
- *"What international frameworks does Qatar's data protection law align with?"*
- *"Validate the citation 'المادة 5 من قانون حماية البيانات الشخصية'"*

---

## What's Included

| Category | Count | Details |
|----------|-------|---------|
| **Statutes** | 9,428 statutes | Comprehensive Qatari legislation from almeezan.qa |
| **Provisions** | 71,155 sections | Full-text searchable with FTS5 |
| **Legal Definitions** | 0 (free tier) | Table reserved, extraction not enabled in current free build |
| **Database Size** | Optimized SQLite | Portable, pre-built |
| **Daily Updates** | Automated | Freshness checks against ميزان portal |

**Verified data only** -- every citation is validated against official sources (almeezan.qa). Zero LLM-generated content.

---

## See It In Action

### Why This Works

**Verbatim Source Text (No LLM Processing):**
- All statute text is ingested from almeezan.qa (ميزان - بوابة التشريعات القطرية) official sources
- Provisions are returned **unchanged** from SQLite FTS5 database rows
- Zero LLM summarization or paraphrasing -- the database contains regulation text, not AI interpretations

**Smart Context Management:**
- Search returns ranked provisions with BM25 scoring (safe for context)
- Provision retrieval gives exact text by statute identifier + chapter/section
- Cross-references help navigate without loading everything at once

**Technical Architecture:**
```
almeezan.qa --> Parse --> SQLite --> FTS5 snippet() --> MCP response
                  ^                        ^
           Provision parser         Verbatim database query
```

### Traditional Research vs. This MCP

| Traditional Approach | This MCP Server |
|---------------------|-----------------|
| Search ميزان by decree number | Search by plain Arabic: *"حماية البيانات الموافقة"* |
| Navigate multi-chapter statutes manually | Get the exact provision with context |
| Manual cross-referencing between laws | `build_legal_stance` aggregates across sources |
| "Is this statute still in force?" -- check manually | `check_currency` tool -- answer in seconds |
| Find international alignment -- dig through multiple portals | `get_eu_basis` -- linked international frameworks instantly |
| No API, no integration | MCP protocol -- AI-native |

**Traditional:** Search almeezan.qa --> Download PDF --> Ctrl+F --> Cross-reference with related decrees --> Check GCC framework alignment --> Repeat

**This MCP:** *"ما هي متطلبات حماية البيانات الشخصية في قطر وكيف تتوافق مع المعايير الدولية؟"* -- Done.

---

## Available Tools (13)

### Core Legal Research Tools (8)

| Tool | Description |
|------|-------------|
| `search_legislation` | FTS5 full-text search across 71,155 provisions with BM25 ranking. Supports Arabic and English queries |
| `get_provision` | Retrieve specific provision by statute identifier + article number |
| `check_currency` | Check if a statute is in force, amended, or repealed |
| `validate_citation` | Validate citation against database -- zero-hallucination check |
| `build_legal_stance` | Aggregate citations from multiple statutes for a legal topic |
| `format_citation` | Format citations per Qatari conventions |
| `list_sources` | List all available statutes with metadata, coverage scope, and data provenance |
| `about` | Server info, capabilities, dataset statistics, and coverage summary |

### International Law Integration Tools (5)

| Tool | Description |
|------|-------------|
| `get_eu_basis` | Get international frameworks that a Qatari statute aligns with |
| `get_qatari_implementations` | Find Qatari laws aligning with international standards or frameworks |
| `search_eu_implementations` | Search international documents with Qatari alignment counts |
| `get_provision_eu_basis` | Get international law references for a specific provision |
| `validate_eu_compliance` | Check alignment status of Qatari statutes against international frameworks |

---

## International Law Alignment

Qatar is not an EU member state, but Qatari law aligns with several international legal frameworks:

- **GCC framework:** Qatar participates in Gulf Cooperation Council harmonised legislation, including the GCC Model Data Protection Law and unified commercial law frameworks
- **Arab League conventions:** Qatar is a signatory to Arab League conventions on civil and criminal cooperation, including the Arab Convention on Combating Information Technology Crimes
- **UNCITRAL:** Qatari commercial and arbitration law incorporates UNCITRAL model law principles
- **FATF standards:** Qatari AML/CFT legislation aligns with FATF Recommendations
- **WTO membership:** Qatar's trade and intellectual property legislation aligns with WTO/TRIPS obligations

The international bridge tools allow you to explore these alignment relationships -- checking which Qatari provisions correspond to international requirements, and vice versa.

> **Note:** International cross-references reflect alignment relationships, not transposition. Qatar adopts its own legislative approach based on civil law principles with Islamic law influences, and the international tools help identify where Qatari and international frameworks address similar domains.

---

## Data Sources & Freshness

All content is sourced from authoritative Qatari legal databases:

- **[almeezan.qa](https://www.almeezan.qa/)** -- ميزان - بوابة التشريعات القطرية (Qatar e-Legislation Portal), official legislative database

### Data Provenance

| Field | Value |
|-------|-------|
| **Authority** | وزارة العدل (Ministry of Justice, Qatar) |
| **Retrieval method** | Structured data from almeezan.qa |
| **Languages** | Arabic (primary) |
| **License** | Public domain (Qatari government official publications) |
| **Coverage** | 9,428 statutes across all legislative domains |

### Automated Freshness Checks (Daily)

A [daily GitHub Actions workflow](.github/workflows/check-updates.yml) monitors all data sources:

| Source | Check | Method |
|--------|-------|--------|
| **Statute amendments** | almeezan.qa date comparison | All statutes checked |
| **New statutes** | Official gazette publications | Diffed against database |
| **Repealed statutes** | Status change detection | Flagged automatically |

**Verified data only** -- every citation is validated against official sources. Zero LLM-generated content.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **OSSF Scorecard** | OpenSSF best practices scoring | Weekly |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from almeezan.qa (ميزان - Ministry of Justice Qatar). However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Court case coverage is not included** -- do not rely solely on this for case law research
> - **Verify critical citations** against primary sources for court filings
> - **International cross-references** reflect alignment relationships, not transposition
> - **Sharia law principles** may apply in certain areas and are not fully captured in codified statute text

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. See [PRIVACY.md](PRIVACY.md) for guidance compliant with Qatar Bar Association (نقابة المحامين القطريين) professional responsibility rules.

---

## Documentation

- **[International Integration Guide](docs/INTERNATIONAL_INTEGRATION_GUIDE.md)** -- Detailed cross-reference documentation
- **[Security Policy](SECURITY.md)** -- Vulnerability reporting and scanning details
- **[Disclaimer](DISCLAIMER.md)** -- Legal disclaimers and professional use notices
- **[Privacy](PRIVACY.md)** -- Client confidentiality and data handling

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/Qatari-law-mcp
cd Qatari-law-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run ingest          # Ingest statutes from almeezan.qa
npm run build:db        # Rebuild SQLite database
npm run drift:detect    # Run drift detection against known anchors
npm run check-updates   # Check for source updates
```

### Performance

- **Search Speed:** <100ms for most FTS5 queries
- **Reliability:** 100% ingestion success rate

---

## Related Projects: Complete Compliance Suite

This server is part of **Ansvar's Compliance Suite** -- MCP servers that work together for end-to-end compliance coverage:

### [@ansvar/eu-regulations-mcp](https://github.com/Ansvar-Systems/EU_compliance_MCP)
**Query 49 EU regulations directly from Claude** -- GDPR, AI Act, DORA, NIS2, MiFID II, eIDAS, and more. Full regulatory text with article-level search. `npx @ansvar/eu-regulations-mcp`

### [@ansvar/qatari-law-mcp](https://github.com/Ansvar-Systems/Qatari-law-mcp) (This Project)
**Query 9,428 Qatari statutes directly from Claude** -- قانون حماية البيانات الشخصية, قانون العقوبات, القانون المدني, and more. `npx @ansvar/qatari-law-mcp`

### [@ansvar/security-controls-mcp](https://github.com/Ansvar-Systems/security-controls-mcp)
**Query 261 security frameworks** -- ISO 27001, NIST CSF, SOC 2, CIS Controls, SCF, and more. `npx @ansvar/security-controls-mcp`

### [@ansvar/sanctions-mcp](https://github.com/Ansvar-Systems/Sanctions-MCP)
**Offline-capable sanctions screening** -- OFAC, EU, UN sanctions lists. `pip install ansvar-sanctions-mcp`

**100+ national law MCPs** covering Australia, Belgium, Brazil, Canada, Denmark, Finland, France, Germany, Ireland, Italy, Netherlands, Norway, Poland, Sweden, Switzerland, UK, UAE, and more.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Court case law expansion (Qatari courts)
- GCC framework cross-reference expansion
- Historical statute versions and amendment tracking
- English translations for key statutes

---

## Roadmap

- [x] Core statute database with FTS5 search
- [x] Full corpus ingestion (9,428 statutes, 71,155 provisions)
- [x] International law alignment tools
- [x] Vercel Streamable HTTP deployment
- [x] npm package publication
- [x] Daily freshness checks
- [ ] Court case law expansion
- [ ] Historical statute versions (amendment tracking)
- [ ] English translations for key statutes
- [ ] GCC harmonised legislation cross-references

---

## Citation

If you use this MCP server in academic research:

```bibtex
@software{qatari_law_mcp_2026,
  author = {Ansvar Systems AB},
  title = {Qatari Law MCP Server: AI-Powered Legal Research Tool},
  year = {2026},
  url = {https://github.com/Ansvar-Systems/Qatari-law-mcp},
  note = {9,428 Qatari statutes with 71,155 provisions}
}
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

- **Statutes & Legislation:** وزارة العدل قطر / Ministry of Justice Qatar (public domain, official government publications)
- **International Metadata:** Public domain

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the global market. This MCP server started as our internal reference tool for Qatari law -- turns out everyone building compliance tools for businesses operating in Qatar has the same research frustrations.

So we're open-sourcing it. Navigating 9,428 statutes shouldn't require 47 browser tabs.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
