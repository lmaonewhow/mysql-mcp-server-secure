# Changelog

## 2026-02-06
- [feat][mysql-mcp-server-secure] add secure MCP MySQL server with permission controls and tool surface (id=cl_20260206_0001, ts=2026-02-06T05:31:00-07:00)
  - impact: new standalone MCP server project for MySQL with glob table access rules
  - risk: low; defaults to read-only with env-configured permissions
  - verify: npm install && npm run build
- [docs][mysql-mcp-server-secure] refresh README with bilingual structure and sanitized examples; add gitignore for dependencies (id=cl_20260206_0002, ts=2026-02-06T10:31:00-07:00)
  - impact: clearer onboarding docs and safer example configuration
  - risk: low
  - verify: manual review
