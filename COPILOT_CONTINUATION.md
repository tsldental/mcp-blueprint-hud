# Blueprint HUD — Continuation Handoff

If this chat gets disconnected, send this file back to Copilot and say:

> Continue building Blueprint HUD from this handoff file.

## What this project is

**Repository:** https://github.com/tsldental/mcp-blueprint-hud

Blueprint HUD is the first wedge of the "Living Blueprint" idea:

- **Current wedge:** intent-to-impact mapping
- **Current form:** VS Code side panel extension plus local web dashboard prototype
- **Next target:** broaden from VS Code to Cursor/Copilot-compatible surfaces backed by the same analysis engine

It helps a developer describe a change in plain English and immediately see:

- likely files affected
- runtime surfaces to verify
- explicit risk signals
- a suggested execution order

## Current status

- The repo is a clean public-facing copy of the AgentXRay prototype.
- The dashboard already has an **Intent Workbench** in the right panel.
- The repo now also has a **real VS Code activity-bar side panel extension** powered by `extension.js`.
- The extension now persists a local workspace map in `.blueprint-hud/graph-cache.json`.
- The dashboard/runtime layer now records runtime overlays in `.blueprint-hud/runtime-signals.json`.
- The extension now produces a copyable **Prompt Guardrails** block.
- The extension now also produces a full **AI handoff brief** and can open it in a markdown tab or copy it to the clipboard.
- The analyzer now uses **AST-based extraction for JS/TS-family files** instead of relying only on regex matching.
- The extension now also contributes a native VS Code chat participant: **`@blueprint`**.
- The backend exposes `POST /__api/impact`.
- The analysis engine lives in `impact-engine.js`.
- Local graph and runtime persistence live in `graph-store.js`.
- The UI lives in `public/index.html`, `public/app.js`, and `public/style.css`.
- The proxy and existing auth/traffic features still work as the foundation.

## Important files

- `server.js` — Express proxy server and `/__api/impact` endpoint
- `extension.js` — VS Code sidebar webview provider and workspace analysis wiring
- `extension.js` — VS Code sidebar provider plus the `@blueprint` chat participant
- `impact-engine.js` — repo scan + heuristic impact analysis
- `impact-engine.js` — repo scan with AST-based JS/TS extraction plus higher-level impact analysis
- `graph-store.js` — persisted project graph and runtime signal storage
- `auth-tracker.js` — auth flow state tracking
- `public/index.html` — dashboard structure
- `public/app.js` — traffic UI + intent workbench behavior
- `public/style.css` — dashboard styling
- `README.md` — public product framing and quick start

## Known gaps

1. This is now a **true VS Code extension**, but not yet a Cursor or Copilot editor integration.
2. The impact engine is heuristic and should get smarter with:
   - import graph weighting
   - route-to-file correlation
   - runtime evidence from real traffic
   - confidence tuning to reduce noisy matches
   - broader AST support beyond the current JS/TS-family focus
3. The extension currently analyzes the **first workspace folder** and does not yet model multi-root workspaces.
4. Runtime overlays are only as strong as the local signal file; most repos will start with structure-first analysis until more runtime data is available.
5. Blueprint HUD injects directly into its own VS Code chat participant, but not yet into every Copilot/Cursor chat surface automatically.

## Best next steps

1. Extend the current `@blueprint` participant into more Copilot/Cursor-style chat surfaces where direct injection is supported.
2. Improve ranking so auth changes surface `auth-tracker.js` and server routes even more reliably.
3. Add saved analysis history, diff-aware updates, and richer navigation into affected files.
4. Let runtime overlays ingest telemetry beyond the local proxy log.
5. Add test coverage for `impact-engine.js`, `graph-store.js`, and the chat participant flow.

## Suggested prompt to resume work

> Continue Blueprint HUD. The VS Code side panel exists now. Next, improve impact accuracy and make the same workbench usable in Cursor or Copilot-style editor surfaces.
