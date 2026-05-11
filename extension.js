const path = require('path');
const vscode = require('vscode');
const { analyzeImpact } = require('./impact-engine');

class BlueprintHudViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = null;
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
        data: {
          intent: intent || '',
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
          meta: { indexedFiles: 0, observedRequests: 0, observedRoutes: 0, observedRpcMethods: 0 },
        },
      });
      return;
    }

    const result = analyzeImpact({
      intent,
      repoRoot: workspaceFolder.uri.fsPath,
      trafficLog: [],
      target: workspaceFolder.name,
    });

    result.meta = {
      ...result.meta,
      workspaceName: workspaceFolder.name,
      workspacePath: workspaceFolder.uri.fsPath,
    };

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

  postWorkspaceContext() {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    this.postMessage({
      type: 'workspaceContext',
      data: workspaceFolder
        ? { name: workspaceFolder.name, path: workspaceFolder.uri.fsPath }
        : null,
    });
  }

  postMessage(message) {
    if (this.view) this.view.webview.postMessage(message);
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
    .hero, .section, .card, .risk {
      border: 1px solid var(--border);
      background: var(--surface);
      border-radius: var(--radius);
    }
    .hero {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .hero-top {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .hero-top img { width: 18px; height: 18px; }
    .title { font-size: 14px; font-weight: 700; }
    .muted { color: var(--muted); }
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
    .example-row, .meta-row, .badge-row {
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
    .section {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: var(--muted);
      font-weight: 700;
    }
    .card, .risk {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .card-top, .risk-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .card-title {
      font-weight: 700;
      word-break: break-word;
    }
    .card-subtitle, .small {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.45;
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
    <div class="muted">Describe a change in plain English and see likely ripple effects in the current workspace.</div>
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

  <div id="results" class="empty">Run an analysis to generate likely file impact, runtime verification points, and an execution plan.</div>

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
      const trigger = event.target.closest('[data-open-file]');
      if (!trigger) return;
      vscode.postMessage({ type: 'openFile', filePath: trigger.dataset.openFile });
    });

    function analyze() {
      confidenceEl.textContent = 'Analyzing…';
      confidenceEl.className = 'badge badge-yellow';
      vscode.postMessage({ type: 'analyze', intent: intentEl.value.trim() });
    }

    function renderWorkspace(data) {
      workspaceEl.textContent = data
        ? 'Workspace: ' + data.name + ' — ' + data.path
        : 'No workspace open.';
    }

    function renderResult(result) {
      const confidence = result.summary?.confidence || 'None';
      confidenceEl.textContent = confidence + ' confidence';
      confidenceEl.className = 'badge ' + badgeClass(confidence);

      const sections = [];
      sections.push('<div class="hero"><div class="title">' + escapeHtml(result.summary?.headline || 'Impact analysis') + '</div><div class="muted">' + escapeHtml(result.summary?.narrative || '') + '</div>' + renderMeta(result.meta) + '</div>');
      sections.push(renderConcerns(result.concerns || []));
      sections.push(renderCards('High-confidence files', result.impacts?.highConfidence || []));
      sections.push(renderCards('Possible ripple', result.impacts?.possibleImpact || []));
      sections.push(renderCards('Runtime surfaces', result.runtime?.highConfidence?.length ? result.runtime.highConfidence : result.runtime?.possibleImpact || []));
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
        meta.observedRequests !== undefined ? escapeHtml(String(meta.observedRequests)) + ' requests observed' : null
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

    function renderCards(title, items) {
      return '<div class="section"><div class="section-title">' + escapeHtml(title) + '</div>' +
        (items.length
          ? items.map(item => '<div class="card"><div class="card-top"><div class="card-title">' + renderFileLink(item.title, item.type) + '</div><span class="badge ' + scoreBadgeClass(item.score || 0) + '">' + escapeHtml(String(item.score || 0)) + '</span></div><div class="card-subtitle">' + escapeHtml(item.subtitle || item.type || '') + '</div><div>' + escapeHtml(item.reason || '') + '</div>' + renderDetail(item.details) + '</div>').join('')
          : '<div class="empty">No strong signal yet.</div>') +
        '</div>';
    }

    function renderFileLink(title, type) {
      if (type !== 'file') return escapeHtml(title);
      return '<button class="link" data-open-file="' + escapeHtml(title) + '">' + escapeHtml(title) + '</button>';
    }

    function renderDetail(details) {
      return details && details.length ? '<div class="card-subtitle">' + escapeHtml(details[0]) + '</div>' : '';
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
      if (score >= 70) return 'badge-green';
      if (score >= 50) return 'badge-blue';
      if (score >= 34) return 'badge-yellow';
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
    vscode.commands.registerCommand('blueprintHud.openDashboard', async () => {
      await vscode.env.openExternal(vscode.Uri.parse('http://localhost:3000/__inspector'));
    }),
  );
}

function deactivate() {}

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
