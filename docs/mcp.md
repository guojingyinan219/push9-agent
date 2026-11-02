# Push9 MCP 接入文档

## 1. 两种接入方式

| 方式 | 地址/命令 | 凭据 | 适用客户端 |
| --- | --- | --- | --- |
| 本地 stdio | `npx --yes --allow-git=root --package=github:guojingyinan219/push9-agent#v0.1.2 push9-agent mcp` | 启动环境 `PUSH9_TOKEN` | 支持本地 MCP 进程的 Agent |
| 自托管 Streamable HTTP | 自己部署的 `https://mcp.example.com/mcp` | 每个请求 `Authorization: Bearer aip_...` | 支持 HTTP MCP 和自定义 Bearer 的客户端 |

**`https://push9.top` 是推送 API 服务地址，不代表其 `/mcp` 已部署。** 本仓库提供可运行的远程服务源码和容器配置；托管远程地址上线前，先使用本地 stdio，即可向现有 Push9 API 推送。只支持 OAuth 或旧 SSE 的客户端暂不能直接使用此 HTTP 接入。

Skill 与 MCP 可任选一种；同时安装时，Agent 每个事件只调用一次，避免重复推送。

## 2. stdio

通用 `mcpServers` JSON 见 [README](../README.md)。在客户端添加后，刷新工具列表，应出现 `push9_send_message`。该工具有外部发送副作用，请按客户端的工具授权流程调用。

Codex `~/.codex/config.toml` 示例：

```toml
[mcp_servers.push9]
command = "npx"
args = ["--yes", "--allow-git=root", "--package=github:guojingyinan219/push9-agent#v0.1.2", "push9-agent", "mcp"]
env_vars = ["PUSH9_TOKEN", "PUSH9_TOPIC"]
startup_timeout_sec = 120

[mcp_servers.push9.env]
PUSH9_BASE_URL = "https://push9.top"
```

先在启动 Codex 的环境里设置 Token/Topic，再重启。`env_vars` 只转发变量名，不把值写进 TOML。首次 npx 下载可能较慢；网络不稳定时克隆仓库、`npm ci --ignore-scripts`，将 command 改为 `node`，args 改为 `["/absolute/path/push9-agent/bin/push9-agent.mjs", "mcp"]`。

Windows 若 `npx` 启动报 ENOENT，使用绝对路径 `node.exe` 加上述脚本；或 `command = "cmd"`，args 前加 `/c`, `npx`。不要将 Token 放进 args。配置合并到现有文件，不覆盖其他 MCP Server。

## 3. 工具参数和返回

工具名：`push9_send_message`。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| title | 是 | 1–120 UTF-16 单元，去除首尾空白 |
| content | 是 | 1–4000 UTF-16 单元，去除首尾空白 |
| topic | HTTP 必填、stdio 可省略 | Topic code，2–48 位字母数字、下划线或连字符；stdio 省略时用 `PUSH9_TOPIC` |
| idempotencyKey | 否 | 1–128 位字母数字或 `._:-`；同一账号、键及内容在服务端 24 小时内复用原消息 |

```json
{
  "title": "备份完成",
  "content": "数据库备份完成，耗时 30 秒。",
  "topic": "server-alerts",
  "idempotencyKey": "backup-unique-run-id"
}
```

成功返回：

```json
{"accepted":true,"id":"message-id","status":"QUEUED","totalCount":1}
```

这是受理回执，不代表微信已经送达。不会返回接收人的 OpenID、邮箱、完整投递任务或 Token。接收通道由 Topic 和成员偏好决定；没有 `channels`、Token 或任意请求 URL 参数。首版不提供 `list_topics` 或 `get_delivery_status` 工具，不会将管理 JWT 用于 API Token 接入。

出现错误时返回 MCP `isError: true` 和安全错误信息。401 检查 Token；404 检查 Topic 归属；409 是幂等键内容冲突；429 等待服务端 `Retry-After` 指定时间后再决定是否重试。超时和 HTTP 5xx 可能无法判断是否受理，不会自动重试；需先核对消息记录，授权重试时沿用原键和内容。

## 4. 运行 HTTP 服务

从仓库目录执行，默认监听本机 3110：

PowerShell：

```powershell
$env:PUSH9_MCP_TRANSPORT = 'http'
$env:PUSH9_BASE_URL = 'https://push9.top'
node bin/push9-agent.mjs mcp
```

Bash：

```bash
PUSH9_MCP_TRANSPORT=http PUSH9_BASE_URL=https://push9.top node bin/push9-agent.mjs mcp
```

HTTP 路径为 `/mcp`，健康检查 `/healthz`。HTTP 不使用服务器的 `PUSH9_TOKEN` 或 `PUSH9_TOPIC`；每个调用者提供自己的 Bearer 和 Topic。服务只验证 Bearer 格式，真实 Token 的有效性、撤销、Topic 权限和账号额度由 Push9 在**调用发送工具时**校验；握手/列工具成功不是 Token 有效性的证明。

服务不保存跨请求会话。每个 POST 独立绑定调用者 Token，返回后释放；不支持旧 SSE 订阅、GET 长连接和 DELETE session。HTTP 不接收 URL/工具参数中的 Token，不记录请求正文或 Authorization。默认拒绝带浏览器 Origin 的请求；这不是浏览器 CORS 接口。

## 5. Docker + Caddy 自托管

```bash
export PUSH9_MCP_ALLOWED_HOSTS=mcp.example.com,localhost,127.0.0.1
docker compose up -d --build
```

把 `mcp.example.com` 替换为自己的域名。提供的 Compose 只映射宿主机 `127.0.0.1:3110`，容器无内置用户 Token。首次构建需要拉取 Node 镜像和依赖。

**Caddy 运行在宿主机时**，合并以下站点配置，验证后 reload：

```caddyfile
mcp.example.com {
    @mcp path /mcp
    reverse_proxy @mcp 127.0.0.1:3110
    respond 404
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile
caddy reload --config /etc/caddy/Caddyfile
```

**Caddy 在容器中时**，`127.0.0.1` 指向 Caddy 自己，不能照搬。把 MCP 容器加入 Caddy 所在 Docker 网络，改为 `reverse_proxy @mcp push9-mcp:3110`，并确保服务名可解析；保持 Host/Authorization 和查询参数按原样转发。不要配置覆盖 Token 的全局 Authorization，也不要将请求头或正文写入访问日志。

公网必须通过 HTTPS。`PUSH9_MCP_ALLOWED_HOSTS` 填**主机名，不带协议和端口**；绑定 `0.0.0.0` 时必须显式配置。只在确需浏览器客户端时按需设置 `PUSH9_MCP_ALLOWED_ORIGINS` 精确来源列表，并另行完成客户端跨域需求；目前不提供通用 CORS/浏览器接入支持。

## 6. 远程客户端配置

支持直接 URL 和 Bearer 环境变量的 Codex：

```toml
[mcp_servers.push9_remote]
url = "https://mcp.example.com/mcp"
bearer_token_env_var = "PUSH9_TOKEN"
```

将域名替换为实际已上线的 MCP 服务；工具调用里必须传 topic。不要同时为同一事件调用本地和远程工具。其他客户端在 MCP 设置中选择 Streamable HTTP，填写 URL 和 Authorization Bearer，具体配置文件字段以客户端版本为准。本项目未实现 OAuth discovery/登录，不要选择“OAuth 自动授权”。

## 7. 验证与排错

1. 运行 `npm test`：用官方 SDK 测试 stdio/HTTP 握手、工具发现、发送、输入校验、双用户 Token 隔离、错误脱敏、Host/Origin 防护和独立 Skill 安装；全程本地模拟，不向真实用户发消息。
2. 客户端刷新工具，确认仅有 `push9_send_message`，没有 Token 出现在工具 schema。
3. 用户授权后发送一个唯一事件键的测试消息，核对返回 ID、Push9 消息记录及最终接收端。换另一个账号的 Topic 应拒绝。
4. 同键同内容再发一次，确认没有新增消息；改内容应 409。额度由后端统一计算。
5. 401：Token 缺失/格式错误；发送工具内 401：Token 无效/过期/撤销。403：Host/Origin 或后端访问策略。405：用了旧 SSE/GET。406：请求头缺少 MCP 要求的 Accept。413：正文超过 HTTP JSON 解析器上限（100 KB）。
6. stdio 不要用普通终端输出判断连接成功；stdout 仅 JSON-RPC。启动错误写 stderr，不输出环境变量或原始服务端错误。GitHub 下载失败请先检查 Git/代理，不要用多次发送来测试安装问题。

验证范围：本地真实 MCP SDK 协议联调通过；未声称所有客户端版本、Docker/Caddy 生产环境或真实消息送达均已验证。

参考：[MCP transports](https://modelcontextprotocol.io/specification/latest/basic/transports)、[TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[Codex MCP](https://developers.openai.com/codex/mcp/)、[Codex Skills](https://developers.openai.com/codex/skills/)。
