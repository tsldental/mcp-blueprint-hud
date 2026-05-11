# Blueprint HUD — Continuation Handoff

If this chat gets disconnected, send this file back to Copilot and say:

> Continue building Blueprint HUD from this handoff file.

## What this project is

Blueprint HUD is the first wedge of the "Living Blueprint" idea:

- **Current wedge:** intent-to-impact mapping
- **Current form:** local web dashboard with side-panel-style UX
- **Future form:** VS Code / Cursor side panel extension backed by the same analysis engine

It helps a developer describe a change in plain English and immediately see:

- likely files affected
- runtime surfaces to verify
- explicit risk signals
- a suggested execution order

## Current status

- The repo is a clean public-facing copy of the AgentXRay prototype.
- The dashboard already has an **Intent Workbench** in the right panel.
- The backend exposes `POST /__api/impact`.
- The analysis engine lives in `impact-engine.js`.
- The UI lives in `public/index.html`, `public/app.js`, and `public/style.css`.
- The proxy and existing auth/traffic features still work as the foundation.

## Important files

- `server.js` — Express proxy server and `/__api/impact` endpoint
- `impact-engine.js` — repo scan + heuristic impact analysis
- `auth-tracker.js` — auth flow state tracking
- `public/index.html` — dashboard structure
- `public/app.js` — traffic UI + intent workbench behavior
- `public/style.css` — dashboard styling
- `README.md` — public product framing and quick start

## Known gaps

1. This is **not yet** a true VS Code or Cursor extension.
2. The impact engine is heuristic and should get smarter with:
   - import graph weighting
   - route-to-file correlation
   - runtime evidence from real traffic
   - confidence tuning to reduce noisy matches
3. README still describes the current web dashboard more than the future editor extension.

## Best next steps

1. Create a **VS Code extension webview** that hosts the Intent Workbench UI.
2. Move the impact engine behind an MCP-friendly interface or extension-local service.
3. Improve ranking so auth changes surface `auth-tracker.js` and server routes even more reliably.
4. Add saved analysis history and clickable navigation into affected files.
5. Add test coverage for `impact-engine.js`.

## Suggested prompt to resume work

> Continue Blueprint HUD. Start by turning the current Intent Workbench into a real VS Code side panel extension without losing the existing dashboard prototype.
