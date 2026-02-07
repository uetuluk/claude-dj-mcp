/**
 * http-server.ts — HTTP server for the network radio station.
 *
 * Endpoints:
 *   GET  /          — Listener HTML page
 *   GET  /stream    — MP3 audio stream (chunked, keep-alive)
 *   GET  /api/status — JSON: { playing, currentCode, cps, bpm, listenerCount, cyclePosition }
 *   POST /api/request — Listener song requests
 *   GET  /api/health  — Health check
 */

import http from "node:http";
import { log } from "./logger.js";
import { getHtmlPage } from "./html-page.js";
import {
  addClient,
  getListenerCount,
  getCps,
  getIsPlaying,
} from "./stream-manager.js";

const MAX_PORT = 6020;

// ── State ────────────────────────────────────────────────────────────

export interface RadioState {
  isPlaying: boolean;
  currentPatternCode: string;
  cps: number;
  listenerCount: number;
}

export interface UserRequest {
  text: string;
  timestamp: string;
}

let currentPatternCode = "";
let requestQueue: UserRequest[] = [];
let serverInstance: http.Server | null = null;
let serverPort = 0;

// ── Public API for MCP tools ─────────────────────────────────────────

export function setCurrentPatternCode(code: string): void {
  currentPatternCode = code;
}

export function getCurrentPatternCode(): string {
  return currentPatternCode;
}

export function getRadioState(): RadioState {
  return {
    isPlaying: getIsPlaying(),
    currentPatternCode,
    cps: getCps(),
    listenerCount: getListenerCount(),
  };
}

export function drainRequests(): UserRequest[] {
  const items = [...requestQueue];
  requestQueue = [];
  return items;
}

export function getServerPort(): number {
  return serverPort;
}

// ── HTTP helpers ─────────────────────────────────────────────────────

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

// ── Request handler ──────────────────────────────────────────────────

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
      sendHtml(res, getHtmlPage(serverPort));
    } else if (url.pathname === "/stream" && req.method === "GET") {
      // Register client for MP3 streaming
      addClient(res);
    } else if (url.pathname === "/api/status" && req.method === "GET") {
      handleStatus(res);
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

function handleStatus(res: http.ServerResponse) {
  const cps = getCps();
  const bpm = Math.round(cps * 240);
  sendJson(res, {
    playing: getIsPlaying(),
    currentCode: currentPatternCode,
    cps,
    bpm,
    listenerCount: getListenerCount(),
  });
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

// ── Server lifecycle ─────────────────────────────────────────────────

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

    // Bind to 0.0.0.0 for LAN access
    server.listen(port, "0.0.0.0", () => {
      serverInstance = server;
      serverPort = port;
      log.info(`HTTP server listening on 0.0.0.0:${port}`);
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
