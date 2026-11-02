# Push9 Agent

为 Agent 提供任务完成、失败、需要人工确认时的 Push9 通知。包含可独立安装的 **Agent Skill** 和基于官方 MCP SDK 的 **MCP Server**。两者均调用现有 `POST /api/v1/send`，不需要修改业务服务或安装微信插件。

托管远程 MCP：**`https://push9.top/mcp`**，可直接使用自己的 API Token 接入，无需本地 Node.js。[托管接入步骤与 Codex 配置](docs/hosted.md)。

## 一键安装 Skill

要求 Node.js **20.19+**、npm 和可访问 GitHub 的网络。Windows 用户需安装 Git；`npx` 从 GitHub Git 仓库安装时可能调用 Git。

命令中的 `--allow-git=root` 用于 npm 12 的 Git 来源限制，仅允许本次命令显式指定的根包，不修改全局 npm 配置；旧版 npm 不支持该参数时可移除。首次下载较慢，后续使用缓存。

Codex：

```bash
npx --yes --allow-git=root --package=github:guojingyinan219/push9-agent#v0.1.2 push9-agent install-skill --agent codex
```

Claude Code：

```bash
npx --yes --allow-git=root --package=github:guojingyinan219/push9-agent#v0.1.2 push9-agent install-skill --agent claude
```

安装器只复制 Skill，不配置密钥、不发送通知、不改 MCP 配置。Codex 默认目录为 `~/.agents/skills/push9-notify`，Claude Code 为 `~/.claude/skills/push9-notify`。其他支持 `SKILL.md` 的客户端可用 `--dir /absolute/path/to/skills` 指定其 Skill 父目录。已有目录不会被覆盖，更新前请先检查并备份自己的修改，再移除旧目录后重装。

## 配置自己的 Token 和 Topic

在 [Push9](https://push9.top) 登录，创建 API Token 和 Topic，配置接收渠道。Topic 使用 **code**，不是名称或数据库 ID，且必须属于 Token 的账号。

PowerShell，Token 输入不会显示在终端：

```powershell
$env:PUSH9_BASE_URL = 'https://push9.top'
$env:PUSH9_TOPIC = 'server-alerts'
$env:PUSH9_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Push9 API Token' -AsSecureString)).Password
```

Bash：

```bash
export PUSH9_BASE_URL=https://push9.top
export PUSH9_TOPIC=server-alerts
read -rsp 'Push9 API Token: ' PUSH9_TOKEN; export PUSH9_TOKEN
```

这些命令只设置当前终端及其子进程。请从该终端启动 Agent；已打开的桌面应用不会自动读取新变量，可通过其受保护启动环境配置后重新启动。不要把 Token 发到聊天、放进 Git 仓库或当作命令参数。

重启 Agent 后使用：

> 使用 $push9-notify，任务完成后把结果推送给我。

Skill 使用 `skills/push9-notify/scripts/send.mjs`；它依赖同目录的两个脚本，安装器会一并复制，无需额外 npm 安装。旧 `AI_PUSH_*` 环境变量仍作为兼容回退。

## MCP：无需安装 Skill 也可以用

首版工具：`push9_send_message`。支持 stdio 和无状态 Streamable HTTP。返回受理回执，最终投递仍需在 Push9 消息记录中核对。

通用 stdio 客户端配置：

```json
{
  "mcpServers": {
    "push9": {
      "command": "npx",
      "args": ["--yes", "--allow-git=root", "--package=github:guojingyinan219/push9-agent#v0.1.2", "push9-agent", "mcp"],
      "env": {
        "PUSH9_BASE_URL": "https://push9.top",
        "PUSH9_TOKEN": "aip_replace_with_your_token",
        "PUSH9_TOPIC": "server-alerts"
      }
    }
  }
}
```

将示例 Token 替换为自己的值，只写入**本机受保护的客户端配置**，不要提交。Windows 客户端如果不能直接执行 `npx`，使用 `command: "cmd"`，并在 args 最前增加 `"/c", "npx"`；也可克隆后直接以 `node` 执行脚本绝对路径，避免 Shell。

详见 [MCP 接入和自托管文档](docs/mcp.md)，包括 Codex TOML、HTTP、Docker、Caddy、鉴权、参数、测试与排错。

## 源码运行与验证

```bash
git clone --branch v0.1.2 --depth 1 https://github.com/guojingyinan219/push9-agent.git
cd push9-agent
npm ci --ignore-scripts
npm test
node bin/push9-agent.mjs mcp
```

最后一条需先设置 Token 和 Topic；默认 stdio，等待 MCP 客户端输入并非卡死。测试使用本地模拟 HTTP，不向真实用户推送。所有依赖版本与 lockfile 固定；GitHub tag 固定接入版本，本项目未发布 npm registry 包，也不提供 OAuth 授权登录。
