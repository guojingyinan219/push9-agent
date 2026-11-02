# Push9 托管 MCP 接入

当前远程地址：**`https://push9.top/mcp`**。传输方式 **Streamable HTTP**；使用用户自己的 Push9 API Token，**无需安装 Node.js、无需自己部署服务器**。本地 stdio 和 Skill 的固定版本安装命令保持不变。

## 配置步骤

1. 在 [Push9](https://push9.top) 登录，创建 API Token 和 Topic，配置接收通道，记录 Topic **code**。Token 必须属于 Topic 创建者。
2. 在客户端受保护的环境或本地设置中配置 Token；不要发到聊天、不要写入 URL 或工具参数。
3. 客户端选择 Streamable HTTP，URL 填 `https://push9.top/mcp`；认证 Header 填 `Authorization: Bearer <自己的API Token>`。不要选择 OAuth 或旧 SSE。
4. 刷新工具列表，确认出现 **`push9_send_message`**。
5. 授权 Agent 发送一次测试消息，并在 Push9 消息记录和实际接收端核对结果。

## Codex

在启动 Codex 的受保护环境中设置 `PUSH9_TOKEN`。合并到现有 `~/.codex/config.toml`，不要覆盖其他配置：

```toml
[mcp_servers.push9]
url = "https://push9.top/mcp"
bearer_token_env_var = "PUSH9_TOKEN"
```

环境变量只在启动时读取；已打开的桌面进程需重新启动。Token 不必写入 TOML。其他支持自定义 Header 的客户端，按各自版本填写 URL 和 Bearer；只支持 OAuth 的客户端暂不兼容。

## 工具调用

```json
{
  "topic": "server-alerts",
  "title": "任务完成",
  "content": "测试通过，请查看结果。",
  "idempotencyKey": "unique-task-event-id"
}
```

工具名 `push9_send_message`。远程调用必须显式传 `topic`，2–48 位字母、数字、下划线或连字符。title 为 1–120 UTF-16 单元，content 为 1–4000。接收渠道按 Topic/成员偏好选择，没有 channels 参数。

返回 `accepted`、消息 `id`、`status`、`totalCount`，不返回接收人的 OpenID、邮箱或原始投递任务。受理不代表送达。没有自动重试；不确定是否受理时先核对记录，授权重试需沿用原键和原内容。每个新事件使用独立键，同一账号/键/内容在服务端 24 小时内幂等。

## 认证与错误

服务不保存跨请求会话；每个请求独立绑定调用者的 Token。不会使用平台预置的用户 Token。握手/列工具只校验 Bearer 格式，真实有效性、过期/撤销、Topic 归属和账号额度在发送 API 中校验；**握手成功不代表 Token 有效**。

- HTTP 401：缺少 Bearer 或格式错误。工具内 401：Token 无效、过期或撤销。
- 工具内 404：Topic 不存在或不属于 Token 的账号。
- 工具内 409：同一幂等键用于不同内容。
- 工具内 429：触发账号额度；核对服务端限制后等待再试。
- HTTP 403：Host 或 Origin 不被允许。该端点用于 MCP 客户端，不是通用浏览器跨域 API。
- HTTP 405：客户端用了旧 SSE/GET；请选择 Streamable HTTP。
- 超时/5xx：可能无法判断是否受理，先核对记录，不盲目重发。

Skill、stdio、远程 HTTP 三种入口任选一种；不要为同一个事件多入口各发一次。

[本地 stdio 与 Docker/Caddy 自托管详细文档](mcp.md) 是初始发布版说明，其中“未托管”的描述记录的是该版本发布时的状态；当前托管状态以本页和网站文档为准。
