#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { minimatch } from "minimatch";

// Permission configuration interface
interface PermissionConfig {
  allowedSqlTypes: string[];
  tablePatterns: string[];
  allowedDatabases: string[];
  allowMultiStatement: boolean;
  readOnly: boolean;
}

// Load configuration from environment variables
function loadPermissionConfig(): PermissionConfig {
  const allowedSqlTypes = process.env.ALLOWED_SQL_TYPES ? 
    process.env.ALLOWED_SQL_TYPES.split(',').map(s => s.trim().toUpperCase()) :
    ['SELECT']; // Default read-only
  
  const tablePatterns = process.env.TABLE_PATTERNS ?
    process.env.TABLE_PATTERNS.split(',').map(s => s.trim()) :
    ['*']; // Default allow all tables
  
  const allowedDatabases = process.env.ALLOWED_DATABASES ?
    process.env.ALLOWED_DATABASES.split(',').map(s => s.trim()) :
    ['*']; // Default allow all databases
  
  const readOnly = process.env.READ_ONLY !== 'false'; // Default true
  const allowMultiStatement = process.env.ALLOW_MULTI_STATEMENT === 'true'; // Default false
  
  return {
    allowedSqlTypes,
    tablePatterns,
    allowedDatabases,
    allowMultiStatement,
    readOnly
  };
}

type JsonObject = Record<string, unknown>;

interface SourceConfig {
  connection: {
    host: string;
    user: string;
    password: string;
    port: number;
    database?: string;
    waitForConnections: boolean;
    connectionLimit: number;
    queueLimit: number;
  };
  permissions: PermissionConfig;
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    out.push(item);
  }
  return out;
}

interface ServerConfigFile {
  defaultSource?: string;
  sources?: Record<string, unknown>;
}

function loadServerConfigFile(): { config?: ServerConfigFile; resolvedPath?: string } {
  const explicit = process.env.MYSQL_MCP_CONFIG_PATH;
  const candidates: string[] = [];
  if (explicit && explicit.trim() !== '') candidates.push(explicit);
  candidates.push(path.join(process.cwd(), '.mysql-mcp-server-secure', 'config.json'));

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isPlainObject(parsed)) {
        throw new Error(`Invalid config file: expected JSON object at ${candidate}`);
      }

      const defaultSource = getString(parsed.defaultSource);
      let sources: Record<string, unknown>;
      if (isPlainObject((parsed as JsonObject).sources)) {
        sources = (parsed as any).sources as Record<string, unknown>;
      } else {
        const tmp: Record<string, unknown> = { ...(parsed as JsonObject) };
        delete (tmp as any).defaultSource;
        sources = tmp;
      }

      return {
        config: {
          defaultSource,
          sources: sources as Record<string, unknown>
        },
        resolvedPath: candidate
      };
    } catch (error: any) {
      throw new Error(`Failed to load config file '${candidate}': ${error?.message || String(error)}`);
    }
  }

  return {};
}

// MySQL connection configuration
function loadDefaultConnectionConfig() {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    port: parseInt(process.env.DB_PORT || "3306"),
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
}

function normalizePermissionConfig(base: PermissionConfig, override: unknown): PermissionConfig {
  if (!isPlainObject(override)) return base;

  const allowedSqlTypes = getStringArray(override.allowedSqlTypes)?.map(s => s.trim().toUpperCase()) ?? base.allowedSqlTypes;
  const tablePatterns = getStringArray(override.tablePatterns)?.map(s => s.trim()) ?? base.tablePatterns;
  const allowedDatabases = getStringArray(override.allowedDatabases)?.map(s => s.trim()) ?? base.allowedDatabases;
  const allowMultiStatement = getBoolean(override.allowMultiStatement) ?? base.allowMultiStatement;
  const readOnly = getBoolean(override.readOnly) ?? base.readOnly;

  return {
    allowedSqlTypes,
    tablePatterns,
    allowedDatabases,
    allowMultiStatement,
    readOnly
  };
}

function loadSourceConfigs(): Record<string, SourceConfig> {
  const basePermissions = loadPermissionConfig();
  const baseConnection = loadDefaultConnectionConfig();

  const { config: fileConfig } = loadServerConfigFile();

  const rawSources = process.env.MYSQL_SOURCES;
  let envParsed: unknown;
  if (rawSources) {
    try {
      envParsed = JSON.parse(rawSources);
    } catch (error: any) {
      throw new Error(`Invalid MYSQL_SOURCES JSON: ${error?.message || String(error)}`);
    }
    if (!isPlainObject(envParsed)) {
      throw new Error("Invalid MYSQL_SOURCES: expected an object mapping sourceName -> config");
    }
  }

  const fileParsed = fileConfig?.sources;
  const mergedRawSources: Record<string, unknown> = {
    ...(isPlainObject(fileParsed) ? fileParsed : {}),
    ...(isPlainObject(envParsed) ? envParsed : {})
  };

  if (Object.keys(mergedRawSources).length === 0) {
    return {
      default: {
        connection: baseConnection,
        permissions: basePermissions
      }
    };
  }

  const sources: Record<string, SourceConfig> = {};
  for (const [sourceName, sourceValue] of Object.entries(mergedRawSources)) {
    if (!isPlainObject(sourceValue)) {
      throw new Error(`Invalid source '${sourceName}': expected object`);
    }

    const rawConnection = isPlainObject(sourceValue.connection) ? sourceValue.connection : sourceValue;

    const host = getString(rawConnection.host) ?? baseConnection.host;
    const user = getString(rawConnection.user) ?? baseConnection.user;
    const password = getString(rawConnection.password) ?? baseConnection.password;
    const port = getNumber(rawConnection.port) ?? baseConnection.port;
    const database = getString(rawConnection.database) ?? baseConnection.database;
    const connectionLimit = getNumber(rawConnection.connectionLimit) ?? baseConnection.connectionLimit;
    const queueLimit = getNumber(rawConnection.queueLimit) ?? baseConnection.queueLimit;
    const waitForConnections = getBoolean(rawConnection.waitForConnections) ?? baseConnection.waitForConnections;

    sources[sourceName] = {
      connection: {
        host,
        user,
        password,
        port,
        database,
        waitForConnections,
        connectionLimit,
        queueLimit
      },
      permissions: normalizePermissionConfig(basePermissions, sourceValue.permissions)
    };
  }

  if (Object.keys(sources).length === 0) {
    throw new Error("Invalid MYSQL_SOURCES: no sources provided");
  }

  return sources;
}

const { config: FILE_CONFIG, resolvedPath: CONFIG_FILE_PATH } = loadServerConfigFile();

const SOURCE_CONFIGS = loadSourceConfigs();
const DEFAULT_SOURCE = process.env.DEFAULT_SOURCE || FILE_CONFIG?.defaultSource || Object.keys(SOURCE_CONFIGS)[0];

function getSourceConfig(source?: string): { sourceName: string; config: SourceConfig } {
  const sourceName = (source && source.trim() !== '') ? source : DEFAULT_SOURCE;
  const config = SOURCE_CONFIGS[sourceName];
  if (!config) {
    throw new Error(`Unknown source '${sourceName}'. Available sources: ${Object.keys(SOURCE_CONFIGS).join(', ')}`);
  }
  return { sourceName, config };
}

// MySQL connection pool
const POOLS = new Map<string, any>();

function getPool(source?: string, database?: string) {
  const { sourceName, config } = getSourceConfig(source);
  const targetDatabase = database || config.connection.database;
  const key = `${sourceName}::${targetDatabase || ''}`;
  const existing = POOLS.get(key);
  if (existing) return existing;

  const poolConfig: any = { ...config.connection };
  if (targetDatabase) {
    poolConfig.database = targetDatabase;
  } else {
    delete poolConfig.database;
  }

  const pool = mysql.createPool(poolConfig);
  POOLS.set(key, pool);
  return pool;
}

// MCP Server setup
const server = new Server(
  {
    name: "mysql-mcp-server-secure",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper function - Execute MySQL query
async function executeQuery(sql: string, database?: string, source?: string): Promise<any> {
  try {
    const pool = getPool(source, database);
    const connection = await pool.getConnection();
    try {
      const [rows, fields] = await connection.execute(sql);
      
      return {
        success: true,
        rows: rows,
        fields: fields.map((f: any) => ({
          name: f.name,
          type: f.type,
          table: f.table
        })),
        rowCount: Array.isArray(rows) ? rows.length : 1
      };
    } finally {
      connection.release();
    }
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
}

// Permission validation functions
function validateSqlType(sql: string, permissionConfig: PermissionConfig): { valid: boolean; sqlType?: string; error?: string } {
  const trimmedSql = sql.trim().toUpperCase();
  
  // Check for multi-statement queries
  if (!permissionConfig.allowMultiStatement && (trimmedSql.includes(';') && trimmedSql.split(';').filter(s => s.trim()).length > 1)) {
    return { valid: false, error: "Multi-statement queries are not allowed" };
  }
  
  // Extract SQL statement type
  const sqlTypeMatch = trimmedSql.match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|REPLACE|CALL|EXPLAIN|SHOW|DESCRIBE|USE)/);
  const sqlType = sqlTypeMatch ? sqlTypeMatch[1] : 'UNKNOWN';
  
  // Check if SQL type is allowed
  if (!permissionConfig.allowedSqlTypes.includes(sqlType) && !permissionConfig.allowedSqlTypes.includes('*')) {
    return { valid: false, error: `SQL type '${sqlType}' is not allowed. Allowed types: ${permissionConfig.allowedSqlTypes.join(', ')}` };
  }
  
  // Additional read-only check
  if (permissionConfig.readOnly && !['SELECT', 'EXPLAIN', 'SHOW', 'DESCRIBE'].includes(sqlType)) {
    return { valid: false, error: "Server is in read-only mode. Only SELECT queries are allowed" };
  }
  
  return { valid: true, sqlType };
}

function matchesPattern(text: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern === '*') return true;
    return minimatch(text, pattern, { nocase: true });
  });
}

function validateTableAccess(tableName: string, permissionConfig: PermissionConfig, database?: string): { valid: boolean; error?: string } {
  // Check database access
  if (database && !matchesPattern(database, permissionConfig.allowedDatabases)) {
    return { valid: false, error: `Access to database '${database}' is not allowed` };
  }
  
  // Check table access
  if (!matchesPattern(tableName, permissionConfig.tablePatterns)) {
    return { valid: false, error: `Access to table '${tableName}' is not allowed` };
  }
  
  return { valid: true };
}

interface TableRef {
  database?: string;
  table: string;
}

function extractTableRefs(sql: string): TableRef[] {
  const refs: TableRef[] = [];

  const patterns = [
    /FROM\s+([`\w]+(?:\s*\.\s*[`\w]+)?)/gi,
    /JOIN\s+([`\w]+(?:\s*\.\s*[`\w]+)?)/gi,
    /UPDATE\s+([`\w]+(?:\s*\.\s*[`\w]+)?)/gi,
    /INSERT\s+INTO\s+([`\w]+(?:\s*\.\s*[`\w]+)?)/gi,
    /CREATE\s+TABLE\s+([`\w]+(?:\s*\.\s*[`\w]+)?)/gi,
    /DROP\s+TABLE\s+([`\w]+(?:\s*\.\s*[`\w]+)?)/gi,
    /ALTER\s+TABLE\s+([`\w]+(?:\s*\.\s*[`\w]+)?)/gi,
    /TRUNCATE\s+TABLE\s+([`\w]+(?:\s*\.\s*[`\w]+)?)/gi
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(sql)) !== null) {
      const raw = match[1].replace(/\s+/g, '');
      const parts = raw.split('.').map(p => p.replace(/[`']/g, ''));

      let ref: TableRef | undefined;
      if (parts.length === 1) {
        ref = { table: parts[0] };
      } else if (parts.length === 2) {
        ref = { database: parts[0], table: parts[1] };
      }

      if (!ref) continue;
      if (!ref.table) continue;

      if (!refs.some(r => r.table === ref!.table && r.database === ref!.database)) {
        refs.push(ref);
      }
    }
  });

  return refs;
}

// Tools list
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const multiSourceHint = Object.keys(SOURCE_CONFIGS).length > 1
    ? " (multiple sources configured; pass 'source' to query non-default source)"
    : "";

  return {
    tools: [
      {
        name: "mysql_query",
        description: `Execute MySQL query with permission checks${multiSourceHint}`,
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Source name (optional, uses DEFAULT_SOURCE/config.json defaultSource if not specified)"
            },
            sql: {
              type: "string",
              description: "SQL query to execute"
            },
            database: {
              type: "string",
              description: "Database name (optional, uses DB_NAME if not specified)"
            }
          },
          required: ["sql"]
        }
      },
      {
        name: "mysql_databases",
        description: `List all databases with permission filtering${multiSourceHint}`,
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Source name (optional, uses DEFAULT_SOURCE/config.json defaultSource if not specified)"
            }
          },
          required: []
        }
      },
      {
        name: "mysql_tables",
        description: `List tables in a database with optional pattern filtering${multiSourceHint}`,
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Source name (optional, uses DEFAULT_SOURCE/config.json defaultSource if not specified)"
            },
            database: {
              type: "string",
              description: "Database name (optional, uses DB_NAME if not specified)"
            },
            pattern: {
              type: "string",
              description: "Glob pattern to filter table names (e.g., 'open_*')"
            }
          },
          required: []
        }
      },
      {
        name: "mysql_describe",
        description: `Describe table structure with permission check${multiSourceHint}`,
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Source name (optional, uses DEFAULT_SOURCE/config.json defaultSource if not specified)"
            },
            table: {
              type: "string",
              description: "Table name to describe"
            },
            database: {
              type: "string",
              description: "Database name (optional)"
            }
          },
          required: ["table"]
        }
      },
      {
        name: "mysql_sources",
        description: "List configured sources",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "mysql_get_permissions",
        description: `Get current permission configuration${multiSourceHint}`,
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Source name (optional, uses DEFAULT_SOURCE/config.json defaultSource if not specified)"
            }
          },
          required: []
        }
      }
    ]
  };
});

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "mysql_query": {
        const { sql, database, source } = args as { sql: string; database?: string; source?: string };
        const { sourceName, config } = getSourceConfig(source);
        const permissionConfig = config.permissions;
        
        // Validate SQL type permissions
        const sqlValidation = validateSqlType(sql, permissionConfig);
        if (!sqlValidation.valid) {
          return {
            content: [{ type: "text", text: `Permission denied: ${sqlValidation.error}` }],
            isError: true
          };
        }
        
        // Extract and validate table access
        const tableRefs = extractTableRefs(sql);
        for (const ref of tableRefs) {
          const effectiveDatabase = ref.database || database || config.connection.database;
          const tableValidation = validateTableAccess(ref.table, permissionConfig, effectiveDatabase);
          if (!tableValidation.valid) {
            return {
              content: [{ type: "text", text: `Permission denied: ${tableValidation.error}` }],
              isError: true
            };
          }
        }
        
        const result = await executeQuery(sql, database, sourceName);
        
        if (result.success) {
          const includeSourceLine = Object.keys(SOURCE_CONFIGS).length > 1 || !!source;
          const sourceLine = includeSourceLine ? `Source: ${sourceName}\n` : '';
          return {
            content: [{
              type: "text",
              text: `Query executed successfully!\n\n${sourceLine}SQL: ${sql}\n\nResults (${result.rowCount} rows):\n${JSON.stringify(result.rows, null, 2)}` +
                (Object.keys(SOURCE_CONFIGS).length > 1 && !source ? `\n\nTip: multiple sources are configured. DEFAULT_SOURCE is '${DEFAULT_SOURCE}'. Pass { "source": "<name>" } to query non-default sources.` : '')
            }]
          };
        } else {
          const includeSourceLine = Object.keys(SOURCE_CONFIGS).length > 1 || !!source;
          const sourceLine = includeSourceLine ? `Source: ${sourceName}\n` : '';
          return {
            content: [{ type: "text", text: `Query failed!\n\n${sourceLine}SQL: ${sql}\n\nError: ${result.error}\nCode: ${result.code}` }],
            isError: true
          };
        }
      }

      case "mysql_databases": {
        const { source } = args as { source?: string };
        const { sourceName, config } = getSourceConfig(source);
        const permissionConfig = config.permissions;
        const result = await executeQuery("SHOW DATABASES", undefined, sourceName);
        
        if (result.success) {
          const allDatabases = result.rows.map((row: any) => Object.values(row)[0]);
          // Filter by allowed databases
          const allowedDatabases = permissionConfig.allowedDatabases.includes('*') 
            ? allDatabases 
            : allDatabases.filter((db: string) => matchesPattern(db, permissionConfig.allowedDatabases));
          
          return {
            content: [{
              type: "text",
              text: `Available databases (source: ${sourceName}):\n${allowedDatabases.map((db: string) => `• ${db}`).join('\n')}`
            }]
          };
        } else {
          return {
            content: [{ type: "text", text: `Error listing databases: ${result.error}` }],
            isError: true
          };
        }
      }

      case "mysql_tables": {
        const { database, pattern, source } = args as { database?: string; pattern?: string; source?: string };
        const { sourceName, config } = getSourceConfig(source);
        const permissionConfig = config.permissions;
        const targetDb = database || config.connection.database;
        
        if (!targetDb) {
          return {
            content: [{ type: "text", text: "Error: No database specified. Provide 'database' parameter or set DB_NAME environment variable / source default database." }],
            isError: true
          };
        }
        
        // Validate database access only
        if (!matchesPattern(targetDb, permissionConfig.allowedDatabases)) {
          return {
            content: [{ type: "text", text: `Permission denied: Access to database '${targetDb}' is not allowed` }],
            isError: true
          };
        }
        
        const result = await executeQuery(`SHOW TABLES FROM \`${targetDb}\``, undefined, sourceName);
        
        if (result.success) {
          const allTables = result.rows.map((row: any) => Object.values(row)[0]);
          // Filter by table patterns and user-provided pattern
          let filteredTables = allTables.filter((table: string) => matchesPattern(table, permissionConfig.tablePatterns));
          
          if (pattern) {
            filteredTables = filteredTables.filter((table: string) => minimatch(table, pattern, { nocase: true }));
          }
          
          return {
            content: [{
              type: "text",
              text: `Tables in ${targetDb}${pattern ? ` matching '${pattern}'` : ''} (source: ${sourceName}):\n${filteredTables.map((table: string) => `• ${table}`).join('\n')}`
            }]
          };
        } else {
          return {
            content: [{ type: "text", text: `Error listing tables: ${result.error}` }],
            isError: true
          };
        }
      }

      case "mysql_describe": {
        const { table, database, source } = args as { table: string; database?: string; source?: string };
        const { sourceName, config } = getSourceConfig(source);
        const permissionConfig = config.permissions;
        const targetDb = database || config.connection.database;
        
        if (!targetDb) {
          return {
            content: [{ type: "text", text: "Error: No database specified. Provide 'database' parameter or set DB_NAME environment variable / source default database." }],
            isError: true
          };
        }
        
        // Validate table access
        const tableValidation = validateTableAccess(table, permissionConfig, targetDb);
        if (!tableValidation.valid) {
          return {
            content: [{ type: "text", text: `Permission denied: ${tableValidation.error}` }],
            isError: true
          };
        }
        
        const result = await executeQuery(`DESCRIBE \`${targetDb}\`.\`${table}\``, undefined, sourceName);
        
        if (result.success) {
          return {
            content: [{
              type: "text",
              text: `Table structure for ${targetDb}.${table}:\n\n${JSON.stringify(result.rows, null, 2)}`
            }]
          };
        } else {
          return {
            content: [{ type: "text", text: `Error describing table: ${result.error}` }],
            isError: true
          };
        }
      }

      case "mysql_sources": {
        const sourceNames = Object.keys(SOURCE_CONFIGS);
        const formatted = sourceNames.map((s) => {
          const cfg = SOURCE_CONFIGS[s];
          const host = cfg.connection.host;
          const port = cfg.connection.port;
          const user = cfg.connection.user;
          const database = cfg.connection.database;
          return `• ${s}${s === DEFAULT_SOURCE ? ' (default)' : ''} (${user}@${host}:${port}${database ? `/${database}` : ''})`;
        }).join('\n');
        return {
          content: [{
            type: "text",
            text: `Configured sources:\n${formatted}` +
              `\n\nDefault source: ${DEFAULT_SOURCE}` +
              (CONFIG_FILE_PATH ? `\nConfig file: ${CONFIG_FILE_PATH}` : '') +
              `\n\nTip: pass { "source": "<name>" } to tools to query non-default sources.`
          }]
        };
      }

      case "mysql_get_permissions": {
        const { source } = args as { source?: string };
        const { sourceName, config } = getSourceConfig(source);
        return {
          content: [{
            type: "text",
            text: `Current Permission Configuration (${sourceName}):\n\n` +
              `• Allowed SQL Types: ${config.permissions.allowedSqlTypes.join(', ')}\n` +
              `• Table Patterns: ${config.permissions.tablePatterns.join(', ')}\n` +
              `• Allowed Databases: ${config.permissions.allowedDatabases.join(', ')}\n` +
              `• Read Only: ${config.permissions.readOnly}\n` +
              `• Allow Multi-Statement: ${config.permissions.allowMultiStatement}`
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Tool execution error: ${error.message}` }],
      isError: true
    };
  }
});

// Start server
async function main() {
  // Test database connection
  const skipDbTest = process.env.SKIP_DB_TEST === 'true';
  
  if (!skipDbTest) {
    try {
      const testAllSources = process.env.TEST_ALL_SOURCES === 'true';
      const sourcesToTest = testAllSources ? Object.keys(SOURCE_CONFIGS) : [DEFAULT_SOURCE];
      for (const sourceName of sourcesToTest) {
        const pool = getPool(sourceName);
        const connection = await pool.getConnection();
        connection.release();
      }
      console.error("✅ MySQL connection successful");
    } catch (error) {
      console.error("❌ MySQL connection failed:", error);
      console.error("ℹ️ Set SKIP_DB_TEST=true to skip connection test");
      process.exit(1);
    }
  } else {
    console.error("⚠️ Skipping database connection test (deployment mode)");
  }

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 Secure MySQL MCP Server running on stdio");
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error('\n🛑 Shutting down Secure MySQL MCP Server...');
  for (const pool of POOLS.values()) {
    await pool.end();
  }
  process.exit(0);
});

// Start server
main().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
