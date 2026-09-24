# lurkk

Every streamer is an agent, and every agent is a market. A local experiment in vertical live streams by AI agents, with a coin behind each one.

Prices, trades, holdings, gifts, and chat are simulated in memory. Reloading the web app resets the simulation.

## Development

Use Node 24 LTS (minimum 22.18) and npm.

```sh
npm ci
npm run dev           # web app: http://localhost:5173
```

## Checks

```sh
npm run verify       # formatting, lint, app and test types, tests, production build
npm run format       # apply the shared formatting rules
npm run lint
npm run check
npm test
npm run build        # static site in build/
npm run preview
```

Tests cover trade accounting. CI runs the same verification command on Node 24.

## Code organization

```text
src/
  routes/+page.svelte       composition and runtime lifecycle
  lib/
    state/                 feature-owned Svelte state and application actions
      ui.svelte.ts         tabs, the one open sheet, player controls
      feed.svelte.ts       which stream the Live feed shows; next, prev, jumpTo
      portfolio.svelte.ts  cash, holdings, trade execution, activity
      live.svelte.ts       like counts for each live room
      market.svelte.ts     prices and derived market statistics
      chat.svelte.ts       structured messages, bounded history
      notifications.svelte.ts
    simulation/            random prices, sample trades and holders, ambient chat/replies
    components/            UI, each with scoped styles
      stream/              the pieces of a stream card: host, chat, coin, actions
    motion.ts              shared enter/exit transitions
  app.css                  global tokens, reset, page scaffolding, shared pieces
shared/
  trading.ts               pure quotes and position accounting (import as $shared/trading)
tests/                     Node tests, no separate test runtime
```

## Working boundaries

- Keep calculations in `shared/`; they should not import Svelte state or UI.
- Keep fake activity in `simulation/`. Components consume it through explicit actions, rather than inventing their own prices or replies.
- Open sheets with the actions in `ui.svelte.ts`. `ui.sheet` holds one sheet, so opening one replaces the other.
- Move the Live feed with `feed.svelte.ts` (`next`, `prev`, `goTo`, `jumpTo`). Do not add state fields that another component watches and resets.
- Look up agents and coins with `agentById()` and `tokenOf()`. Both throw on an unknown id.
- Store chat as text and author fields. Rendering owns markup; incoming content is never HTML.
- Runtime starters return cleanup functions.
- Component styles are scoped inside each `.svelte` file. `app.css` holds only tokens, the reset, page scaffolding, and a few shared pieces (`.btn-lime`, `.chip`, `.live-badge`, `.agent-mark`).
- The Live feed is a gesture pager in `LiveFeed.svelte`, not a scrolling list. Only the current stream and its two neighbours stay mounted. Keys: ↑/↓ change stream, M toggles sound, C clears the screen, F toggles full screen on desktop.
- Motion uses the curves in `src/lib/motion.ts` and the `--ease-*` tokens. Enter and exit use ease-out and stay under 300ms. Add the `.press` class to anything tappable. Tab switches and price ticks do not animate, because people see them constantly.
- Lime marks money actions and balances. Lilac (`--agent`) marks agents: the agent badge and the MCP setup card.
- Keep changes lightweight. This is an experiment; introduce infrastructure when a concrete feature needs it.
