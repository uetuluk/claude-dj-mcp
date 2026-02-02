# Claude DJ MCP

An MCP server that lets Claude act as an autonomous radio DJ using [Strudel](https://strudel.cc/) live-coded music.

## Features

- 🎵 **Live-coded music** — Claude generates Strudel patterns in real-time
- 🎙️ **DJ announcements** — Text-to-speech commentary (macOS)
- 🎚️ **Dynamic tempo control** — Adjust BPM mid-session
- 📻 **Audience requests** — Take song/vibe requests from browser UI
- 🔄 **Autonomous DJ loop** — Play → announce → wait → adapt → repeat

## Security Notice

⚠️ **This project is designed for local development and personal use only.**

**Important security considerations:**

- **Local use only** — The HTTP server binds to localhost but has open CORS headers (`Access-Control-Allow-Origin: *`)
- **Code execution** — Claude sends arbitrary Strudel code that is evaluated in the browser without sandboxing
- **Command execution** — The `dj_speak` tool executes shell commands (macOS `say`) with user-controlled input
- **No authentication** — Anyone with access to localhost can interact with active sessions
- **No rate limiting** — Request queue and endpoints are not protected against abuse

**Recommendations:**

- Only run on trusted machines with trusted Claude instances
- Do not expose the HTTP server to network interfaces beyond localhost
- Do not run in multi-user environments without additional security hardening
- Review the code before use if you have security concerns

## Architecture

```
Claude (MCP client)
  │ stdio (JSON-RPC)
  ▼
MCP Server (Node.js)
  │ In-memory state: pendingCode, pendingAction, browserState, requestQueue
  │
  ├─ HTTP Server (port 6002, auto-increment if busy)
  │   GET /              → HTML page with <strudel-editor> + request bar
  │   GET /api/poll      → Browser polls: returns pending code/action
  │   POST /api/state    → Browser posts: started, activeCode, error, cps
  │   POST /api/request  → User submits song/vibe request from browser UI
  │   GET /api/health    → Health check
  │
  └─ Browser (opened via `open` package)
      <strudel-editor> web component (loaded from unpkg CDN)
      Polls /api/poll every 1s, executes pending actions
      Posts state back via /api/state after each action
      Request bar at bottom for user input
```

## Installation

### 1. Build the MCP server

```bash
npm install
npm run build
```

### 2. Configure in Claude Code / Claude Desktop

Add to your MCP settings (e.g., `~/.config/claude-code/mcp.json`):

```json
{
  "mcpServers": {
    "claude-dj": {
      "command": "node",
      "args": ["~/claude-dj-mcp/dist/index.js"]
    }
  }
}
```

## Usage

### Quick start

In Claude Code or Claude Desktop:

```
Use the claude-dj skill to start a DJ session
```

Or call tools directly:

```
Call start_session, then tell me when audio is ready
```

### The DJ Loop

Once the session is started and audio is active:

1. **Claude plays a pattern** — Calls `play_pattern` with Strudel code
2. **Claude announces** — Calls `dj_speak` with DJ commentary
3. **Claude waits** — Calls `wait(30-90)` to let the music play
4. **Claude checks requests** — The wait tool returns any pending audience requests
5. **Claude adapts** — Creates the next pattern based on requests, mood, flow
6. **Repeat**

### Audience requests

Users can type requests in the browser UI:

- "something funky"
- "chill lo-fi beats"
- "90s techno"
- "more cowbell"

Claude will acknowledge and incorporate requests into the next patterns.

## MCP Tools (9 total)

| Tool | Description |
|------|-------------|
| `start_session` | Starts HTTP server and opens browser with Strudel REPL |
| `play_pattern` | Sends Strudel code to browser for evaluation |
| `stop_music` | Stops the current pattern |
| `get_session_state` | Returns browser state (started, activeCode, error, cps) |
| `set_tempo` | Sets BPM or CPS |
| `dj_speak` | macOS text-to-speech announcement (fire-and-forget) |
| `check_requests` | Drains user request queue from browser UI |
| `wait` | Blocks N seconds, then returns pending requests (core DJ loop tool) |
| `get_available_sounds` | Returns curated sound list by category |

## Strudel Examples

### Basic beat

```javascript
s("bd sd:1 hh sd:2").gain(0.8)
```

### Layered pattern

```javascript
stack(
  s("bd:1 ~ bd:1 ~").gain(0.9),
  s("~ sd ~ sd:3").gain(0.7),
  s("hh*8").gain(0.4),
  note("c2 ~ e2 ~ g2 ~ e2 ~").sound("bass1").gain(0.6)
)
```

### Lo-fi chill

```javascript
stack(
  s("bd ~ [~ bd] ~, ~ sd ~ sd").gain(0.7),
  note("<c3 e3 g3 b3>/4").sound("piano").room(0.7).gain(0.3),
  s("hh*4").gain(0.2).pan(sine)
).lpf(2000)
```

### Techno

```javascript
stack(
  s("bd*4").gain(0.9),
  s("~ hh:2 ~ hh:3").gain(0.5),
  s("~ ~ cp ~").room(0.5).gain(0.6),
  note("c2 c2 [c2 c3] c2").sound("sawtooth").lpf(400).gain(0.5)
)
```

## Available Sounds

- **Drums**: bd, sd, hh, oh, cp, rm, cb, lt, mt, ht, cr, rd, perc, tabla
- **Synths**: sine, square, sawtooth, triangle, supersaw, supersquare
- **Instruments**: piano, bass1, bass2, gtr, flute, jazz, metal, east, pluck, casio
- **Effects**: .lpf() .hpf() .delay() .room() .gain() .pan() .crush() .vowel() .phaser() .speed()

Use `get_available_sounds` tool for the full categorized list with examples.

## Mini-Notation Reference

- `*N` — repeat N times per cycle
- `/N` — spread over N cycles (slow down)
- `~` — rest / silence
- `<a b c>` — alternate each cycle
- `[a b]` — group into one step
- `?` — random chance of playing
- `,` — play in parallel

## Development

```bash
# Install dependencies
npm install

# Development mode (with hot reload)
npm run dev

# Build
npm run build

# Run manually (stdio mode)
node dist/index.js
```

## File Structure

```
claude-dj-mcp/
├── src/
│   ├── index.ts          # MCP server entry: tool registrations, main()
│   ├── http-server.ts    # HTTP server, state stores, endpoints
│   ├── html-page.ts      # HTML template with Strudel REPL
│   ├── logger.ts         # stderr-only logger
│   ├── prompts.ts        # MCP prompt for DJ workflow
│   └── sounds.ts         # Curated Strudel sound list
├── claude-dj/
│   └── SKILL.md          # Agent skill definition
├── package.json
├── tsconfig.json
└── README.md
```

## Agent Skills Support

This project includes an [Agent Skills](https://agentskills.io/) definition at `claude-dj/SKILL.md`. Compatible agents can discover and use the `claude-dj` skill automatically.

## License

AGPL-3.0

## Credits

- [Strudel](https://strudel.cc/) — The live coding environment for algorithmic patterns
- Built with [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
