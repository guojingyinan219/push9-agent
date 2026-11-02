// Shared transport for upstream integrations. Node.js 20.19+; no dependencies.
export class Push9Error extends Error {
  constructor(code, message, { status, outcome = 'not-sent' } = {}) {
    super(message);
    this.name = 'Push9Error';
    this.code = code;
    this.status = status;
    this.outcome = outcome;
  }
}

export function sendEndpoint(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch {
    throw new Push9Error('CONFIG', 'PUSH9_BASE_URL must be an absolute URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash) {
    throw new Push9Error('CONFIG', 'Use HTTPS (HTTP is allowed only on loopback), without credentials, query or fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/v1/send`;
  return url;
}

/** Success means accepted by Push9, not delivery to WeChat or another provider. */
export async function sendMessage({ baseUrl, token, topic, title, content, event, idempotencyKey, timeoutMs = 15000 }) {
  const endpoint = sendEndpoint(baseUrl);
  if (typeof token !== 'string' || !/^aip_[A-Za-z0-9_-]+$/.test(token)) {
    throw new Push9Error('CONFIG', 'Set PUSH9_TOKEN to a valid API Token.');
  }
  if (typeof topic !== 'string' || !/^[a-zA-Z0-9_-]{2,48}$/.test(topic)) {
    throw new Push9Error('CONFIG', 'Topic must contain 2-48 letters, digits, underscores or hyphens.');
  }
  let payload;
  if (event !== undefined) {
    if (title !== undefined || content !== undefined || !event || !['build', 'task', 'form', 'status', 'notice'].includes(event.type)
        || !event.data || Array.isArray(event.data) || typeof event.data !== 'object'
        || Object.keys(event.data).length < 1 || Object.keys(event.data).length > 12
        || Object.entries(event.data).some(([key, value]) => key.length > 32 || typeof value !== 'string' || value.length > 1000)) {
      throw new Push9Error('CONFIG', 'Use one supported event type with 1-12 string fields; do not combine event and title/content.');
    }
    endpoint.pathname = endpoint.pathname.replace(/\/api\/v1\/send$/, '/api/v1/integrations/events/' + topic);
    payload = { type: event.type, data: event.data, idempotencyKey };
  } else {
    for (const [name, value, max] of [['title', title, 120], ['content', content, 4000]]) {
      if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new Push9Error('CONFIG', `${name} must contain 1-${max} characters.`);
      }
    }
    payload = { topic, title, content, idempotencyKey };
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw new Push9Error('CONFIG', 'Timeout must be 100-120000 milliseconds.');
  }
  const controller = new AbortController();
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey))) {
    throw new Push9Error('CONFIG', 'idempotencyKey must contain 1-128 letters, digits or . _ : -');
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // Do not print a proxy/provider response: it may echo credentials or message content.
      throw new Push9Error('HTTP', `Push9 returned HTTP ${response.status}; check credentials, Topic and server logs. No automatic retry.`, {
        status: response.status, outcome: 'unknown',
      });
    }
    // The current API includes all recipient tasks. Keep memory bounded for large Topics.
    let raw = '';
    let bytes = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        controller.abort();
        throw new Push9Error('RESPONSE', 'Push9 response exceeded 2 MiB; verify acceptance in the console before resending.', { outcome: 'unknown' });
      }
      raw += decoder.decode(chunk, { stream: true });
    }
    raw += decoder.decode();
    let body;
    try { body = JSON.parse(raw); } catch {
      throw new Push9Error('RESPONSE', 'Push9 returned invalid JSON; verify acceptance before resending.', { outcome: 'unknown' });
    }
    const statuses = ['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'];
    if (!body || typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.id)
        || !statuses.includes(body.status) || !Number.isInteger(body.totalCount) || body.totalCount < 0) {
      throw new Push9Error('RESPONSE', 'Unexpected Push9 response; verify acceptance before resending.', { outcome: 'unknown' });
    }
    return { accepted: true, id: body.id, status: body.status, totalCount: body.totalCount };
  } catch (error) {
    if (error instanceof Push9Error) throw error;
    throw new Push9Error('NETWORK', 'Push9 request timed out or failed; acceptance is unknown. Check the console before resending.', { outcome: 'unknown' });
  } finally {
    clearTimeout(timer);
  }
}
