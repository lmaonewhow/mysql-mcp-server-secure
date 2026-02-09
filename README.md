# Secure MySQL MCP Server

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/MySQL-8.0%2B-orange.svg" alt="MySQL">
</p>

<p align="center">
  <b>English</b> | <a href="#中文文档">中文</a>
</p>

A secure MySQL Model Context Protocol (MCP) server with configurable permission controls for AI database operations.

## ✨ Features

- **🔒 Permission Controls**: Configurable SQL type allowlist, table pattern allowlist, and database restrictions
- **🎯 Pattern-based Table Access**: Support glob patterns like `open_*` for table permissions
- **👁️ Read-only Mode**: Default read-only with option to enable write operations
- **🛡️ Multi-statement Protection**: Disallow dangerous multi-statement queries by default
- **🧩 Multi-source Support**: Configure multiple MySQL sources (different hosts/users/default databases/permissions) and select via `source`
- **🔧 Standard MCP Tools**: Query execution, database listing, table listing with patterns, table structure

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- MySQL >= 8.0

### Installation

```bash
# Clone the repository
git clone https://github.com/lmaonewhow/mysql-mcp-server-secure.git
cd mysql-mcp-server-secure

# Install dependencies
npm install

# Build project
npm run build
```

### Configuration

#### Environment Variables

##### Database Connection

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DB_HOST` | MySQL server host | `127.0.0.1` | No |
| `DB_PORT` | MySQL server port | `3306` | No |
| `DB_USER` | MySQL username | `root` | No |
| `DB_PASSWORD` | MySQL password | - | **Yes** |
| `DB_NAME` | Default database name | - | No |

##### Multi-Source (Optional)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MYSQL_SOURCES` | JSON object mapping `sourceName -> sourceConfig` | - | No |
| `DEFAULT_SOURCE` | Default source name when `source` not provided | first key of configured sources or `default` | No |
| `TEST_ALL_SOURCES` | Test all sources on startup | `false` | No |

##### Permission Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `READ_ONLY` | Only allow SELECT queries | `true` |
| `ALLOWED_SQL_TYPES` | Comma-separated allowed SQL types | `SELECT` |
| `TABLE_PATTERNS` | Comma-separated table name patterns | `*` (all tables) |
| `ALLOWED_DATABASES` | Comma-separated database names | `*` (all databases) |
| `ALLOW_MULTI_STATEMENT` | Allow multiple statements in one query | `false` |

> If `MYSQL_SOURCES` is provided, each source can override permissions independently.

#### Configuration File (Recommended for multi-source)

Create `./.mysql-mcp-server-secure/config.json` (relative to the MCP server process working directory). You can also set `MYSQL_MCP_CONFIG_PATH` to an explicit path.

Supported formats:

1) Explicit `sources` object:

```json
{
  "defaultSource": "prod",
  "sources": {
    "prod": {
      "connection": {
        "host": "127.0.0.1",
        "port": 3306,
        "user": "readonly",
        "password": "***",
        "database": "production_db"
      },
      "permissions": {
        "readOnly": true,
        "allowedSqlTypes": ["SELECT"],
        "allowedDatabases": ["production_db"],
        "tablePatterns": ["open_*"],
        "allowMultiStatement": false
      }
    }
  }
}
```

2) Top-level sources (more concise):

```json
{
  "defaultSource": "prod",
  "prod": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "readonly",
    "password": "***",
    "database": "production_db",
    "permissions": {
      "readOnly": true,
      "allowedSqlTypes": ["SELECT"],
      "allowedDatabases": ["production_db"],
      "tablePatterns": ["open_*"],
      "allowMultiStatement": false
    }
  }
}
```

Merge/override order when both are provided:

- Config file sources are loaded first
- `MYSQL_SOURCES` (env) overrides sources with the same name

### Usage with Windsurf

Add to `.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server-secure/dist/index.js"],
      "env": {
        "DB_HOST": "127.0.0.1",
        "DB_PORT": "3306",
        "DB_USER": "your_username",
        "DB_PASSWORD": "your_secure_password",
        "DB_NAME": "your_database",
        "READ_ONLY": "true",
        "TABLE_PATTERNS": "table_prefix_*,another_table_*",
        "ALLOWED_DATABASES": "your_database"
      }
    }
  }
}
```

> ⚠️ **Security Notice**: Replace all placeholder values with your actual configuration. Never commit files containing real credentials.

### Multi-source example (Windsurf)

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server-secure/dist/index.js"],
      "env": {
        "DEFAULT_SOURCE": "prod",
        "MYSQL_SOURCES": "{\"prod\":{\"host\":\"127.0.0.1\",\"port\":3306,\"user\":\"readonly\",\"password\":\"***\",\"database\":\"production_db\",\"permissions\":{\"readOnly\":true,\"allowedSqlTypes\":[\"SELECT\"],\"allowedDatabases\":[\"production_db\"],\"tablePatterns\":[\"open_*\"],\"allowMultiStatement\":false}},\"analytics\":{\"host\":\"127.0.0.1\",\"port\":3306,\"user\":\"analyst\",\"password\":\"***\",\"database\":\"analytics_db\",\"permissions\":{\"readOnly\":true,\"allowedSqlTypes\":[\"SELECT\",\"SHOW\"],\"allowedDatabases\":[\"analytics_db\"],\"tablePatterns\":[\"*\"],\"allowMultiStatement\":false}}}"
      }
    }
  }
}
```

## 🛠️ Available Tools

### `mysql_query`

Execute MySQL queries with permission validation.

**Parameters:**
- `source` (optional): Source name (uses `DEFAULT_SOURCE` / config.json `defaultSource` if not specified)
- `sql` (required): SQL query to execute
- `database` (optional): Target database

### `mysql_databases`

List all accessible databases (filtered by `ALLOWED_DATABASES`).

**Parameters:**
- `source` (optional): Source name

### `mysql_tables`

List tables in a database with optional pattern filtering.

**Parameters:**
- `source` (optional): Source name
- `database` (optional): Database name (uses `DB_NAME` if not specified)
- `pattern` (optional): Glob pattern to filter tables (e.g., `open_*`)

### `mysql_describe`

Describe table structure with permission check.

**Parameters:**
- `source` (optional): Source name
- `table` (required): Table name
- `database` (optional): Database name

### `mysql_sources`

List configured sources and the default source.

### `mysql_get_permissions`

Get current permission configuration.

**Parameters:**
- `source` (optional): Source name

## 📋 Configuration Examples

### Read-only access to specific tables

```bash
READ_ONLY=true
TABLE_PATTERNS=open_*,user_*
ALLOWED_DATABASES=production_db
```

### Selective write permissions

```bash
READ_ONLY=false
ALLOWED_SQL_TYPES=SELECT,INSERT,UPDATE,DELETE
TABLE_PATTERNS=open_*,log_*
ALLOWED_DATABASES=production_db,analytics_db
```

## 🔒 Security Best Practices

1. **Always use READ_ONLY=true** for production AI access
2. **Limit TABLE_PATTERNS** to only required tables
3. **Set ALLOWED_DATABASES** to restrict database access
4. **Keep ALLOW_MULTI_STATEMENT=false** to prevent injection attacks
5. **Use strong database passwords** and restrict MySQL user privileges
6. **Regularly audit** the `ALLOWED_SQL_TYPES` configuration

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

---

<a name="中文文档"></a>

# Secure MySQL MCP Server

<p align="center">
  <b>中文</b> | <a href="#Secure-MySQL-MCP-Server">English</a>
</p>

一个安全的 MySQL Model Context Protocol (MCP) 服务器，为 AI 数据库操作提供可配置的权限控制。

## ✨ 特性

- **🔒 权限控制**: 可配置的 SQL 类型白名单、表名模式白名单和数据库限制
- **🎯 基于模式的表访问**: 支持 `open_*` 等 glob 模式进行表权限控制
- **👁️ 只读模式**: 默认只读，可选启用写入操作
- **🛡️ 多语句保护**: 默认禁止危险的多语句查询
- **🧩 多数据源支持**: 支持配置多个 MySQL 数据源（不同 host/user/默认库/权限），并通过 `source` 选择
- **🔧 标准 MCP 工具**: 查询执行、数据库列表、带模式的表列表、表结构查询

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- MySQL >= 8.0

### 安装

```bash
# 克隆仓库
git clone https://github.com/lmaonewhow/mysql-mcp-server-secure.git
cd mysql-mcp-server-secure

# 安装依赖
npm install

# 构建项目
npm run build
```

### 配置

#### 环境变量

##### 数据库连接

| 变量 | 描述 | 默认值 | 是否必填 |
|----------|-------------|---------|----------|
| `DB_HOST` | MySQL 服务器地址 | `127.0.0.1` | 否 |
| `DB_PORT` | MySQL 服务器端口 | `3306` | 否 |
| `DB_USER` | MySQL 用户名 | `root` | 否 |
| `DB_PASSWORD` | MySQL 密码 | - | **是** |
| `DB_NAME` | 默认数据库名 | - | 否 |

##### 多数据源（可选）

| 变量 | 描述 | 默认值 | 是否必填 |
|----------|-------------|---------|----------|
| `MYSQL_SOURCES` | JSON 对象：`sourceName -> sourceConfig` | - | 否 |
| `DEFAULT_SOURCE` | 未提供 `source` 时使用的数据源名 | 已配置 sources 的第一个 key 或 `default` | 否 |
| `TEST_ALL_SOURCES` | 启动时测试所有数据源连接 | `false` | 否 |

##### 权限配置

| 变量 | 描述 | 默认值 |
|----------|-------------|---------|
| `READ_ONLY` | 仅允许 SELECT 查询 | `true` |
| `ALLOWED_SQL_TYPES` | 逗号分隔的允许 SQL 类型 | `SELECT` |
| `TABLE_PATTERNS` | 逗号分隔的表名模式 | `*` (所有表) |
| `ALLOWED_DATABASES` | 逗号分隔的数据库名 | `*` (所有数据库) |
| `ALLOW_MULTI_STATEMENT` | 允许单个查询中包含多语句 | `false` |

> 如果提供了 `MYSQL_SOURCES`，每个 source 都可以单独覆盖权限配置。

#### 配置文件（推荐用于多数据源）

在工作目录下创建 `./.mysql-mcp-server-secure/config.json`（相对于 MCP server 进程的 working directory）。也可以通过环境变量 `MYSQL_MCP_CONFIG_PATH` 指定绝对路径。

支持两种格式：

1）显式 `sources`：

```json
{
  "defaultSource": "prod",
  "sources": {
    "prod": {
      "connection": {
        "host": "127.0.0.1",
        "port": 3306,
        "user": "readonly",
        "password": "***",
        "database": "production_db"
      },
      "permissions": {
        "readOnly": true,
        "allowedSqlTypes": ["SELECT"],
        "allowedDatabases": ["production_db"],
        "tablePatterns": ["open_*"],
        "allowMultiStatement": false
      }
    }
  }
}
```

2）顶层直接写 sources（更简洁）：

```json
{
  "defaultSource": "prod",
  "prod": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "readonly",
    "password": "***",
    "database": "production_db",
    "permissions": {
      "readOnly": true,
      "allowedSqlTypes": ["SELECT"],
      "allowedDatabases": ["production_db"],
      "tablePatterns": ["open_*"],
      "allowMultiStatement": false
    }
  }
}
```

当同时提供配置文件与 `MYSQL_SOURCES`（env）时，合并/覆盖顺序：

- 先加载配置文件 sources
- `MYSQL_SOURCES`（env）对同名 source 覆盖

### Windsurf 集成

在 `.windsurf/mcp.json` 中添加配置：

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server-secure/dist/index.js"],
      "env": {
        "DB_HOST": "127.0.0.1",
        "DB_PORT": "3306",
        "DB_USER": "your_username",
        "DB_PASSWORD": "your_secure_password",
        "DB_NAME": "your_database",
        "READ_ONLY": "true",
        "TABLE_PATTERNS": "table_prefix_*,another_table_*",
        "ALLOWED_DATABASES": "your_database"
      }
    }
  }
}
```

> ⚠️ **安全提示**: 请将所有占位符值替换为实际配置。切勿提交包含真实凭证的文件。

### 多数据源示例（Windsurf）

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp-server-secure/dist/index.js"],
      "env": {
        "DEFAULT_SOURCE": "prod",
        "MYSQL_SOURCES": "{\"prod\":{\"host\":\"127.0.0.1\",\"port\":3306,\"user\":\"readonly\",\"password\":\"***\",\"database\":\"production_db\",\"permissions\":{\"readOnly\":true,\"allowedSqlTypes\":[\"SELECT\"],\"allowedDatabases\":[\"production_db\"],\"tablePatterns\":[\"open_*\"],\"allowMultiStatement\":false}},\"analytics\":{\"host\":\"127.0.0.1\",\"port\":3306,\"user\":\"analyst\",\"password\":\"***\",\"database\":\"analytics_db\",\"permissions\":{\"readOnly\":true,\"allowedSqlTypes\":[\"SELECT\",\"SHOW\"],\"allowedDatabases\":[\"analytics_db\"],\"tablePatterns\":[\"*\"],\"allowMultiStatement\":false}}}"
      }
    }
  }
}
```

## 🛠️ 可用工具

### `mysql_query`

执行带权限验证的 MySQL 查询。

**参数：**
- `source` (可选): 数据源名（未指定时使用 `DEFAULT_SOURCE` / config.json 的 `defaultSource`）
- `sql` (必填): 要执行的 SQL 查询
- `database` (可选): 目标数据库

### `mysql_databases`

列出所有可访问的数据库（受 `ALLOWED_DATABASES` 过滤）。

**参数：**
- `source` (可选): 数据源名

### `mysql_tables`

列出数据库中的表，支持可选的模式过滤。

**参数：**
- `source` (可选): 数据源名
- `database` (可选): 数据库名（未指定时使用 `DB_NAME`）
- `pattern` (可选): 用于过滤表的 glob 模式（如 `open_*`）

### `mysql_describe`

描述表结构并进行权限检查。

**参数：**
- `source` (可选): 数据源名
- `table` (必填): 表名
- `database` (可选): 数据库名

### `mysql_get_permissions`

获取当前权限配置。

**参数：**
- `source` (可选): 数据源名

### `mysql_sources`

列出已配置的数据源以及默认 source。

## 📋 配置示例

### 特定表的只读访问

```bash
READ_ONLY=true
TABLE_PATTERNS=open_*,user_*
ALLOWED_DATABASES=production_db
```

### 选择性写入权限

```bash
READ_ONLY=false
ALLOWED_SQL_TYPES=SELECT,INSERT,UPDATE,DELETE
TABLE_PATTERNS=open_*,log_*
ALLOWED_DATABASES=production_db,analytics_db
```

## 🔒 安全最佳实践

1. **始终在生产环境使用 READ_ONLY=true** 用于 AI 访问
2. **限制 TABLE_PATTERNS** 仅包含必需的表
3. **设置 ALLOWED_DATABASES** 限制数据库访问范围
4. **保持 ALLOW_MULTI_STATEMENT=false** 防止注入攻击
5. **使用强数据库密码** 并限制 MySQL 用户权限
6. **定期审计** `ALLOWED_SQL_TYPES` 配置

## 📝 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。
