---
name: push9-notify
description: Send user-authorized task completion, failure, or decision-needed notifications through Push9 to a configured Topic. Use when the user requests an external Push9 notification; ordinary in-chat updates do not require this skill.
---

# Push9 Notify

Use the bundled Node.js 20.19+ script or an already configured `push9_send_message` MCP tool when the requested event occurs. Installing this skill does not grant permission to send notifications.

## Configuration

- `PUSH9_TOKEN`: API Token from the Push9 console, beginning with `aip_`.
- `PUSH9_TOPIC`: Topic **code** owned by the Token's account.
- `PUSH9_BASE_URL`: optional HTTPS service root; defaults to `https://push9.top`.
- `PUSH9_IDEMPOTENCY_KEY`: optional stable event ID, 1–128 letters, digits or `._:-`.

Legacy `AI_PUSH_TOKEN`, `AI_PUSH_TOPIC`, `AI_PUSH_BASE_URL` are accepted as fallbacks. Never put credentials in command arguments, messages, committed files, or output. Ask the user to configure missing credentials in their own environment, outside the conversation.

## Sending

1. Use the user's requested timing: completion, failure, or an explicit request for a decision. Do not add unrelated recipients or events.
2. Compose a concise title and summary. Include the outcome and next action; omit credentials, full logs and unnecessary personal information. Title is limited to 120 UTF-16 units and content to 4000.
3. Resolve the script relative to **this skill directory**, not the project's working directory. Run:

```bash
node <installed-skill-directory>/scripts/send.mjs --title "Task completed" --content "Tests passed. Please review the changes." --idempotency-key task-unique-event-id
```

If MCP is configured, call `push9_send_message` with `title`, `content`, and optionally `topic` and `idempotencyKey`. Never pass a Token as a tool argument. Choose either MCP or the script for an event, not both.

4. Report the returned message ID and status. Acceptance is not delivery; receiving channels are chosen by Topic/member preferences, not this script.
5. No automatic retry. For a timeout or unknown outcome, check Push9 message records before resending. A caller-authorized retry must reuse the original event key and identical content within the server's 24-hour deduplication window. Without a key, do not blindly retry. Stop on authentication, ownership or validation errors; honor `Retry-After` for rate limiting.

See the repository documentation for installation, environment setup and MCP configuration: https://github.com/guojingyinan219/push9-agent
