# WARDEN P5 Ingestion

P5 adds `ingestDocument` for local text, HTML, and dependency-free PDF-lite ingestion.

Supported paths:

- `.txt` and other text-like files through `parseTextDocument`
- `.html` / `.htm` through `parseHtmlDocument`
- `.pdf` through `parsePdfDocument`

Every ingested `KnowledgeUnit` includes:

- `sourceUri`
- `sourceType`
- `extractedAt`
- document hash
- parser version
- provenance

The PDF parser is intentionally lightweight and emits a warning. Its output must be reviewed before operational use.
