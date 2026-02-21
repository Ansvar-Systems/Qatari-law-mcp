# Qatari Law MCP

Qatari law database for cybersecurity compliance via Model Context Protocol (MCP).

## Features

- **Full-text search** across legislation provisions (FTS5 with BM25 ranking)
- **Article-level retrieval** for specific legal provisions
- **Citation validation** to prevent hallucinated references
- **Currency checks** to verify if laws are still in force

## Quick Start

### Claude Code (Remote)
```bash
claude mcp add qatari-law --transport http https://qatari-law-mcp.vercel.app/mcp
```

### Local (npm)
```bash
npx @ansvar/qatari-law-mcp
```

## Data Sources

Real legislation ingested from the official Al Meezan legal portal (https://www.almeezan.qa), with full Arabic year-index law coverage as official metadata records and full article text from the English DOCX collection where available.

## License

Apache-2.0
