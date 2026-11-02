import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp } from '../src/server.mjs';
import { installSkill } from '../src/install-skill.mjs';

const cli = fileURLToPath(new URL('../bin/push9-agent.mjs', import.meta.url));
const token = 'aip_test_placeholder';
async function listen(t, app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function upstream(t) {
  const calls = [];
  let responseCode = 200;
  const url = await listen(t, async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    calls.push({ path: req.url, token: req.headers.authorization, body: JSON.parse(raw) });
    res.writeHead(responseCode);
    res.end(JSON.stringify(responseCode === 200 ? { id: 'mock-id', status: 'QUEUED', totalCount: 1, deliveries: [{ target: 'private' }] } : { message: token }));
  });
  return { calls, url, fail: code => { responseCode = code; } };
}

test('real SDK stdio handshake, discovery, validation and call return a minimal receipt', async t => {
  const api = await upstream(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'],
    env: { ...process.env, PUSH9_BASE_URL: api.url, PUSH9_TOKEN: token, PUSH9_TOPIC: 'test-topic', PUSH9_MCP_TRANSPORT: 'stdio' }, stderr: 'pipe' });
  const client = new Client({ name: 'verification', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(v => v.name), ['push9_send_message']);
  assert.equal(JSON.stringify(tools).includes(token), false);
  const result = await client.callTool({ name: 'push9_send_message', arguments: { title: 'Task', content: 'Done', idempotencyKey: 'task-123' } });
  assert.deepEqual(result.structuredContent, { accepted: true, id: 'mock-id', status: 'QUEUED', totalCount: 1 });
  assert.equal(api.calls[0].path, '/api/v1/send');
  assert.deepEqual(api.calls[0].body, { topic: 'test-topic', title: 'Task', content: 'Done', idempotencyKey: 'task-123' });
  const invalid = await client.callTool({ name: 'push9_send_message', arguments: { title: 'Task', content: 'Done', topic: '../bad' } });
  assert.equal(invalid.isError, true); assert.equal(api.calls.length, 1);
  api.fail(401);
  const failed = await client.callTool({ name: 'push9_send_message', arguments: { title: 'Task', content: 'Done' } });
  assert.equal(failed.isError, true);
  assert.equal(JSON.stringify(failed).includes(token), false);
  assert.equal(JSON.parse(failed.content[0].text).status, 401);
  assert.equal(api.calls.length, 2);
});

test('real SDK HTTP clients isolate tokens, require auth, reject origins and never use a server-global token', async t => {
  const api = await upstream(t);
  const endpoint = await listen(t, createHttpApp({ baseUrl: api.url }));
  for (const headers of [{}, { Authorization: 'Bearer wrong' }]) {
    const res = await fetch(endpoint + '/mcp', { method: 'POST', headers });
    assert.equal(res.status, 401);
  }
  assert.equal((await fetch(endpoint + '/mcp?token=ignored', { method: 'POST' })).status, 400);
  assert.equal((await fetch(endpoint + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://untrusted.example' } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.request(endpoint + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostStatus, 403);
  const clients = [];
  for (const suffix of ['one', 'two']) {
    const client = new Client({ name: 'http-' + suffix, version: '1.0.0' });
    clients.push(client); t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer aip_' + suffix } } }));
    assert.equal((await client.listTools()).tools.length, 1);
  }
  const results = await Promise.all(clients.map((client, i) => client.callTool({ name: 'push9_send_message', arguments: { topic: 'topic-' + i, title: 'Task', content: 'Done' } })));
  assert.ok(results.every(result => !result.isError));
  assert.deepEqual(api.calls.map(c => c.token).sort(), ['Bearer aip_one', 'Bearer aip_two']);
  const missingTopic = await clients[0].callTool({ name: 'push9_send_message', arguments: { title: 'Task', content: 'Done' } });
  assert.equal(missingTopic.isError, true); assert.equal(api.calls.length, 2);
  assert.throws(() => createHttpApp({ host: '0.0.0.0' }));
});

test('Skill installs without credentials, works independently and refuses to overwrite existing files', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'push9-skill-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const location = await installSkill({ agent: 'codex', userHome: home });
  assert.equal(location, path.join(home, '.agents', 'skills', 'push9-notify'));
  await assert.rejects(installSkill({ agent: 'codex', userHome: home }), /already exists/);
  await installSkill({ agent: 'claude', userHome: home });
  assert.ok((await readFile(path.join(location, 'SKILL.md'), 'utf8')).includes('name: push9-notify'));
  const api = await upstream(t);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(location, 'scripts', 'send.mjs'), '--title', 'Test', '--content', 'Independent skill'], {
      env: { ...process.env, PUSH9_TOKEN: token, PUSH9_TOPIC: 'skill-topic', PUSH9_BASE_URL: api.url }, windowsHide: true,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).accepted, true);
  assert.equal(api.calls.length, 1); assert.equal(api.calls[0].body.channels, undefined);
});
