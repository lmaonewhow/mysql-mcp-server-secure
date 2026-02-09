# Changelog

## 2026-02-09
- [fix][mysql-mcp-server-secure] remove session-level default source switching; require explicit source for non-default queries (id=cl_20260209_0001, ts=2026-02-09T01:05:00-07:00)
  - impact: default source is fixed by DEFAULT_SOURCE/config.json; non-default queries must pass source parameter
  - risk: low; keeps legacy single-source behavior unchanged
  - verify: npm run build

## 2026-02-08
- [feat][mysql-mcp-server-secure] add multi-source config.json support and session-level default source switching (id=cl_20260208_0001, ts=2026-02-08T18:20:00-07:00)
  - impact: support multiple MySQL sources with per-source permissions; allow switching default source during a session via tool
  - risk: low; defaults remain compatible with legacy single-source env configuration
  - verify: npm run build

## 2026-02-06
- [feat][mysql-mcp-server-secure] add secure MCP MySQL server with permission controls and tool surface (id=cl_20260206_0001, ts=2026-02-06T05:31:00-07:00)
  - impact: new standalone MCP server project for MySQL with glob table access rules
  - risk: low; defaults to read-only with env-configured permissions
  - verify: npm install && npm run build
- [docs][mysql-mcp-server-secure] refresh README with bilingual structure and sanitized examples; add gitignore for dependencies (id=cl_20260206_0002, ts=2026-02-06T10:31:00-07:00)
  - impact: clearer onboarding docs and safer example configuration
  - risk: low
  - verify: manual review
- [docs][mysql-mcp-server-secure] update clone URL to lmaonewhow; add MIT LICENSE file (id=cl_20260206_0003, ts=2026-02-06T10:47:00-07:00)
  - impact: correct installation instructions and proper open-source licensing
  - risk: low
  - verify: check LICENSE file and README clone URL
