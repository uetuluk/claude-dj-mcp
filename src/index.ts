#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "node:child_process";
import { log } from "./logger.js";
import {
  startHttpServer,
  getServerPort,
  setPendingCode,
  setPendingStop,
  getBrowserState,
  drainRequests,
  waitForBrowserUpdate,
} from "./http-server.js";
import { getSounds } from "./sounds.js";
import { registerPrompts } from "./prompts.js";

const server = new McpServer({
  name: "claude-dj",
  version: "0.1.0",
});

// Track whether a session is active
let sessionActive = false;
let sessionId = "";
let sessionUrl = "";

// --- Tool 1: start_session ---
server.tool(
  "start_session",
  "Start a DJ session: launches HTTP server and opens browser with Strudel REPL. User must click 'Start Audio' button.",
  {},
  async () => {
    try {
      if (sessionActive) {
        return {
          content: [
            {
              type: "text",
              text: `Session already active.\nSession ID: ${sessionId}\nURL: ${sessionUrl}\n\nIf the browser is closed, open: ${sessionUrl}`,
            },
          ],
        };
      }

      const port = await startHttpServer();
      sessionId = `dj-${Date.now().toString(36)}`;
      sessionUrl = `http://localhost:${port}?session=${sessionId}`;
      sessionActive = true;

      // Open browser
      const open = await import("open");
      await open.default(sessionUrl);

      log.info(`Session started: ${sessionId} at ${sessionUrl}`);

      return {
        content: [
          {
            type: "text",
            text: `DJ session started!\n\nSession ID: ${sessionId}\nURL: ${sessionUrl}\n\nIMPORTANT: Tell the user to click the "Start Audio" button in the browser.\nThen call get_session_state to confirm audio is active before playing patterns.`,
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error("Failed to start session:", msg);
      return {
        content: [{ type: "text", text: `Error starting session: ${msg}` }],
        isError: true,
      };
    }
  }
);

// --- Tool 2: play_pattern ---
server.tool(
  "play_pattern",
  "Send Strudel pattern code to the browser REPL for evaluation. The code will be set and evaluated in the Strudel editor.",
  {
    code: z
      .string()
      .describe("Strudel pattern code to evaluate (e.g., 's(\"bd sd hh sd\")')"),
  },
  async ({ code }) => {
    if (!sessionActive) {
      return {
        content: [
          {
            type: "text",
            text: "No active session. Call start_session first.",
          },
        ],
        isError: true,
      };
    }

    try {
      const version = setPendingCode(code);
      log.debug(`Pattern queued (v${version}):`, code.substring(0, 80));

      // Wait for browser to pick up and evaluate
      const state = await waitForBrowserUpdate(3000);

      if (state.error) {
        return {
          content: [
            {
              type: "text",
              text: `Pattern evaluation error: ${state.error}\n\nThe code was sent but the browser reported an error. Try simplifying the pattern.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Pattern is playing (v${version}).\nBrowser state: started=${state.started}, cps=${state.cps}`,
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// --- Tool 3: stop_music ---
server.tool(
  "stop_music",
  "Stop the currently playing Strudel pattern.",
  {},
  async () => {
    if (!sessionActive) {
      return {
        content: [
          {
            type: "text",
            text: "No active session. Call start_session first.",
          },
        ],
        isError: true,
      };
    }

    const version = setPendingStop();
    log.info(`Stop queued (v${version})`);

    return {
      content: [
        {
          type: "text",
          text: `Stop command sent (v${version}). Music will stop on next browser poll.`,
        },
      ],
    };
  }
);

// --- Tool 4: get_session_state ---
server.tool(
  "get_session_state",
  "Get the current state of the browser: whether audio is started, active code, errors, and tempo (CPS).",
  {},
  async () => {
    if (!sessionActive) {
      return {
        content: [
          {
            type: "text",
            text: "No active session. Call start_session first.",
          },
        ],
        isError: true,
      };
    }

    const state = getBrowserState();
    const bpm = Math.round(state.cps * 60 * 4);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              started: state.started,
              activeCode: state.activeCode,
              error: state.error,
              cps: state.cps,
              bpm,
              lastUpdated: state.lastUpdated.toISOString(),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool 5: set_tempo ---
server.tool(
  "set_tempo",
  "Set the playback tempo. Provide either BPM or CPS (cycles per second). For 4/4 time: CPS = BPM / 240.",
  {
    bpm: z
      .number()
      .min(30)
      .max(300)
      .optional()
      .describe("Beats per minute (30-300)"),
    cps: z
      .number()
      .min(0.1)
      .max(2)
      .optional()
      .describe("Cycles per second (0.1-2.0)"),
  },
  async ({ bpm, cps }) => {
    if (!sessionActive) {
      return {
        content: [
          {
            type: "text",
            text: "No active session. Call start_session first.",
          },
        ],
        isError: true,
      };
    }

    let targetCps: number;
    if (cps !== undefined) {
      targetCps = cps;
    } else if (bpm !== undefined) {
      targetCps = bpm / 240;
    } else {
      return {
        content: [
          { type: "text", text: "Provide either bpm or cps parameter." },
        ],
        isError: true,
      };
    }

    const tempoCode = `setcps(${targetCps})`;
    setPendingCode(tempoCode);
    const resultBpm = Math.round(targetCps * 240);

    log.info(`Tempo set: ${resultBpm} BPM (${targetCps} CPS)`);

    return {
      content: [
        {
          type: "text",
          text: `Tempo set to ${resultBpm} BPM (${targetCps.toFixed(4)} CPS).`,
        },
      ],
    };
  }
);

// --- Tool 6: dj_speak ---
server.tool(
  "dj_speak",
  "Use macOS text-to-speech to announce over the music. Fire-and-forget: returns immediately. Only works on macOS.",
  {
    text: z.string().max(500).describe("Text to speak aloud"),
    voice: z
      .string()
      .optional()
      .describe('macOS voice name (e.g., "Samantha", "Alex", "Daniel")'),
    rate: z
      .number()
      .min(100)
      .max(400)
      .optional()
      .describe("Speech rate in words per minute (default: 200)"),
  },
  async ({ text, voice, rate }) => {
    // Shell-escape the text: replace single quotes with escaped version
    const escaped = text.replace(/'/g, "'\\''");

    let cmd = `say '${escaped}'`;
    if (voice) {
      const escapedVoice = voice.replace(/'/g, "'\\''");
      cmd += ` -v '${escapedVoice}'`;
    }
    if (rate) {
      cmd += ` -r ${Math.round(rate)}`;
    }

    log.info(`Speaking: "${text.substring(0, 50)}..."`);

    // Fire and forget — don't await
    exec(cmd, (err) => {
      if (err) {
        log.debug("Speech error (may not be macOS):", err.message);
      }
    });

    return {
      content: [
        {
          type: "text",
          text: `Speaking: "${text}"\n(Fire-and-forget via macOS 'say' command. No-op on non-macOS systems.)`,
        },
      ],
    };
  }
);

// --- Tool 7: check_requests ---
server.tool(
  "check_requests",
  "Check for pending user requests submitted via the browser UI. Drains the queue.",
  {},
  async () => {
    const requests = drainRequests();

    if (requests.length === 0) {
      return {
        content: [{ type: "text", text: "No pending requests." }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `${requests.length} pending request(s):\n${requests
            .map((r, i) => `${i + 1}. "${r.text}" (${r.timestamp})`)
            .join("\n")}`,
        },
      ],
    };
  }
);

// --- Tool 8: wait ---
server.tool(
  "wait",
  "Wait for a specified number of seconds (letting the music play), then return any pending user requests. This is the core DJ loop tool.",
  {
    seconds: z
      .number()
      .min(1)
      .max(300)
      .describe("Number of seconds to wait (1-300)"),
  },
  async ({ seconds }) => {
    log.debug(`Waiting ${seconds}s...`);

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    const requests = drainRequests();
    const state = getBrowserState();

    let text = `Waited ${seconds} seconds.\n`;
    text += `Current state: started=${state.started}, cps=${state.cps}`;

    if (state.error) {
      text += `\nBrowser error: ${state.error}`;
    }

    if (requests.length > 0) {
      text += `\n\n${requests.length} pending request(s):\n`;
      text += requests
        .map((r, i) => `${i + 1}. "${r.text}" (${r.timestamp})`)
        .join("\n");
    } else {
      text += "\n\nNo pending requests.";
    }

    return {
      content: [{ type: "text", text }],
    };
  }
);

// --- Tool 9: get_available_sounds ---
server.tool(
  "get_available_sounds",
  "Get a curated list of available Strudel sounds, organized by category.",
  {
    category: z
      .enum(["drums", "synths", "instruments", "effects", "all"])
      .optional()
      .describe("Sound category to list (default: all)"),
  },
  async ({ category }) => {
    return {
      content: [{ type: "text", text: getSounds(category) }],
    };
  }
);

// --- Register prompts ---
registerPrompts(server);

// --- Main ---
async function main() {
  log.info("Claude DJ MCP server starting...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server connected via stdio");
}

main().catch((error) => {
  log.error("Fatal error:", error);
  process.exit(1);
});
