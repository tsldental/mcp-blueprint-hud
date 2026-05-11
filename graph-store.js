const fs = require('fs');
const path = require('path');

const CACHE_DIRECTORY = '.blueprint-hud';
const GRAPH_CACHE_FILE = 'graph-cache.json';
const RUNTIME_SIGNALS_FILE = 'runtime-signals.json';
const GRAPH_CACHE_VERSION = 1;
const RUNTIME_SIGNAL_LIMIT = 300;

function ensureCacheDirectory(repoRoot) {
  const cacheDirectory = path.join(repoRoot, CACHE_DIRECTORY);
  if (!fs.existsSync(cacheDirectory)) fs.mkdirSync(cacheDirectory, { recursive: true });
  return cacheDirectory;
}

function getGraphCachePath(repoRoot) {
  return path.join(ensureCacheDirectory(repoRoot), GRAPH_CACHE_FILE);
}

function getRuntimeSignalsPath(repoRoot) {
  return path.join(ensureCacheDirectory(repoRoot), RUNTIME_SIGNALS_FILE);
}

function writeProjectGraph(repoRoot, graph) {
  const payload = {
    version: GRAPH_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    graph: serializeGraph(graph),
  };

  fs.writeFileSync(getGraphCachePath(repoRoot), JSON.stringify(payload, null, 2));
  return payload;
}

function loadProjectGraph(repoRoot) {
  const filePath = getGraphCachePath(repoRoot);
  if (!fs.existsSync(filePath)) return null;

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!payload?.graph) return null;

    return {
      version: payload.version || GRAPH_CACHE_VERSION,
      cacheUpdatedAt: payload.updatedAt || null,
      graph: deserializeGraph(payload.graph),
    };
  } catch {
    return null;
  }
}

function recordRuntimeSignal(repoRoot, entry) {
  const filePath = getRuntimeSignalsPath(repoRoot);
  const payload = loadRuntimeSignals(repoRoot);
  const nextEntries = [sanitizeRuntimeEntry(entry), ...payload.entries].slice(0, RUNTIME_SIGNAL_LIMIT);
  const nextPayload = {
    version: GRAPH_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    entries: nextEntries,
  };

  fs.writeFileSync(filePath, JSON.stringify(nextPayload, null, 2));
  return nextPayload;
}

function loadRuntimeSignals(repoRoot) {
  const filePath = getRuntimeSignalsPath(repoRoot);
  if (!fs.existsSync(filePath)) {
    return {
      version: GRAPH_CACHE_VERSION,
      updatedAt: null,
      entries: [],
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      version: payload.version || GRAPH_CACHE_VERSION,
      updatedAt: payload.updatedAt || null,
      entries: Array.isArray(payload.entries) ? payload.entries : [],
    };
  } catch {
    return {
      version: GRAPH_CACHE_VERSION,
      updatedAt: null,
      entries: [],
    };
  }
}

function serializeGraph(graph) {
  return {
    ...graph,
    links: graph.links instanceof Map
      ? Object.fromEntries(graph.links.entries())
      : (graph.links || {}),
  };
}

function deserializeGraph(graph) {
  return {
    ...graph,
    links: new Map(Object.entries(graph.links || {})),
  };
}

function sanitizeRuntimeEntry(entry) {
  return {
    ts: entry.ts || Date.now(),
    path: entry.path || null,
    statusCode: entry.statusCode ?? null,
    rpcMethod: entry.rpcMethod || null,
    direction: entry.direction || null,
    hasToken: Boolean(entry.hasToken),
    isSSE: Boolean(entry.isSSE),
    streaming: Boolean(entry.streaming),
    error: entry.error || null,
    method: entry.method || null,
  };
}

module.exports = {
  getGraphCachePath,
  getRuntimeSignalsPath,
  loadProjectGraph,
  loadRuntimeSignals,
  recordRuntimeSignal,
  writeProjectGraph,
};
