import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 5173);
const apiUrl = process.env.API_URL || 'http://localhost:8000';
const kioskApiKey = process.env.KIOSK_API_KEY;
const root = path.dirname(fileURLToPath(import.meta.url));

const PROXY_TIMEOUT_MS = 30_000; // 30s max wait for upstream
const WARMUP_INTERVAL_MS = 14 * 60 * 1000; // ping every 14 min to prevent cold start

if (!kioskApiKey && process.env.NODE_ENV === 'production') {
  throw new Error('KIOSK_API_KEY must be configured on the kiosk server');
}

// ── Warm-up ping ──────────────────────────────────────────────────────────────
// Keeps the Python API awake on Render free tier.
// Fires once on boot (after 5s), then every 14 minutes.
async function pingUpstream() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${apiUrl}/health`, {
      signal: controller.signal,
      headers: { 'X-Kiosk-Key': kioskApiKey || 'local-development-kiosk-key' },
    });
    clearTimeout(timer);
    console.log(`[warmup] upstream ping → ${res.status}`);
  } catch (err) {
    console.warn(`[warmup] upstream unreachable: ${err.message}`);
  }
}

setTimeout(pingUpstream, 5_000);
setInterval(pingUpstream, WARMUP_INTERVAL_MS);

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(root, 'dist')));

// ── Health check (kiosk itself — always responds instantly) ───────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', upstream: apiUrl }));

// ── API status endpoint (lets the React app poll before making real calls) ────
app.get('/api/status', async (_req, res) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const upstream = await fetch(`${apiUrl}/health`, {
      signal: controller.signal,
      headers: { 'X-Kiosk-Key': kioskApiKey || 'local-development-kiosk-key' },
    });
    clearTimeout(timer);
    res.json({ ready: upstream.ok, upstreamStatus: upstream.status });
  } catch {
    res.json({ ready: false, upstreamStatus: 0 });
  }
});

// ── Proxy all other /api/* calls ──────────────────────────────────────────────
app.use('/api', async (request, response) => {
  const target = new URL(request.originalUrl.replace(/^\/api/, '') || '/', apiUrl);

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (name !== 'host' && name !== 'content-length' && typeof value === 'string') {
      headers.set(name, value);
    }
  }
  headers.set('X-Kiosk-Key', kioskApiKey || 'local-development-kiosk-key');

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request;

  // Timeout controller — don't hang forever if upstream is cold
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      duplex: body ? 'half' : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    response.status(upstream.status);
    upstream.headers.forEach((value, name) => response.setHeader(name, value));
    response.send(Buffer.from(await upstream.arrayBuffer()));

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.error(`[proxy] timeout after ${PROXY_TIMEOUT_MS}ms: ${target}`);
      response.status(504).json({
        error: 'upstream_timeout',
        message: 'The backend service is warming up. Please retry in a few seconds.',
        retryAfter: 10,
      });
    } else {
      console.error(`[proxy] upstream error: ${err.message}`);
      response.status(502).json({
        error: 'upstream_unavailable',
        message: 'Backend service is temporarily unavailable.',
        retryAfter: 15,
      });
    }
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.use((_request, response) =>
  response.sendFile(path.join(root, 'dist', 'index.html'))
);

app.listen(port, '0.0.0.0', () =>
  console.log(`Kiosk server listening on ${port} → upstream: ${apiUrl}`)
);