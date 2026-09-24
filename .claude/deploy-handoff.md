# Handoff: deploy musestream with Openship

Goal: put musestream on a public server with Openship (MCP server `openship`, already signed in).
The app runs today only on the owner's Mac, at http://localhost:5173, with real money on
Robinhood Chain. Confirm each paid or public step with the owner before you do it.

## The app

- Repo: https://github.com/CyberVerse2/musestream (public), branch `main`, local copy at
  `/Users/thecyberverse/Code/lurkk`.
- SvelteKit with `@sveltejs/adapter-node`. Node 24.
  - Build: `npm ci && npm run build`
  - Start: `node build` (`npm start`). It listens on `PORT` (default 3000).
- Native module: `better-sqlite3`. Build it in the same image it runs in.
- The runtime also needs these binaries:
  - `ffmpeg`: stand-in video and clip handling.
  - `uv` and Python 3.12 or later: the Reactor video worker. The server spawns
    `uv run --quiet worker.py` in `video-worker/`, which uses `reactor-sdk`.
- The `Dockerfile` builds all of this into one image: Node 24, ffmpeg, uv, and the worker's
  Python environment. Deploy with build kind `dockerfile`. Openship's auto-detection reads
  `video-worker/` as a second app; it is not one, because the web server starts it.

## Code state: check before you deploy

A GitHub build gets only what is pushed. At handoff time:

- Three commits on `main` are not pushed: `62efe7d`, `d527f7e`, `bf9d3c4`.
- `src/lib/server/video/clips.ts` (clip looping for `VIDEO_CLIPS`) is not committed, and neither
  is its wiring in `src/lib/server/app.ts`.
- Many UI files have uncommitted changes from another session (components, `app.css`,
  `app.html`, gift images). That work may still be in progress.

Ask the owner what to commit and push. Push only when the owner says so.

## Persistent data

All state lives in `MUSESTREAM_DATA_DIR`. It must be a persistent volume. Losing it breaks the
link between agents and their wallets.

- Local source: `data/live/`.
  - `musestream.db` (+ `-wal`, `-shm`): SQLite. Stop the local server before you copy it, or
    run `sqlite3 musestream.db ".backup copy.db"`.
  - `media/`: stream clips, scene images, and `media/clips/love.mp4`.
  - `love-agent.json`: Love's agent API key. It is a secret. Do not upload it to the server;
    the owner keeps it.
- `data/musebook/love.json`: Love's Musebook key. It is a secret. The app does not need it.
  Keep it off the server.
- Run only one server against one database. Two servers on the same data would double-spend
  the treasury and double-settle fees.

## Environment variables

Set these as secrets in Openship. The values are in the owner's local `.env.local`. Never print
them, paste them into chat, or commit them.

Chain and money:
- `CHAIN_MODE=live`
- `CHAIN_RPC_URL`: Alchemy Robinhood Chain URL. It holds a key. Rotate it first; it showed up in
  an error log.
- `ROBINHOOD_RPC_URL`: used by the fork tests only.
- `TREASURY_DAILY_SPEND_ETH=0.05`
- Optional: `FEE_SETTLE_MINUTES`, `GAS_TOPUP_GAS`, `PREFLIGHT_MIN_TREASURY_ETH` (default 0.001).

Wallets (Dynamic, Sandbox environment by the owner's choice):
- `WALLET_PROVIDER=dynamic`
- `DYNAMIC_ENVIRONMENT_ID`, `DYNAMIC_API_TOKEN`, `DYNAMIC_WALLET_PASSWORD`
- `WALLET_ENCRYPTION_KEY`

Data:
- `MUSESTREAM_DATA_DIR`: the mounted volume path, for example `/data`.

Video and voice:
- `VIDEO_PROVIDER=reactor`, `REACTOR_API_KEY` (rotate it first)
- `REACTOR_AGENTS=love`, `REACTOR_MAX_SESSIONS=1`, `REACTOR_MAX_SECONDS=300`,
  `REACTOR_DAILY_SECONDS=1200`, `REACTOR_IDLE_SECONDS=30`
- `VIDEO_CLIPS=love=love.mp4`: Love's stream loops that clip and never starts Reactor.
- `MODEL_API_KEY`: Muse Image, for scene pictures.
- `OPENAI_API_KEY`: the agent voice (text to speech).
- `CODEX_API_KEY`: token prices.
- Not used by the app yet: `FISH_AUDIO_API_KEY`, `GEMINI_API_KEY`. Leave them out.

Server:
- `ORIGIN=https://<the public domain>`: adapter-node needs it for requests to pass its
  origin check.
- `PORT`: whatever Openship routes to.

## After the first deploy

1. Add the public origin to the Dynamic Sandbox allowed origins in the Dynamic dashboard (the
   owner does this). Without it, sign-in fails with "Failed to fetch".
2. Run `npm run preflight` against the server's environment. It checks the chain, the
   treasury balance (at least 0.001 ETH), and the wallets.
3. Open `/api/config`. Expect `chainId` 4663, `testMoney: false`, and treasury
   `0xC1Ab4c1051D8cCe97d13aF750970532a43F33A50`.
4. Open `/api/streams`. Love is live, with video `/media/clips/love.mp4`.
5. Serve `/llms.txt` and `/mcp` over the public URL. Agents register through them.

## Rules from the owner

- Real money: never send funds, and never run a paid action, without the owner's clear yes.
- The owner has little money for video. Keep Reactor limits as set.
- Dynamic stays on Sandbox. Never delete the Dynamic user that owns the server wallets. That
  would lose the treasury.
- `scripts/demo.ts` makes dummy agents. Never run it against the live app.
