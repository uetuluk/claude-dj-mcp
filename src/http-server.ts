import http from "node:http";
import { log } from "./logger.js";
import { getHtmlPage } from "./html-page.js";

const MAX_PORT = 6020;

// --- State stores ---

export interface BrowserState {
  started: boolean;
  activeCode: string;
  error: string | null;
  cps: number;
  lastUpdated: Date;
}

export interface PendingAction {
  action: "evaluate" | "stop";
  code?: string;
  version: number;
}

export interface UserRequest {
  text: string;
  timestamp: string;
}

let pendingAction: PendingAction = { action: "evaluate", code: "", version: 0 };
let browserState: BrowserState = {
  started: false,
  activeCode: "",
  error: null,
  cps: 0.5,
  lastUpdated: new Date(),
};
let requestQueue: UserRequest[] = [];
let serverInstance: http.Server | null = null;
let serverPort = 0;

// --- Public API for MCP tools ---

export function getPendingAction(): PendingAction {
  return { ...pendingAction };
}

export function getBrowserState(): BrowserState {
  return { ...browserState };
}

export function setPendingCode(code: string): number {
  pendingAction = {
    action: "evaluate",
    code,
    version: pendingAction.version + 1,
  };
  return pendingAction.version;
}

export function setPendingStop(): number {
  pendingAction = {
    action: "stop",
    version: pendingAction.version + 1,
  };
  return pendingAction.version;
}

export function drainRequests(): UserRequest[] {
  const items = [...requestQueue];
  requestQueue = [];
  return items;
}

export function getServerPort(): number {
  return serverPort;
}

/**
 * Wait for the browser to report back after a pending action.
 * Polls browserState.lastUpdated for changes.
 */
export function waitForBrowserUpdate(
  timeoutMs: number = 2000
): Promise<BrowserState> {
  const before = browserState.lastUpdated.getTime();
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (browserState.lastUpdated.getTime() > before) {
        resolve({ ...browserState });
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve({ ...browserState });
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

// --- HTTP request handling ---

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res: http.ServerResponse, html: string) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(html);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const url = new URL(req.url || "/", `http://localhost:${serverPort}`);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const sessionId = url.searchParams.get("session") || "default";
      sendHtml(res, getHtmlPage(sessionId, serverPort));
    } else if (url.pathname === "/api/poll" && req.method === "GET") {
      handlePoll(req, res, url);
    } else if (url.pathname === "/api/state" && req.method === "POST") {
      await handleStatePost(req, res);
    } else if (url.pathname === "/api/request" && req.method === "POST") {
      await handleRequestPost(req, res);
    } else if (url.pathname === "/api/health") {
      sendJson(res, { status: "ok", mcp: true, port: serverPort });
    } else {
      sendJson(res, { error: "Not found" }, 404);
    }
  } catch (err) {
    log.error("HTTP handler error:", err);
    sendJson(res, { error: "Internal server error" }, 500);
  }
}

function handlePoll(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _url: URL
) {
  sendJson(res, {
    action: pendingAction.action,
    code: pendingAction.code || null,
    version: pendingAction.version,
    cps: browserState.cps,
  });
}

async function handleStatePost(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const raw = await parseBody(req);
  try {
    const data = JSON.parse(raw);
    browserState = {
      started: Boolean(data.started),
      activeCode: String(data.activeCode || ""),
      error: data.error ? String(data.error) : null,
      cps: typeof data.cps === "number" ? data.cps : browserState.cps,
      lastUpdated: new Date(),
    };
    log.debug("Browser state updated:", {
      started: browserState.started,
      error: browserState.error,
    });
    sendJson(res, { ok: true });
  } catch {
    sendJson(res, { error: "Invalid JSON" }, 400);
  }
}

async function handleRequestPost(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const raw = await parseBody(req);
  try {
    const data = JSON.parse(raw);
    const text = String(data.text || "").trim();
    if (!text) {
      sendJson(res, { error: "Empty request" }, 400);
      return;
    }
    requestQueue.push({
      text,
      timestamp: new Date().toISOString(),
    });
    log.info("User request queued:", text);
    sendJson(res, { ok: true, queued: requestQueue.length });
  } catch {
    sendJson(res, { error: "Invalid JSON" }, 400);
  }
}

// --- Server lifecycle ---

export function startHttpServer(port: number = 6002): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRequest);

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        log.debug(`Port ${port} in use, trying ${port + 1}`);
        if (port >= MAX_PORT) {
          reject(new Error(`No available ports in range 6002-${MAX_PORT}`));
          return;
        }
        startHttpServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      serverInstance = server;
      serverPort = port;
      log.info(`HTTP server listening on port ${port}`);
      resolve(port);
    });
  });
}

export function stopHttpServer(): void {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
    log.info("HTTP server stopped");
  }
}
