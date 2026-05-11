const path = require('path');
const vscode = require('vscode');
const { analyzeImpact, buildProjectGraph } = require('./impact-engine');
const { loadProjectGraph, loadRuntimeSignals, writeProjectGraph } = require('./graph-store');

let refreshTimer = null;

class BlueprintHudViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = null;
    this.lastAnalysis = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const { webview } = webviewView;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          this.postWorkspaceContext();
          break;
        case 'analyze':
          await this.handleAnalyze(message.intent);
          break;
        case 'openFile':
          await this.handleOpenFile(message.filePath);
          break;
        case 'copyGuardrails':
          await this.handleCopyGuardrails(message.text);
          break;
        case 'copyHandoff':
          await this.handleCopyHandoff(message.text);
          break;
        case 'openHandoff':
          await this.handleOpenHandoff(message.text);
          break;
        case 'openDashboard':
          await vscode.env.openExternal(vscode.Uri.parse('http://localhost:3000/__inspector'));
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.postWorkspaceContext();
    });
  }

  async handleAnalyze(intent) {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
      this.postMessage({
        type: 'impactResult',
        data: buildEmptyResult(intent || ''),
      });
      return;
    }

    const graphState = ensureWorkspaceGraph(workspaceFolder.uri.fsPath);
    const runtimeSignals = loadRuntimeSignals(workspaceFolder.uri.fsPath);

    const result = analyzeImpact({
      intent,
      repoRoot: workspaceFolder.uri.fsPath,
      projectGraph: graphState.graph,
      trafficLog: runtimeSignals.entries,
      target: workspaceFolder.name,
      cacheStatus: {
        source: graphState.fromCache ? 'persisted-cache' : 'fresh-scan',
        updatedAt: graphState.cacheUpdatedAt || null,
      },
    });

    result.meta = {
      ...result.meta,
      workspaceName: workspaceFolder.name,
      workspacePath: workspaceFolder.uri.fsPath,
      runtimeLogUpdatedAt: runtimeSignals.updatedAt,
      runtimeEntries: runtimeSignals.entries.length,
    };

    this.lastAnalysis = result;
    this.postMessage({ type: 'impactResult', data: result });
  }

  async handleOpenFile(filePath) {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder || !filePath) return;

    const targetUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, filePath));
    try {
      const document = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`Blueprint HUD could not open ${filePath}: ${error.message}`);
    }
  }

  async handleCopyGuardrails(text) {
    if (!text) return;
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage('Blueprint HUD guardrails copied', 2500);
  }

  async handleCopyHandoff(text) {
    if (!text) return;
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage('Blueprint HUD AI handoff copied', 2500);
  }

  async handleOpenHandoff(text) {
    if (!text) return;
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: text,
    });
    await vscode.window.showTextDocument(document, { preview: false });
  }

  postWorkspaceContext() {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    const graphState = workspaceFolder ? loadProjectGraph(workspaceFolder.uri.fsPath) : null;
    const runtimeSignals = workspaceFolder
      ? loadRuntimeSignals(workspaceFolder.uri.fsPath)
      : { updatedAt: null, entries: [] };

    this.postMessage({
      type: 'workspaceContext',
      data: workspaceFolder
        ? {
            name: workspaceFolder.name,
            path: workspaceFolder.uri.fsPath,
            graphUpdatedAt: graphState?.cacheUpdatedAt || null,
            runtimeEntries: runtimeSignals.entries.length,
          }
        : null,
    });
  }

  postMessage(message) {
    if (this.view) this.view.webview.postMessage(message);
  }

  getLastHandoffMarkdown() {
    return this.lastAnalysis?.handoff?.markdown || '';
  }

  getHtml(webview) {
    const nonce = getNonce();
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'blueprint-hud-icon.svg'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blueprint HUD</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-sideBar-background);
      --surface: var(--vscode-editorWidget-background, #161b22);
      --surface2: var(--vscode-input-background, #0d1117);
      --border: var(--vscode-panel-border, #30363d);
      --text: var(--vscode-foreground, #e6edf3);
      --muted: var(--vscode-descriptionForeground, #8b949e);
      --blue: #58a6ff;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
      --purple: #bc8cff;
      --radius: 10px;
      --font-ui: var(--vscode-font-family);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-ui);
      background: var(--bg);
      color: var(--text);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .hero, .section, .card, .risk, .guardrail-box {
      border: 1px solid var(--border);
      background: var(--surface);
      border-radius: var(--radius);
    }
    .hero, .section {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .hero-top, .row-between, .card-top, .risk-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .hero-top { justify-content: flex-start; }
    .hero-top img { width: 18px; height: 18px; }
    .title { font-size: 14px; font-weight: 700; }
    .muted, .small {
      color: var(--muted);
      line-height: 1.45;
    }
    .small { font-size: 11px; }
    .workspace {
      font-size: 11px;
      line-height: 1.4;
      word-break: break-word;
    }
    textarea {
      width: 100%;
      min-height: 80px;
      resize: vertical;
      background: var(--surface2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      font: inherit;
      line-height: 1.5;
    }
    button {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface2);
      color: var(--text);
      font: inherit;
      cursor: pointer;
      padding: 8px 10px;
    }
    button.primary {
      background: var(--blue);
      color: #08111d;
      border-color: var(--blue);
      font-weight: 700;
    }
    button.link {
      text-align: left;
      padding: 0;
      background: transparent;
      border: none;
      color: var(--blue);
    }
    .example-row, .meta-row, .badge-row, .action-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .chip {
      font-size: 11px;
      border-radius: 999px;
      padding: 4px 8px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 700;
    }
    .badge-muted { background: #2d333b; color: var(--muted); }
    .badge-blue { background: rgba(88,166,255,.18); color: var(--blue); }
    .badge-green { background: rgba(63,185,80,.18); color: var(--green); }
    .badge-yellow { background: rgba(210,153,34,.18); color: var(--yellow); }
    .badge-red { background: rgba(248,81,73,.18); color: var(--red); }
    .badge-purple { background: rgba(188,140,255,.18); color: var(--purple); }
    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: var(--muted);
      font-weight: 700;
    }
    .card, .risk, .guardrail-box {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .card-title {
      font-weight: 700;
      word-break: break-word;
    }
    .card-subtitle {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.45;
    }
    .heat-brittle {
      border-color: rgba(248,81,73,.48);
      background: linear-gradient(180deg, rgba(248,81,73,.08), rgba(22,27,34,1));
    }
    .heat-affected {
      border-color: rgba(210,153,34,.48);
      background: linear-gradient(180deg, rgba(210,153,34,.07), rgba(22,27,34,1));
    }
    .heat-watch {
      border-color: rgba(88,166,255,.38);
      background: linear-gradient(180deg, rgba(88,166,255,.06), rgba(22,27,34,1));
    }
    .guardrail-box pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      line-height: 1.55;
      color: var(--text);
    }
    ol {
      margin: 0 0 0 18px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .empty {
      border: 1px dashed var(--border);
      border-radius: 8px;
      padding: 10px;
      color: var(--muted);
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="hero">
    <div class="hero-top">
      <img src="${iconUri}" alt="" />
      <div class="title">Blueprint HUD</div>
      <span id="confidence" class="badge badge-muted">No analysis</span>
    </div>
    <div class="muted">Describe a change in plain English and see likely ripple effects, runtime pressure, prompt guardrails, and an AI-ready handoff brief for the current workspace.</div>
    <div id="workspace" class="workspace muted">No workspace open.</div>
    <textarea id="intent" placeholder="Add a premium subscription tier to checkout"></textarea>
    <div class="example-row">
      <button class="chip" data-intent="Add a login requirement to the dashboard">Login on dashboard</button>
      <button class="chip" data-intent="The data feels laggy when I scroll">Laggy scrolling</button>
      <button class="chip" data-intent="Tighten auth around the MCP inspector APIs">Tighten auth</button>
    </div>
    <div class="example-row">
      <button id="analyze" class="primary">Analyze impact</button>
      <button id="openDashboard">Open local dashboard</button>
    </div>
  </div>

  <div id="results" class="empty">Run an analysis to generate brittle surfaces, affected files, prompt guardrails, and an execution plan.</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const resultsEl = document.getElementById('results');
    const workspaceEl = document.getElementById('workspace');
    const intentEl = document.getElementById('intent');
    const confidenceEl = document.getElementById('confidence');

    document.getElementById('analyze').addEventListener('click', () => analyze());
    document.getElementById('openDashboard').addEventListener('click', () => vscode.postMessage({ type: 'openDashboard' }));
    intentEl.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        analyze();
      }
    });
    document.querySelectorAll('[data-intent]').forEach((button) => {
      button.addEventListener('click', () => {
        intentEl.value = button.dataset.intent;
        analyze();
      });
    });

    window.addEventListener('message', (event) => {
      const { type, data } = event.data;
      if (type === 'workspaceContext') renderWorkspace(data);
      if (type === 'impactResult') renderResult(data);
    });

    resultsEl.addEventListener('click', (event) => {
      const fileTrigger = event.target.closest('[data-open-file]');
      if (fileTrigger) {
        vscode.postMessage({ type: 'openFile', filePath: fileTrigger.dataset.openFile });
        return;
      }

      const guardrailTrigger = event.target.closest('[data-copy-guardrails]');
      if (guardrailTrigger) {
        vscode.postMessage({ type: 'copyGuardrails', text: guardrailTrigger.dataset.copyGuardrails });
        return;
      }

      const handoffCopyTrigger = event.target.closest('[data-copy-handoff]');
      if (handoffCopyTrigger) {
        vscode.postMessage({ type: 'copyHandoff', text: handoffCopyTrigger.dataset.copyHandoff });
        return;
      }

      const handoffOpenTrigger = event.target.closest('[data-open-handoff]');
      if (handoffOpenTrigger) {
        vscode.postMessage({ type: 'openHandoff', text: handoffOpenTrigger.dataset.openHandoff });
      }
    });

    function analyze() {
      confidenceEl.textContent = 'Analyzing…';
      confidenceEl.className = 'badge badge-yellow';
      vscode.postMessage({ type: 'analyze', intent: intentEl.value.trim() });
    }

    function renderWorkspace(data) {
      workspaceEl.textContent = data
        ? 'Workspace: ' + data.name + ' — ' + data.path + (data.graphUpdatedAt ? ' | map updated ' + new Date(data.graphUpdatedAt).toLocaleTimeString() : '') + (data.runtimeEntries ? ' | runtime events ' + data.runtimeEntries : '')
        : 'No workspace open.';
    }

    function renderResult(result) {
      const confidence = result.summary?.confidence || 'None';
      confidenceEl.textContent = confidence + ' confidence';
      confidenceEl.className = 'badge ' + badgeClass(confidence);

      const brittle = [...(result.impacts?.highConfidence || []), ...(result.runtime?.highConfidence || [])];
      const affected = [...(result.impacts?.possibleImpact || []), ...(result.runtime?.possibleImpact || [])];
      const watch = [...(result.impacts?.unknowns || []), ...(result.runtime?.unknowns || [])];

      const sections = [];
      sections.push('<div class="hero"><div class="title">' + escapeHtml(result.summary?.headline || 'Impact analysis') + '</div><div class="muted">' + escapeHtml(result.summary?.narrative || '') + '</div>' + renderMeta(result.meta) + '</div>');
      sections.push(renderConcerns(result.concerns || []));
      sections.push(renderHeatSection('Brittle surfaces', brittle, 'brittle'));
      sections.push(renderHeatSection('Affected surfaces', affected, 'affected'));
      sections.push(renderHeatSection('Watchlist', watch, 'watch'));
      sections.push(renderGuardrails(result.guardrails));
      sections.push(renderHandoff(result.handoff));
      sections.push(renderRisks(result.risks || []));
      sections.push(renderPlan(result.plan || []));

      resultsEl.className = '';
      resultsEl.innerHTML = sections.join('');
    }

    function renderMeta(meta) {
      if (!meta) return '';
      const pieces = [
        meta.workspaceName ? escapeHtml(meta.workspaceName) : null,
        meta.indexedFiles !== undefined ? escapeHtml(String(meta.indexedFiles)) + ' files indexed' : null,
        meta.indexedRuntimeSurfaces !== undefined ? escapeHtml(String(meta.indexedRuntimeSurfaces)) + ' runtime nodes' : null,
        meta.runtimeEntries !== undefined ? escapeHtml(String(meta.runtimeEntries)) + ' runtime events' : null,
        meta.cacheSource ? escapeHtml(meta.cacheSource) : null
      ].filter(Boolean);
      return pieces.length ? '<div class="meta-row small">' + pieces.map(piece => '<span>' + piece + '</span>').join('') + '</div>' : '';
    }

    function renderConcerns(concerns) {
      return '<div class="section"><div class="section-title">Detected concerns</div>' +
        (concerns.length
          ? '<div class="badge-row">' + concerns.map(concern => '<span class="badge badge-purple">' + escapeHtml(concern.label) + '</span>').join('') + '</div>'
          : '<div class="small">No dominant concern detected yet.</div>') +
        '</div>';
    }

    function renderHeatSection(title, items, heat) {
      return '<div class="section"><div class="section-title">' + escapeHtml(title) + '</div>' +
        (items.length
          ? items.map(item => '<div class="card heat-' + escapeHtml(item.zone || heat) + '"><div class="card-top"><div class="card-title">' + renderSurfaceLink(item.title, item.type) + '</div><span class="badge ' + scoreBadgeClass(item.score || 0) + '">' + escapeHtml(String(item.score || 0)) + '</span></div><div class="card-subtitle">' + escapeHtml(item.subtitle || item.type || '') + '</div><div>' + escapeHtml(item.reason || '') + '</div>' + renderDetail(item.details) + '</div>').join('')
          : '<div class="empty">No strong signal yet.</div>') +
        '</div>';
    }

    function renderSurfaceLink(title, type) {
      if (type !== 'file') return escapeHtml(title);
      return '<button class="link" data-open-file="' + escapeHtml(title) + '">' + escapeHtml(title) + '</button>';
    }

    function renderDetail(details) {
      return details && details.length ? '<div class="card-subtitle">' + escapeHtml(details[0]) + '</div>' : '';
    }

    function renderGuardrails(guardrails) {
      if (!guardrails?.promptBlock) {
        return '<div class="section"><div class="section-title">Prompt guardrails</div><div class="empty">No explicit guardrail block yet.</div></div>';
      }

      return '<div class="section"><div class="row-between"><div class="section-title">Prompt guardrails</div><button data-copy-guardrails="' + escapeHtml(guardrails.promptBlock) + '">Copy guardrails</button></div><div class="guardrail-box"><pre>' + escapeHtml(guardrails.promptBlock) + '</pre></div></div>';
    }

    function renderHandoff(handoff) {
      if (!handoff?.markdown) {
        return '<div class="section"><div class="section-title">AI handoff</div><div class="empty">Run an analysis to generate a ready-to-use handoff brief.</div></div>';
      }

      return '<div class="section"><div class="row-between"><div class="section-title">AI handoff</div><div class="action-row"><button data-open-handoff="' + escapeHtml(handoff.markdown) + '">Open handoff draft</button><button data-copy-handoff="' + escapeHtml(handoff.text || handoff.markdown) + '">Copy handoff</button></div></div><div class="guardrail-box"><pre>' + escapeHtml(handoff.markdown) + '</pre></div></div>';
    }

    function renderRisks(risks) {
      return '<div class="section"><div class="section-title">Risk signals</div>' +
        (risks.length
          ? risks.map(risk => '<div class="risk"><div class="risk-top"><strong>' + escapeHtml(risk.title) + '</strong><span class="badge ' + riskBadgeClass(risk.level) + '">' + escapeHtml(risk.level) + '</span></div><div class="small">' + escapeHtml(risk.detail) + '</div></div>').join('')
          : '<div class="empty">No explicit risk detected yet.</div>') +
        '</div>';
    }

    function renderPlan(plan) {
      return '<div class="section"><div class="section-title">Suggested execution order</div>' +
        (plan.length ? '<ol>' + plan.map(step => '<li>' + escapeHtml(step) + '</li>').join('') + '</ol>' : '<div class="empty">No ordered plan yet.</div>') +
        '</div>';
    }

    function badgeClass(confidence) {
      if (confidence === 'High') return 'badge-green';
      if (confidence === 'Medium') return 'badge-blue';
      if (confidence === 'Low') return 'badge-yellow';
      return 'badge-muted';
    }

    function scoreBadgeClass(score) {
      if (score >= 70) return 'badge-red';
      if (score >= 50) return 'badge-yellow';
      if (score >= 34) return 'badge-blue';
      return 'badge-muted';
    }

    function riskBadgeClass(level) {
      if (level === 'High') return 'badge-red';
      if (level === 'Medium') return 'badge-yellow';
      if (level === 'Needs verification') return 'badge-purple';
      return 'badge-muted';
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new BlueprintHudViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('blueprintHud.sidebar', provider),
    vscode.commands.registerCommand('blueprintHud.focus', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.blueprintHud');
    }),
    vscode.commands.registerCommand('blueprintHud.openHandoffDraft', async () => {
      const markdown = provider.getLastHandoffMarkdown();
      if (!markdown) {
        vscode.window.showInformationMessage('Run a Blueprint HUD analysis first to generate an AI handoff.');
        return;
      }
      await provider.handleOpenHandoff(markdown);
    }),
    vscode.commands.registerCommand('blueprintHud.copyHandoff', async () => {
      const markdown = provider.getLastHandoffMarkdown();
      if (!markdown) {
        vscode.window.showInformationMessage('Run a Blueprint HUD analysis first to generate an AI handoff.');
        return;
      }
      await provider.handleCopyHandoff(markdown);
    }),
    vscode.commands.registerCommand('blueprintHud.openDashboard', async () => {
      await vscode.env.openExternal(vscode.Uri.parse('http://localhost:3000/__inspector'));
    }),
    vscode.workspace.onDidSaveTextDocument(() => scheduleWorkspaceGraphRefresh(provider)),
    vscode.workspace.onDidCreateFiles(() => scheduleWorkspaceGraphRefresh(provider)),
    vscode.workspace.onDidDeleteFiles(() => scheduleWorkspaceGraphRefresh(provider)),
    vscode.workspace.onDidRenameFiles(() => scheduleWorkspaceGraphRefresh(provider)),
  );

  scheduleWorkspaceGraphRefresh(provider);
}

function deactivate() {}

function ensureWorkspaceGraph(repoRoot) {
  const cached = loadProjectGraph(repoRoot);
  if (cached?.graph) {
    return {
      graph: cached.graph,
      cacheUpdatedAt: cached.cacheUpdatedAt,
      fromCache: true,
    };
  }

  const graph = buildProjectGraph(repoRoot);
  const persisted = writeProjectGraph(repoRoot, graph);
  return {
    graph,
    cacheUpdatedAt: persisted.updatedAt,
    fromCache: false,
  };
}

function refreshWorkspaceGraphs(provider) {
  for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
    try {
      const graph = buildProjectGraph(workspaceFolder.uri.fsPath);
      writeProjectGraph(workspaceFolder.uri.fsPath, graph);
    } catch (error) {
      console.error(`Blueprint HUD failed to refresh graph for ${workspaceFolder.uri.fsPath}:`, error);
    }
  }

  if (provider) provider.postWorkspaceContext();
}

function scheduleWorkspaceGraphRefresh(provider) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshWorkspaceGraphs(provider), 600);
}

function buildEmptyResult(intent) {
  return {
    intent,
    summary: {
      headline: 'Open a folder or workspace first.',
      narrative: 'Blueprint HUD analyzes the currently opened codebase. Once a workspace is open, describe the change you want to make.',
      confidence: 'None',
      confidenceScore: 0,
    },
    concerns: [],
    impacts: { highConfidence: [], possibleImpact: [], unknowns: [] },
    runtime: { highConfidence: [], possibleImpact: [], unknowns: [] },
    risks: [],
    plan: [],
    guardrails: { bullets: [], promptBlock: '' },
    handoff: { markdown: '', text: '' },
    meta: { indexedFiles: 0, observedRequests: 0, observedRoutes: 0, observedRpcMethods: 0 },
  };
}

function getPrimaryWorkspaceFolder() {
  const [workspaceFolder] = vscode.workspace.workspaceFolders || [];
  return workspaceFolder;
}

function getNonce() {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) value += possible.charAt(Math.floor(Math.random() * possible.length));
  return value;
}

module.exports = {
  activate,
  deactivate,
};
