# company-gateway — 公司内网数据查询网关（MCP 插件）

把公司内网站点封装成 Reasonix 可对话查询的数据网关。

## 它解决什么

公司网站没有公开 API，但登录后服务端有筛选查询能力。
本网关负责两件事：

1. **持有登录态**（session/cookie）—— 你在真实浏览器登录一次，把 cookie 导进来；
2. **把查询暴露成工具** —— 带 session 去请求服务端筛选接口，结果返回给 AI。

之后在 Reasonix 里直接对话：

> 用公司网关查一下 2026 年 8 月的订单，筛选状态=已完成

## 架构

```
Reasonix (MCP client)
   │  stdio JSON-RPC
   ▼
company-gateway (本插件, 单二进制, 零依赖)
   │  Cookie header
   ▼
公司内网站点（登录态 + 服务端筛选接口）
```

## 快速开始

### 1. 编译

```bash
cd company-gateway
go build -o company-gateway .
```

### 2. 接入 Reasonix

在项目根目录的 `reasonix.toml`（或 `~/.reasonix/config.toml`）加：

```toml
[[plugins]]
name    = "company"
command = "/绝对路径/company-gateway/company-gateway"
```

或项目根放 `.mcp.json`：

```json
{
  "mcpServers": {
    "company": {
      "command": "/绝对路径/company-gateway/company-gateway"
    }
  }
}
```

重启 Reasonix，`/mcp` 应看到 `company` 已连接，工具以
`mcp__company__session_set` / `mcp__company__session_status` /
`mcp__company__query_data` 暴露。

### 3. 注入登录态（两种方式）

**方式 A：运行时注入（推荐，不用重启）**

在真实浏览器登录公司网站 → 打开 DevTools → Application → Cookies，
复制全部 cookie 为 `name=value; name2=value2` 形式，然后在对话里说：

> 用 company_gateway 的 session_set 工具注入这些 cookies：`JSESSIONID=...; company_token=...`

**方式 B：环境变量注入（重启生效）**

```bash
export COMPANY_SESSION_COOKIE="JSESSIONID=...; company_token=..."
```

### 4. 查询

先 `session_status` 确认登录态，再 `query_data`：
`table` = 数据域（orders / customers / invoices…），`filters` = 服务端筛选键值。

## 待填充（需要公司网站信息）

`main.go` 顶部 `queryURL` 常量目前为空 → `query_data` 返回 MOCK 数据。
拿到下面信息后填充（见文件内 `TODO(company)` 标注）：

| 需要的信息 | 用途 | 怎么拿 |
|---|---|---|
| 查询接口 URL（登录后站点自身搜索用的那个） | `queryURL` | DevTools Network 里看站点搜索时发的请求 |
| 筛选参数名 | `filters` 键名 | 同上，看请求 query string / body |
| 返回格式 | 解析 | 同上，看响应 JSON |
| （可选）登录表单 URL + 字段 | 自动登录 | 登录请求的 POST target 和 body |

## 工具一览

| 工具 | 只读 | 说明 |
|---|---|---|
| `session_set` | 否 | 注入 cookie（覆盖旧 session） |
| `session_status` | 是 | 报告登录态是否可用 |
| `query_data` | 是 | 带 session 查询，返回 JSON |
