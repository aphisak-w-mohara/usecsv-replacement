// Tiny in-memory webhook catcher for the E2E flow. The worker's queue consumer
// POSTs each batch here instead of the real usecsv-style endpoint, so the test
// can assert what the importer actually delivered — byte-for-byte — without any
// external service.
//
// Endpoints:
//   POST  /hook         → records the JSON body, replies 200 {"ok":true}
//   GET   /__captured   → returns the array of captured request bodies (+headers)
//   POST  /__reset      → clears the captured list
//   GET   /__health     → readiness probe for Playwright's webServer
//
// Port comes from CATCHER_PORT (default 9099).
import { createServer } from "node:http";

const PORT = Number(process.env.CATCHER_PORT ?? 9099);
/** @type {{ url: string, headers: Record<string,string>, body: unknown }[]} */
const captured = [];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/__health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url === "/__captured") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(captured));
    return;
  }

  if (req.method === "POST" && url === "/__reset") {
    captured.length = 0;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST") {
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
    captured.push({ url, headers: Object.fromEntries(Object.entries(req.headers)), body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[webhook-catcher] listening on http://localhost:${PORT}`);
});
