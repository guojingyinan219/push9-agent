#!/usr/bin/env node
import { sendMessage, Push9Error } from './client.mjs';

const usage = 'node send.mjs --title "Build failed" --content "Details" [--topic code] [--base-url https://push9.top] [--timeout-ms 15000]\nOr: node send.mjs --event-file templates/task.json [--idempotency-key unique-event-id]\nUse --content-file path (or - for stdin) instead of --content. Set PUSH9_TOKEN in the environment.';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
  } else {
    const options = {};
    const allowed = new Set(['title', 'content', 'content-file', 'topic', 'base-url', 'timeout-ms', 'idempotency-key', 'event-file']);
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].replace(/^--/, '');
      const value = args[i + 1];
      if (!args[i].startsWith('--') || !allowed.has(key) || value === undefined || value.startsWith('--') || Object.hasOwn(options, key)) {
        throw new Push9Error('CONFIG', 'Invalid, duplicate or missing CLI option. Run with --help.');
      }
      options[key] = value;
    }
    if (Object.hasOwn(options, 'content') && Object.hasOwn(options, 'content-file')) {
      throw new Push9Error('CONFIG', 'Choose --content or --content-file.');
    }
    let content = options.content, event;
    if (options['event-file']) {
      if (['title', 'content', 'content-file'].some(key => Object.hasOwn(options, key)))
        throw new Push9Error('CONFIG', 'Choose --event-file or --title/--content.');
      try {
        const { open } = await import('node:fs/promises');
        const file = await open(options['event-file'], 'r');
        try {
          if ((await file.stat()).size > 64000) throw Error('too large');
          event = JSON.parse(await file.readFile('utf8'));
        } finally { await file.close(); }
      } catch { throw new Push9Error('CONFIG', 'Cannot read event JSON, or input exceeds 64000 bytes.'); }
    }
    if (options['content-file']) {
      try {
        if (options['content-file'] === '-') {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of process.stdin) {
            bytes += chunk.length;
            if (bytes > 16000) throw new Error('input too large');
            chunks.push(chunk);
          }
          content = Buffer.concat(chunks).toString('utf8');
        } else {
          const { open } = await import('node:fs/promises');
          const file = await open(options['content-file'], 'r');
          try {
            if ((await file.stat()).size > 16000) throw new Error('input too large');
            content = await file.readFile('utf8');
          } finally { await file.close(); }
        }
      } catch { throw new Push9Error('CONFIG', 'Cannot read content input, or input exceeds 16000 bytes.'); }
    }
    const result = await sendMessage({
      baseUrl: options['base-url'] || process.env.PUSH9_BASE_URL || 'http://localhost:3100',
      token: process.env.PUSH9_TOKEN,
      topic: options.topic || process.env.PUSH9_TOPIC,
      title: options.title,
      content,
      event,
      idempotencyKey: options['idempotency-key'] ?? process.env.PUSH9_IDEMPOTENCY_KEY,
      timeoutMs: Number(options['timeout-ms'] || process.env.PUSH9_TIMEOUT_MS || 15000),
    });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  const safe = error instanceof Push9Error ? error : new Push9Error('CONFIG', 'Invalid client configuration.');
  console.error(JSON.stringify({ accepted: safe.outcome === 'unknown' ? null : false, code: safe.code, status: safe.status, outcome: safe.outcome, message: safe.message }));
  process.exitCode = safe.code === 'CONFIG' ? 2 : 1;
}
