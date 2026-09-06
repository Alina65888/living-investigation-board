const DAY = 864e5;

const dateObj = s => (s ? new Date(`${s}T12:00:00`) : null);
const dayDiff = (a, b) => Math.round((dateObj(b) - dateObj(a)) / DAY);

export function taskDuration(task) {
  if (task?.startDate && task?.dueDate) return Math.max(1, dayDiff(task.startDate, task.dueDate) + 1);
  return 1;
}

export function buildGraph(tasks, relations) {
  const ids = new Set(tasks.map(t => t.id));
  const out = new Map(tasks.map(t => [t.id, []]));
  const inc = new Map(tasks.map(t => [t.id, []]));
  for (const rel of relations) {
    let from, to;
    if (rel.type === 'blocks') { from = rel.sourceId; to = rel.targetId; }
    else if (rel.type === 'depends') { from = rel.targetId; to = rel.sourceId; }
    else continue;
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    out.get(from).push(to);
    inc.get(to).push(from);
  }
  return { out, inc };
}

export function reaches(graph, from, to) {
  if (from === to) return true;
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    for (const next of graph.out.get(stack.pop()) || []) {
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

export function wouldCreateCycle(tasks, relations, sourceId, targetId, type = 'blocks') {
  if (sourceId === targetId) return [sourceId, sourceId];
  const from = type === 'depends' ? targetId : sourceId;
  const to = type === 'depends' ? sourceId : targetId;
  const graph = buildGraph(tasks, relations);
  return pathBetween(graph, to, from);
}

function pathBetween(graph, from, to) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const node = queue.shift();
    for (const next of graph.out.get(node) || []) {
      if (prev.has(next)) continue;
      prev.set(next, node);
      if (next === to) {
        const path = [next];
        let step = node;
        while (step !== null && step !== undefined) { path.unshift(step); step = prev.get(step); }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

export function findCycles(tasks, relations) {
  const graph = buildGraph(tasks, relations);
  const state = new Map();
  const stack = [];
  const cycles = [];
  const walk = node => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.out.get(node) || []) {
      if (state.get(next) === 1) cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) walk(next);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const task of tasks) if (!state.has(task.id)) walk(task.id);
  return cycles;
}

export function schedule(tasks, relations) {
  const cycles = findCycles(tasks, relations);
  if (cycles.length) return { ok: false, cycles, entries: new Map() };

  const graph = buildGraph(tasks, relations);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const order = topoOrder(tasks, graph);
  const entries = new Map();

  for (const id of order) {
    const duration = taskDuration(byId.get(id));
    let earliestStart = 0;
    for (const pred of graph.inc.get(id) || []) {
      earliestStart = Math.max(earliestStart, entries.get(pred).earliestFinish);
    }
    entries.set(id, { duration, earliestStart, earliestFinish: earliestStart + duration });
  }

  const horizon = Math.max(0, ...[...entries.values()].map(e => e.earliestFinish));

  for (const id of [...order].reverse()) {
    const entry = entries.get(id);
    let latestFinish = horizon;
    for (const succ of graph.out.get(id) || []) {
      latestFinish = Math.min(latestFinish, entries.get(succ).latestStart);
    }
    entry.latestFinish = latestFinish;
    entry.latestStart = latestFinish - entry.duration;
    entry.slack = entry.latestStart - entry.earliestStart;
    entry.critical = entry.slack === 0;
  }

  return { ok: true, cycles: [], entries, horizon };
}

function topoOrder(tasks, graph) {
  const degree = new Map(tasks.map(t => [t.id, (graph.inc.get(t.id) || []).length]));
  const queue = tasks.filter(t => degree.get(t.id) === 0).map(t => t.id);
  const order = [];
  while (queue.length) {
    const node = queue.shift();
    order.push(node);
    for (const next of graph.out.get(node) || []) {
      degree.set(next, degree.get(next) - 1);
      if (degree.get(next) === 0) queue.push(next);
    }
  }
  return order;
}

export function taskCompletion(task) {
  if (task?.status === 'done') return 1;
  const list = task?.checklist || [];
  if (list.length) return list.filter(item => item.done).length / list.length;
  return 0;
}

export function projectProgress(tasks) {
  const totalDays = tasks.reduce((sum, t) => sum + taskDuration(t), 0);
  if (!totalDays) return { percent: 0, doneDays: 0, totalDays: 0 };
  const doneDays = tasks.reduce((sum, t) => sum + taskDuration(t) * taskCompletion(t), 0);
  return {
    percent: Math.round((doneDays / totalDays) * 100),
    doneDays: Math.round(doneDays * 10) / 10,
    totalDays
  };
}

export function slackByTask(tasks, relations) {
  const result = schedule(tasks, relations);
  const graph = buildGraph(tasks, relations);
  const slack = new Map();
  if (!result.ok) return slack;
  for (const [id, entry] of result.entries) {
    const linked = (graph.inc.get(id) || []).length || (graph.out.get(id) || []).length;
    if (linked) slack.set(id, entry.slack);
  }
  return slack;
}

export function criticalChain(tasks, relations) {
  const result = schedule(tasks, relations);
  if (!result.ok) return [];
  const graph = buildGraph(tasks, relations);
  const critical = [...result.entries].filter(([, e]) => e.critical).map(([id]) => id);
  const criticalSet = new Set(critical);
  const heads = critical.filter(id => !(graph.inc.get(id) || []).some(p => criticalSet.has(p)));
  let best = [];
  for (const head of heads) {
    const path = [];
    let node = head;
    while (node) {
      path.push(node);
      node = (graph.out.get(node) || []).find(n => criticalSet.has(n));
    }
    if (path.length > best.length) best = path;
  }
  return best;
}
