import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The TTS service (tts/) and llama-server run on plain HTTP on localhost. Proxying them
// keeps the page's requests same-origin HTTPS, so the headset doesn't block them as mixed
// content.
const proxy = {
  '/tts': {
    target: 'http://127.0.0.1:8880',
    rewrite: (path) => path.replace(/^\/tts/, ''),
  },
  '/llm': {
    target: 'http://127.0.0.1:8080',
    rewrite: (path) => path.replace(/^\/llm/, ''),
  },
};

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

// GET /search?q=… → [{ title, url, snippet }], the LLM's web_search tool. The page can't
// fetch other sites itself (CORS), so the dev server asks DuckDuckGo's HTML endpoint.
async function search(q) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
  });
  const html = await res.text();
  const results = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, href, title, snippet] of html.matchAll(re)) {
    const url = decodeURIComponent(href.match(/uddg=([^&]*)/)?.[1] ?? href);
    results.push({ title: strip(title), url, snippet: strip(snippet) });
    if (results.length >= 5) break;
  }
  return results;
}

function webSearch() {
  const middleware = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/search') return next();
    res.setHeader('Content-Type', 'application/json');
    try {
      res.end(JSON.stringify(await search(url.searchParams.get('q') ?? '')));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: err.message }));
    }
  };
  return {
    name: 'web-search',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

// WebXR only runs in a secure context, so the headset needs HTTPS to reach the dev server
// over the local network. `host: true` exposes the server on the LAN.
//
// `--mode http` (npm run dev:http) serves plain HTTP for a reverse proxy such as Caddy
// that terminates TLS. The proxy forwards its own domain as the Host header, which Vite
// rejects by default, so list it in ALLOWED_HOSTS (comma-separated); unset allows any host.
export default defineConfig(({ mode }) => {
  const behindProxy = mode === 'http';
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(',') ?? true;
  const server = { host: true, proxy, ...(behindProxy && { allowedHosts }) };

  return {
    plugins: behindProxy ? [webSearch()] : [basicSsl(), webSearch()],
    server,
    preview: server,
  };
});
