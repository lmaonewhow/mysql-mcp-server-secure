#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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

const PERMISSION_CONFIG = loadPermissionConfig();

// MySQL connection configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: parseInt(process.env.DB_PORT || "3306"),
  database: process.env.DB_NAME, // Default database
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// MySQL connection pool
const pool = mysql.createPool(DB_CONFIG);

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
async function executeQuery(sql: string, database?: string): Promise<any> {
  try {
    // Use specified database or default from config
    const targetDatabase = database || DB_CONFIG.database;
    const config = targetDatabase ? { ...DB_CONFIG, database: targetDatabase } : DB_CONFIG;
    
    const connection = await mysql.createConnection(config);
    const [rows, fields] = await connection.execute(sql);
    await connection.end();
    
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
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
}

// Permission validation functions
function validateSqlType(sql: string): { valid: boolean; sqlType?: string; error?: string } {
  const trimmedSql = sql.trim().toUpperCase();
  
  // Check for multi-statement queries
  if (!PERMISSION_CONFIG.allowMultiStatement && (trimmedSql.includes(';') && trimmedSql.split(';').filter(s => s.trim()).length > 1)) {
    return { valid: false, error: "Multi-statement queries are not allowed" };
  }
  
  // Extract SQL statement type
  const sqlTypeMatch = trimmedSql.match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|REPLACE|CALL|EXPLAIN|SHOW|DESCRIBE|USE)/);
  const sqlType = sqlTypeMatch ? sqlTypeMatch[1] : 'UNKNOWN';
  
  // Check if SQL type is allowed
  if (!PERMISSION_CONFIG.allowedSqlTypes.includes(sqlType) && !PERMISSION_CONFIG.allowedSqlTypes.includes('*')) {
    return { valid: false, error: `SQL type '${sqlType}' is not allowed. Allowed types: ${PERMISSION_CONFIG.allowedSqlTypes.join(', ')}` };
  }
  
  // Additional read-only check
  if (PERMISSION_CONFIG.readOnly && !['SELECT', 'EXPLAIN', 'SHOW', 'DESCRIBE'].includes(sqlType)) {
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

function validateTableAccess(tableName: string, database?: string): { valid: boolean; error?: string } {
  // Check database access
  if (database && !matchesPattern(database, PERMISSION_CONFIG.allowedDatabases)) {
    return { valid: false, error: `Access to database '${database}' is not allowed` };
  }
  
  // Check table access
  if (!matchesPattern(tableName, PERMISSION_CONFIG.tablePatterns)) {
    return { valid: false, error: `Access to table '${tableName}' is not allowed` };
  }
  
  return { valid: true };
}

function extractTableNames(sql: string): string[] {
  const tables: string[] = [];
  const upperSql = sql.toUpperCase();
  
  // Extract table names from different SQL patterns
  const patterns = [
    /FROM\s+([`\w]+)/gi,
    /JOIN\s+([`\w]+)/gi,
    /UPDATE\s+([`\w]+)/gi,
    /INSERT\s+INTO\s+([`\w]+)/gi,
    /CREATE\s+TABLE\s+([`\w]+)/gi,
    /DROP\s+TABLE\s+([`\w]+)/gi,
    /ALTER\s+TABLE\s+([`\w]+)/gi,
    /TRUNCATE\s+TABLE\s+([`\w]+)/gi
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(sql)) !== null) {
      const table = match[1].replace(/[`']/g, '');
      if (!tables.includes(table)) {
        tables.push(table);
      }
    }
  });
  
  return tables;
}

// Tools list
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mysql_query",
        description: "Execute MySQL query with permission checks",
        inputSchema: {
          type: "object",
          properties: {
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
        description: "List all databases with permission filtering",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "mysql_tables",
        description: "List tables in a database with optional pattern filtering",
        inputSchema: {
          type: "object",
          properties: {
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
        description: "Describe table structure with permission check",
        inputSchema: {
          type: "object",
          properties: {
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
        name: "mysql_get_permissions",
        description: "Get current permission configuration",
        inputSchema: {
          type: "object",
          properties: {},
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
        const { sql, database } = args as { sql: string; database?: string };
        
        // Validate SQL type permissions
        const sqlValidation = validateSqlType(sql);
        if (!sqlValidation.valid) {
          return {
            content: [{ type: "text", text: `Permission denied: ${sqlValidation.error}` }],
            isError: true
          };
        }
        
        // Extract and validate table access
        const tableNames = extractTableNames(sql);
        for (const table of tableNames) {
          const tableValidation = validateTableAccess(table, database);
          if (!tableValidation.valid) {
            return {
              content: [{ type: "text", text: `Permission denied: ${tableValidation.error}` }],
              isError: true
            };
          }
        }
        
        const result = await executeQuery(sql, database);
        
        if (result.success) {
          return {
            content: [{
              type: "text",
              text: `Query executed successfully!\n\nSQL: ${sql}\n\nResults (${result.rowCount} rows):\n${JSON.stringify(result.rows, null, 2)}`
            }]
          };
        } else {
          return {
            content: [{ type: "text", text: `Query failed!\n\nSQL: ${sql}\n\nError: ${result.error}\nCode: ${result.code}` }],
            isError: true
          };
        }
      }

      case "mysql_databases": {
        const result = await executeQuery("SHOW DATABASES");
        
        if (result.success) {
          const allDatabases = result.rows.map((row: any) => Object.values(row)[0]);
          // Filter by allowed databases
          const allowedDatabases = PERMISSION_CONFIG.allowedDatabases.includes('*') 
            ? allDatabases 
            : allDatabases.filter((db: string) => matchesPattern(db, PERMISSION_CONFIG.allowedDatabases));
          
          return {
            content: [{
              type: "text",
              text: `Available databases:\n${allowedDatabases.map((db: string) => `• ${db}`).join('\n')}`
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
        const { database, pattern } = args as { database?: string; pattern?: string };
        const targetDb = database || DB_CONFIG.database;
        
        if (!targetDb) {
          return {
            content: [{ type: "text", text: "Error: No database specified. Provide 'database' parameter or set DB_NAME environment variable." }],
            isError: true
          };
        }
        
        // Validate database access only
        if (!matchesPattern(targetDb, PERMISSION_CONFIG.allowedDatabases)) {
          return {
            content: [{ type: "text", text: `Permission denied: Access to database '${targetDb}' is not allowed` }],
            isError: true
          };
        }
        
        const result = await executeQuery(`SHOW TABLES FROM \`${targetDb}\``);
        
        if (result.success) {
          const allTables = result.rows.map((row: any) => Object.values(row)[0]);
          // Filter by table patterns and user-provided pattern
          let filteredTables = allTables.filter((table: string) => matchesPattern(table, PERMISSION_CONFIG.tablePatterns));
          
          if (pattern) {
            filteredTables = filteredTables.filter((table: string) => minimatch(table, pattern, { nocase: true }));
          }
          
          return {
            content: [{
              type: "text",
              text: `Tables in ${targetDb}${pattern ? ` matching '${pattern}'` : ''}:\n${filteredTables.map((table: string) => `• ${table}`).join('\n')}`
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
        const { table, database } = args as { table: string; database?: string };
        const targetDb = database || DB_CONFIG.database;
        
        if (!targetDb) {
          return {
            content: [{ type: "text", text: "Error: No database specified. Provide 'database' parameter or set DB_NAME environment variable." }],
            isError: true
          };
        }
        
        // Validate table access
        const tableValidation = validateTableAccess(table, targetDb);
        if (!tableValidation.valid) {
          return {
            content: [{ type: "text", text: `Permission denied: ${tableValidation.error}` }],
            isError: true
          };
        }
        
        const result = await executeQuery(`DESCRIBE \`${targetDb}\`.\`${table}\``);
        
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

      case "mysql_get_permissions": {
        return {
          content: [{
            type: "text",
            text: `Current Permission Configuration:\n\n` +
              `• Allowed SQL Types: ${PERMISSION_CONFIG.allowedSqlTypes.join(', ')}\n` +
              `• Table Patterns: ${PERMISSION_CONFIG.tablePatterns.join(', ')}\n` +
              `• Allowed Databases: ${PERMISSION_CONFIG.allowedDatabases.join(', ')}\n` +
              `• Read Only: ${PERMISSION_CONFIG.readOnly}\n` +
              `• Allow Multi-Statement: ${PERMISSION_CONFIG.allowMultiStatement}`
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
      const connection = await pool.getConnection();
      console.error("✅ MySQL connection successful");
      connection.release();
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
  await pool.end();
  process.exit(0);
});

// Start server
main().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
