import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { sendEndpoint, sendMessage, Push9Error } from '../skills/push9-notify/scripts/client.mjs';

const tokenPattern = /^aip_[A-Za-z0-9_-]+$/;
const split = value => (value || '').split(',').map(v => v.trim()).filter(Boolean);

export function createServer({ token, baseUrl = 'https://push9.top', topic }) {
  sendEndpoint(baseUrl);
  const server = new McpServer({ name: 'push9', version: '0.1.0' }, {
    instructions: 'Send only user-authorized notifications. A receipt means accepted, not delivered. Do not blindly retry unknown outcomes; reuse the same event key and content for authorized retries.',
  });
  server.registerTool('push9_send_message', {
    title: 'Send a Push9 notification',
    description: 'Send a user-authorized message to a Topic owned by the configured API Token. Each member receives through one configured channel. Returns only an acceptance receipt. No automatic retry.',
    inputSchema: {
      topic: z.string().regex(/^[A-Za-z0-9_-]{2,48}$/).optional().describe('Topic code, or omit to use the configured default'),
      title: z.string().trim().min(1).max(120),
      content: z.string().trim().min(1).max(4000),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional().describe('Unique event ID. Reuse only for retries of the same message within 24 hours.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async input => {
    try {
      const receipt = await sendMessage({ baseUrl, token, topic: input.topic || topic,
        title: input.title, content: input.content, idempotencyKey: input.idempotencyKey });
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], structuredContent: receipt };
    } catch (error) {
      const safe = error instanceof Push9Error ? error : new Push9Error('INTERNAL', 'Push9 request failed. Check server configuration.', { outcome: 'unknown' });
      const result = { accepted: safe.outcome === 'unknown' ? null : false, code: safe.code, status: safe.status,
        outcome: safe.outcome, message: safe.message };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  });
  return server;
}

export function createHttpApp({ baseUrl = 'https://push9.top', host = '127.0.0.1', allowedHosts, allowedOrigins = [] } = {}) {
  sendEndpoint(baseUrl);
  if (!allowedHosts?.length && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw Error('Set PUSH9_MCP_ALLOWED_HOSTS when binding outside loopback.');
  }
  const app = createMcpExpressApp({ host, allowedHosts: allowedHosts?.length ? allowedHosts : undefined });
  app.disable('x-powered-by');
  app.use('/mcp', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'Query parameters are not accepted.' });
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origin not allowed.' });
    if (!/^Bearer aip_[A-Za-z0-9_-]+$/i.test(req.headers.authorization || '')) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Send your Push9 API Token in Authorization: Bearer.' });
    }
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.post('/mcp', async (req, res) => {
    // A new server per request: no shared credentials, conversations, or session state.
    const token = req.headers.authorization.slice(7);
    const server = createServer({ token, baseUrl });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
    }
  });
  app.all('/mcp', (_req, res) => { res.setHeader('Allow', 'POST'); res.status(405).end(); });
  app.use((error, _req, res, _next) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid MCP request body.' });
  });
  return app;
}

export async function start(env = process.env) {
  const mode = env.PUSH9_MCP_TRANSPORT || 'stdio';
  const baseUrl = env.PUSH9_BASE_URL || env.AI_PUSH_BASE_URL || 'https://push9.top';
  if (mode === 'stdio') {
    const token = env.PUSH9_TOKEN || env.AI_PUSH_TOKEN;
    if (!tokenPattern.test(token || '')) throw Error('Set PUSH9_TOKEN.');
    const server = createServer({ token, baseUrl, topic: env.PUSH9_TOPIC || env.AI_PUSH_TOPIC });
    await server.connect(new StdioServerTransport());
    return server;
  }
  if (mode !== 'http') throw Error('Unknown MCP transport.');
  const host = env.PUSH9_MCP_HOST || '127.0.0.1';
  const port = Number(env.PUSH9_MCP_PORT || 3110);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port.');
  const app = createHttpApp({ baseUrl, host, allowedHosts: split(env.PUSH9_MCP_ALLOWED_HOSTS), allowedOrigins: split(env.PUSH9_MCP_ALLOWED_ORIGINS) });
  const listener = app.listen(port, host, () => console.error('Push9 MCP HTTP listening on configured host and port.'));
  listener.requestTimeout = 30000;
  listener.headersTimeout = 15000;
  return listener;
}
