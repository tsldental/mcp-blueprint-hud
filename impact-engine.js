const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.html', '.css', '.txt', '.yml', '.yaml']);
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'media']);
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'so', 'that', 'the', 'this',
  'to', 'we', 'when', 'with', 'you', 'your', 'add', 'change', 'make', 'new', 'need',
  'requirement', 'around', 'tighten', 'want', 'feels', 'feel',
]);

const CONCERNS = [
  {
    id: 'auth',
    label: 'Authentication',
    keywords: ['auth', 'login', 'signin', 'signon', 'token', 'oauth', 'entra', 'identity', 'permission', 'role', 'secure', 'security', 'session', 'bearer'],
    fileBoosts: ['auth', 'token', 'oauth', 'server', 'middleware', 'session'],
    risk: 'Changes here can break access flows or silently lock users out if contracts drift.',
    plan: ['Update auth boundaries first', 'Verify token/challenge flow', 'Retest protected routes and UI gating'],
  },
  {
    id: 'ui',
    label: 'UI / Dashboard',
    keywords: ['ui', 'ux', 'dashboard', 'panel', 'view', 'screen', 'layout', 'button', 'modal', 'page', 'visual', 'sidebar', 'sidepanel'],
    fileBoosts: ['public', 'index', 'app', 'style', 'css', 'html', 'dashboard'],
    risk: 'Visual or interaction changes often ripple into event handlers, data binding, and empty states.',
    plan: ['Adjust visible UI surfaces', 'Update interaction logic', 'Verify states, empty views, and selection behavior'],
  },
  {
    id: 'api',
    label: 'API / Contract',
    keywords: ['api', 'endpoint', 'route', 'contract', 'payload', 'request', 'response', 'tool', 'rpc', 'schema', 'interface'],
    fileBoosts: ['server', 'route', 'api', 'rpc', 'schema', 'payload'],
    risk: 'Contract changes can break callers while still returning superficially valid responses.',
    plan: ['Update contract surface first', 'Refactor callers and payload handling', 'Re-check downstream consumers'],
  },
  {
    id: 'performance',
    label: 'Performance',
    keywords: ['lag', 'slow', 'latency', 'performance', 'scroll', 'render', 'stream', 'sse', 'realtime', 'fast', 'cache', 'memory'],
    fileBoosts: ['stream', 'sse', 'ws', 'app', 'server', 'render'],
    risk: 'Performance issues often hide in streaming paths, repeated renders, or oversized payload processing.',
    plan: ['Trace the hot path first', 'Reduce repeated work or large payload handling', 'Re-check stream and render behavior'],
  },
  {
    id: 'data',
    label: 'Data / State',
    keywords: ['data', 'database', 'state', 'store', 'model', 'cache', 'history', 'persist', 'schema', 'log'],
    fileBoosts: ['data', 'state', 'store', 'log', 'tracker', 'schema'],
    risk: 'State and schema shifts usually require backfill, mock updates, and downstream compatibility checks.',
    plan: ['Adjust data shape and state assumptions first', 'Update readers and writers', 'Refresh fixtures or sample flows'],
  },
];

function analyzeImpact({ intent, repoRoot, trafficLog = [], target, projectGraph = null, cacheStatus = null }) {
  const normalizedIntent = (intent || '').trim();
  if (!normalizedIntent) {
    return {
      intent: '',
      summary: {
        headline: 'Describe a change to generate an impact map.',
        narrative: 'Enter a natural-language request such as "Add login requirement to the dashboard" or "The stream feels laggy when I scroll."',
        confidence: 'None',
        confidenceScore: 0,
      },
      concerns: [],
      impacts: { highConfidence: [], possibleImpact: [], unknowns: [] },
      runtime: { highConfidence: [], possibleImpact: [], unknowns: [] },
      risks: [],
      plan: [],
      guardrails: { bullets: [], promptBlock: '' },
      meta: buildMeta(trafficLog, { files: [], runtimeSurfaces: [] }, target, cacheStatus),
    };
  }

  const tokens = tokenize(normalizedIntent);
  const concerns = detectConcerns(tokens);
  const snapshot = hydrateProjectGraph(projectGraph || buildProjectGraph(repoRoot));
  const fileCandidates = scoreFiles(snapshot.files, tokens, concerns, snapshot.links);
  const runtimeCandidates = scoreRuntime(snapshot.runtimeSurfaces, trafficLog, tokens, concerns);

  const impacts = bucketCandidates(fileCandidates);
  const runtime = bucketCandidates(runtimeCandidates);
  const risks = buildRisks(concerns, impacts, runtime, trafficLog);
  const plan = buildPlan(concerns, impacts, runtime);
  const confidenceScore = computeConfidenceScore(snapshot, trafficLog, impacts, runtime, concerns);
  const guardrails = buildGuardrails(normalizedIntent, concerns, impacts, runtime, risks);

  return {
    intent: normalizedIntent,
    summary: {
      headline: buildHeadline(normalizedIntent, impacts, runtime),
      narrative: buildNarrative(concerns, impacts, runtime, confidenceScore),
      confidence: confidenceLabel(confidenceScore),
      confidenceScore,
    },
    concerns,
    impacts,
    runtime,
    risks,
    plan,
    guardrails,
    meta: buildMeta(trafficLog, snapshot, target, cacheStatus),
  };
}

function buildProjectGraph(repoRoot) {
  const files = [];
  const runtimeSurfaces = [];
  const links = new Map();

  walk(repoRoot, repoRoot, files, runtimeSurfaces, links);

  return {
    repoRoot,
    builtAt: new Date().toISOString(),
    files,
    runtimeSurfaces,
    links,
  };
}

function hydrateProjectGraph(projectGraph) {
  return {
    ...projectGraph,
    files: Array.isArray(projectGraph.files) ? projectGraph.files : [],
    runtimeSurfaces: Array.isArray(projectGraph.runtimeSurfaces) ? projectGraph.runtimeSurfaces : [],
    links: projectGraph.links instanceof Map
      ? projectGraph.links
      : new Map(Object.entries(projectGraph.links || {})),
  };
}

function walk(root, currentDir, files, runtimeSurfaces, links) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.') && !entry.name.startsWith('.well-known')) continue;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(root, path.join(currentDir, entry.name), files, runtimeSurfaces, links);
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    if (entry.name === 'package-lock.json') continue;

    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
    const content = fs.readFileSync(absolutePath, 'utf8');
    const tokenSet = new Set(tokenize(`${relativePath} ${content}`));
    const metadata = {
      path: relativePath,
      extension,
      tokens: Array.from(tokenSet),
      routes: extractRoutes(content),
      envVars: extractEnvVars(content),
      imports: extractImports(relativePath, content),
      score: 0,
      reasons: [],
      related: [],
    };

    files.push(metadata);
    links.set(relativePath, metadata.imports);

    for (const route of metadata.routes) {
      runtimeSurfaces.push({
        kind: route.kind,
        name: route.value,
        file: relativePath,
        keywords: tokenize(`${route.kind} ${route.value} ${relativePath}`),
      });
    }

    for (const envVar of metadata.envVars) {
      runtimeSurfaces.push({
        kind: 'env',
        name: envVar,
        file: relativePath,
        keywords: tokenize(`env ${envVar} ${relativePath}`),
      });
    }
  }
}

function extractRoutes(content) {
  const matches = [];
  const routeRegex = /\bapp\.(get|post|put|patch|delete|use)\(\s*['"`]([^'"`]+)['"`]/g;
  const wsRegex = /WebSocketServer\(\{\s*server,\s*path:\s*['"`]([^'"`]+)['"`]/g;
  let match;

  while ((match = routeRegex.exec(content))) {
    matches.push({ kind: 'route', value: match[2] });
  }
  while ((match = wsRegex.exec(content))) {
    matches.push({ kind: 'websocket', value: match[1] });
  }

  return matches;
}

function extractEnvVars(content) {
  const vars = new Set();
  const envRegex = /process\.env\.([A-Z0-9_]+)/g;
  let match;

  while ((match = envRegex.exec(content))) vars.add(match[1]);

  return Array.from(vars);
}

function extractImports(relativePath, content) {
  const imports = new Set();
  const regex = /(?:require\(|from\s+|src=|href=)['"`](\.{1,2}\/[^'"`]+)['"`]/g;
  let match;

  while ((match = regex.exec(content))) {
    imports.add(resolveImport(relativePath, match[1]));
  }

  return Array.from(imports).filter(Boolean);
}

function resolveImport(relativePath, importPath) {
  const baseDir = path.posix.dirname(relativePath);
  const resolved = path.posix.normalize(path.posix.join(baseDir, importPath));

  if (path.posix.extname(resolved)) return resolved;

  for (const extension of ['.js', '.json', '.html', '.css']) {
    return `${resolved}${extension}`;
  }

  return resolved;
}

function scoreFiles(files, tokens, concerns, links) {
  const concernIds = new Set(concerns.map(c => c.id));
  const tokenSet = new Set(tokens);
  const topDirectMatches = [];

  for (const file of files) {
    let score = 0;
    const reasons = [];
    const fileTokenSet = new Set(file.tokens);
    const overlaps = tokens.filter(token => fileTokenSet.has(token));

    if (overlaps.length) {
      score += overlaps.length * 18;
      reasons.push(`Matches intent terms: ${overlaps.slice(0, 3).join(', ')}`);
    }

    for (const concern of concerns) {
      const matchedBoosts = concern.fileBoosts.filter(boost => fileTokenSet.has(boost));
      if (matchedBoosts.length) {
        score += Math.min(24, matchedBoosts.length * 8);
        reasons.push(`${concern.label} surface in ${matchedBoosts.slice(0, 2).join(', ')}`);
      }
    }

    if (file.path === 'server.js') {
      score += 10;
      reasons.push('Main integration point for proxy, API, and runtime behavior');
    }

    if (file.path === 'auth-tracker.js' && concernIds.has('auth')) {
      score += 30;
      reasons.push('Owns the current authentication state machine');
    }

    if (file.path.startsWith('public/')) {
      if (concernIds.has('ui')) score += 16;
      reasons.push('Directly shapes the dashboard experience');
    }

    if (file.path === 'README.md' && !tokenSet.has('readme') && !tokenSet.has('doc')) {
      score -= 28;
    }

    if (file.path === 'impact-engine.js' && !tokenSet.has('impact') && !tokenSet.has('intent') && !tokenSet.has('context') && !tokenSet.has('analyze')) {
      score -= 54;
    }

    if (file.path === 'package.json' && !tokenSet.has('package') && !tokenSet.has('script')) {
      score -= 12;
    }

    if (file.routes.length) {
      score += 8;
      reasons.push('Defines application routes or inspector surfaces');
    }

    file.score = score;
    file.reasons = dedupe(reasons).slice(0, 3);
    topDirectMatches.push(file);
  }

  topDirectMatches.sort((a, b) => b.score - a.score);
  const topSeedPaths = new Set(topDirectMatches.filter(file => file.score >= 28).slice(0, 4).map(file => file.path));

  for (const file of files) {
    const related = buildRelatedFiles(file.path, links, topSeedPaths);
    file.related = related;
    if (!file.score && related.length) {
      file.score += 18;
      file.reasons.push(`Connected to likely change surface: ${related[0]}`);
    } else if (file.score && related.length) {
      file.score += 6;
      file.reasons.push(`Linked to adjacent file: ${related[0]}`);
    }

    if (!file.score && hasGenericFit(file, tokenSet)) {
      file.score = 16;
      file.reasons.push('Generic architectural fit based on intent category');
    }
  }

  return files
    .filter(file => file.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 9)
    .map(file => ({
      type: 'file',
      title: file.path,
      score: Math.min(100, file.score),
      subtitle: file.extension.toUpperCase().replace('.', ''),
      reason: file.reasons[0],
      details: file.reasons.slice(1),
      related: file.related,
      zone: scoreToZone(file.score),
    }));
}

function hasGenericFit(file, tokenSet) {
  if (tokenSet.has('dashboard') && file.path.startsWith('public/')) return true;
  if (tokenSet.has('login') && /auth|server/.test(file.path)) return true;
  if (tokenSet.has('stream') && /server|app/.test(file.path)) return true;
  return false;
}

function buildRelatedFiles(filePath, links, topSeedPaths) {
  const directLinks = links.get(filePath) || [];
  const related = [];

  for (const seed of topSeedPaths) {
    const seedLinks = links.get(seed) || [];
    if (seed !== filePath && (seedLinks.includes(filePath) || directLinks.includes(seed))) {
      related.push(seed);
    }
  }

  return dedupe(related).slice(0, 2);
}

function scoreRuntime(runtimeSurfaces, trafficLog, tokens, concerns) {
  const trafficByPath = new Map();
  const rpcCounts = new Map();

  for (const entry of trafficLog) {
    if (entry.path) trafficByPath.set(entry.path, (trafficByPath.get(entry.path) || 0) + 1);
    if (entry.rpcMethod) rpcCounts.set(entry.rpcMethod, (rpcCounts.get(entry.rpcMethod) || 0) + 1);
  }

  const candidates = runtimeSurfaces.map(surface => {
    const keywords = new Set(surface.keywords);
    const overlaps = tokens.filter(token => keywords.has(token));
    let score = overlaps.length * 18;
    const reasons = [];

    if (overlaps.length) reasons.push(`Matches intent terms: ${overlaps.slice(0, 3).join(', ')}`);

    for (const concern of concerns) {
      const matched = concern.keywords.filter(keyword => keywords.has(keyword));
      if (matched.length) {
        score += Math.min(18, matched.length * 6);
        reasons.push(`${concern.label} concern intersects this surface`);
      }
    }

    const seenPathCount = trafficByPath.get(surface.name) || 0;
    const seenRpcCount = rpcCounts.get(surface.name) || 0;
    if (seenPathCount) {
      score += 12;
      reasons.push(`Observed ${seenPathCount} request${seenPathCount === 1 ? '' : 's'} in captured traffic`);
    }
    if (seenRpcCount) {
      score += 12;
      reasons.push(`Observed ${seenRpcCount} JSON-RPC call${seenRpcCount === 1 ? '' : 's'} in captured traffic`);
    }

    return {
      type: surface.kind,
      title: surface.name,
      subtitle: surface.file,
      score: Math.min(100, score),
      reason: reasons[0] || 'Potential runtime touchpoint',
      details: reasons.slice(1),
      related: [],
      zone: scoreToZone(score),
    };
  });

  if (concerns.some(concern => concern.id === 'auth') && !candidates.find(item => item.title.includes('authorization'))) {
    candidates.push({
      type: 'auth-flow',
      title: 'Authorization challenge + token retry flow',
      subtitle: 'Observed proxy behavior',
      score: trafficLog.some(entry => entry.statusCode === 401 || entry.hasToken) ? 78 : 40,
      reason: 'Authentication work usually changes challenge handling and protected retries',
      details: ['Verify 401 challenge, PRM discovery, and bearer retry sequence'],
      related: [],
      zone: trafficLog.some(entry => entry.statusCode === 401 || entry.hasToken) ? 'brittle' : 'affected',
    });
  }

  if (concerns.some(concern => concern.id === 'performance')) {
    candidates.push({
      type: 'transport',
      title: 'Streaming / SSE transport',
      subtitle: 'Observed runtime behavior',
      score: trafficLog.some(entry => entry.isSSE || entry.streaming) ? 74 : 42,
      reason: 'Performance issues in this project often show up in stream handling and event rendering',
      details: ['Review SSE event volume, repeated rendering, and payload size'],
      related: [],
      zone: trafficLog.some(entry => entry.isSSE || entry.streaming) ? 'brittle' : 'affected',
    });
  }

  return candidates
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function bucketCandidates(candidates) {
  return {
    highConfidence: candidates.filter(item => item.score >= 62),
    possibleImpact: candidates.filter(item => item.score >= 34 && item.score < 62),
    unknowns: candidates.filter(item => item.score < 34).slice(0, 4),
  };
}

function detectConcerns(tokens) {
  return CONCERNS
    .map(concern => {
      const matched = concern.keywords.filter(keyword => tokens.includes(keyword));
      return matched.length
        ? {
            id: concern.id,
            label: concern.label,
            matched,
            score: matched.length * 20,
            keywords: concern.keywords,
            fileBoosts: concern.fileBoosts,
            risk: concern.risk,
            plan: concern.plan,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function buildRisks(concerns, impacts, runtime, trafficLog) {
  const risks = [];

  for (const concern of concerns.slice(0, 3)) {
    const definition = CONCERNS.find(item => item.id === concern.id);
    if (!definition) continue;
    risks.push({
      level: concern.id === 'auth' || concern.id === 'data' ? 'High' : 'Medium',
      title: definition.label,
      detail: definition.risk,
    });
  }

  if (trafficLog.some(entry => entry.statusCode >= 400 || entry.direction === 'error')) {
    risks.push({
      level: 'Medium',
      title: 'Existing error path',
      detail: 'Recent captured traffic already shows failing requests, so architectural changes should be validated against current failure modes.',
    });
  }

  if (!impacts.highConfidence.length && !runtime.highConfidence.length) {
    risks.push({
      level: 'Needs verification',
      title: 'Low-signal map',
      detail: 'There is not enough direct evidence yet, so treat this as a hypothesis and gather more runtime traces before refactoring.',
    });
  }

  return dedupeBy(risks, risk => `${risk.level}:${risk.title}`).slice(0, 4);
}

function buildPlan(concerns, impacts, runtime) {
  const steps = [];

  if (impacts.highConfidence.length) {
    steps.push(`Start with ${impacts.highConfidence[0].title}${impacts.highConfidence[0].related?.length ? ` and its linked file ${impacts.highConfidence[0].related[0]}` : ''}.`);
  } else {
    steps.push('Start by tracing the most relevant surface and confirming the current behavior.');
  }

  for (const concern of concerns.slice(0, 2)) {
    const definition = CONCERNS.find(item => item.id === concern.id);
    if (!definition) continue;
    for (const instruction of definition.plan) steps.push(instruction + '.');
  }

  if (runtime.highConfidence.length) {
    steps.push(`Verify runtime impact on ${runtime.highConfidence[0].title}.`);
  }

  return dedupe(steps).slice(0, 5);
}

function buildGuardrails(intent, concerns, impacts, runtime, risks) {
  const bullets = [];

  if (impacts.highConfidence.length) {
    bullets.push(`Treat ${impacts.highConfidence[0].title} as the primary change surface.`);
  }
  if (impacts.highConfidence.length > 1) {
    bullets.push(`Review adjacent impact on ${impacts.highConfidence.slice(1, 3).map(item => item.title).join(' and ')}.`);
  }
  if (runtime.highConfidence.length) {
    bullets.push(`Preserve runtime behavior around ${runtime.highConfidence[0].title}.`);
  } else if (runtime.possibleImpact.length) {
    bullets.push(`Verify runtime behavior around ${runtime.possibleImpact[0].title} before and after changes.`);
  }
  if (concerns.length) {
    bullets.push(`Respect ${concerns.slice(0, 2).map(concern => concern.label.toLowerCase()).join(' and ')} constraints while implementing.`);
  }
  if (risks.length) {
    bullets.push(`Do not ignore ${risks[0].title.toLowerCase()} risk signals.`);
  }

  return {
    bullets,
    promptBlock: bullets.length
      ? [
          '[HUD: Architecture Guardrails]',
          `Intent: ${intent}`,
          'Constraints:',
          ...bullets.map(bullet => `- ${bullet}`),
        ].join('\n')
      : '',
  };
}

function buildHeadline(intent, impacts, runtime) {
  const total = impacts.highConfidence.length + runtime.highConfidence.length;
  if (!total) return `No high-confidence impact map yet for "${intent}".`;
  return `${total} high-confidence surface${total === 1 ? '' : 's'} likely affected by "${intent}".`;
}

function buildNarrative(concerns, impacts, runtime, confidenceScore) {
  const concernText = concerns.length
    ? concerns.slice(0, 2).map(concern => concern.label).join(' + ')
    : 'general architectural';
  const fileText = impacts.highConfidence.length
    ? `Top file: ${impacts.highConfidence[0].title}.`
    : 'No direct file match yet.';
  const runtimeText = runtime.highConfidence.length
    ? `Top runtime surface: ${runtime.highConfidence[0].title}.`
    : 'Runtime impact still needs verification.';

  return `${concernText} signals detected. ${fileText} ${runtimeText} Confidence is ${confidenceLabel(confidenceScore).toLowerCase()}.`;
}

function computeConfidenceScore(snapshot, trafficLog, impacts, runtime, concerns) {
  let score = 24;
  if (snapshot.files.length) score += 16;
  if (trafficLog.length) score += 18;
  if (concerns.length) score += Math.min(18, concerns.length * 8);
  if (impacts.highConfidence.length) score += 16;
  if (runtime.highConfidence.length) score += 10;
  return Math.min(100, score);
}

function confidenceLabel(score) {
  if (score >= 80) return 'High';
  if (score >= 55) return 'Medium';
  if (score >= 30) return 'Low';
  return 'None';
}

function buildMeta(trafficLog, snapshot, target, cacheStatus = null) {
  const routeCount = new Set(trafficLog.map(entry => entry.path).filter(Boolean)).size;
  const rpcCount = new Set(trafficLog.map(entry => entry.rpcMethod).filter(Boolean)).size;

  return {
    target,
    indexedFiles: snapshot.files.length,
    indexedRuntimeSurfaces: snapshot.runtimeSurfaces.length,
    observedRequests: trafficLog.length,
    observedRoutes: routeCount,
    observedRpcMethods: rpcCount,
    graphBuiltAt: snapshot.builtAt || null,
    cacheSource: cacheStatus?.source || null,
    cacheUpdatedAt: cacheStatus?.updatedAt || null,
  };
}

function scoreToZone(score) {
  if (score >= 70) return 'brittle';
  if (score >= 40) return 'affected';
  return 'watch';
}

function tokenize(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token && !STOP_WORDS.has(token))
    .map(normalizeToken);
}

function normalizeToken(token) {
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function dedupeBy(values, selector) {
  const seen = new Set();
  return values.filter(value => {
    const key = selector(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  analyzeImpact,
  buildProjectGraph,
};
