#!/usr/bin/env node
// Keep the script self-contained when installed as a Skill.
process.env.PUSH9_TOKEN ||= process.env.AI_PUSH_TOKEN;
process.env.PUSH9_TOPIC ||= process.env.AI_PUSH_TOPIC;
process.env.PUSH9_BASE_URL ||= process.env.AI_PUSH_BASE_URL || 'https://push9.top';
await import('./send-cli.mjs');
