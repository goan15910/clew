// Projected views: the read/write analysis, the starter view, the check module, state graphs, and the CLI.
// The model is synthetic (examples/projection/Fulfil.tla). TLC runs only when TLA2TOOLS_JAR names a jar.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeProjection, dependencyDot, draftView, evaluateKeep, viewCheckModule } from '../../src/domain/projection.js';
import { functionParts, graphStats, projectGraph, readTlcDot, shortestPath, viewDot } from '../../src/domain/state-graph.js';
import { blankComments, mentions, scanTlaModule, splitJunction } from '../../src/domain/tla-scan.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const FULFIL = readFileSync(join(root, 'examples', 'projection', 'Fulfil.tla'), 'utf8');

function clew(args: string[], env: Record<string, string> = {}) {
  return spawnSync(tsx, [join(root, 'src', 'cli.ts'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

function analysis() {
  const result = analyzeProjection(FULFIL);
  assert.ok(result.ok);
  return result.analysis;
}

// What TLC prints for a two-variable model with -dump dot,actionlabels.
const DUMP = `strict digraph DiskGraph {
nodesep=0.35;
subgraph cluster_graph {
color="white";
1 [label="/\\\\ door = \\"closed\\"\\n/\\\\ light = [hall |-> \\"off\\"]",style = filled]
1 -> 2 [label="Open",color="black",fontcolor="black"];
2 [label="/\\\\ door = \\"open\\"\\n/\\\\ light = [hall |-> \\"off\\"]"];
2 -> 3 [label="Switch(\\"hall\\")",color="black",fontcolor="black"];
3 [label="/\\\\ door = \\"open\\"\\n/\\\\ light = [hall |-> \\"on\\"]"];
3 -> 4 [label="Close",color="black",fontcolor="black"];
4 [label="/\\\\ door = \\"closed\\"\\n/\\\\ light = [hall |-> \\"on\\"]"];
2 -> 1 [label="Close",color="black",fontcolor="black"];
{rank = same; 1;}
}
subgraph cluster_legend {graph[style=bold];label = "Next State Actions" style="solid"
node [ labeljust="l",colorscheme="paired12",style=filled,shape=record ]
Open [label="Open",fillcolor=2]
}}`;

describe('reading a TLA+ module', () => {
  test('comments are blanked without moving a column, and strings are left alone', () => {
    const text = 'a == "x \\* y" \\* note\n(* block\n *) b == 1';
    const blank = blankComments(text);
    assert.equal(blank.length, text.length);
    assert.match(blank, /"x \\\* y"/);
    assert.doesNotMatch(blank, /note|block/);
  });

  test('the scan finds the variables, the definitions, and the comment above each', () => {
    const scanned = scanTlaModule(FULFIL);
    assert.ok(scanned.ok);
    assert.equal(scanned.module.name, 'Fulfil');
    assert.deepEqual(scanned.module.variables, ['order_status', 'payment_status', 'shipment_status', 'stock_status', 'newsletter_status']);
    const pack = scanned.module.definitions.find((definition) => definition.name === 'PackShipment_s4');
    assert.deepEqual(pack?.params, ['shipment']);
    assert.match(pack?.comment[0] ?? '', /^s4: /);
    assert.match(scanned.module.preamble, /OrderStates ==/);
  });

  test('a bulleted list splits at its own bullets only', () => {
    const list = splitJunction('\n  /\\ a = 1\n  /\\ \\/ b = 1\n     \\/ c = 1\n  /\\ d\' = 2');
    assert.equal(list.op, 'and');
    assert.equal(list.items.length, 3);
    assert.equal(splitJunction(list.items[1]?.text ?? '').op, 'or');
    const inline = splitJunction('Actions \\/ Environment');
    assert.deepEqual(inline.items.map((item) => item.text), ['Actions', 'Environment']);
    assert.equal(splitJunction('\\E x \\in S : A(x) /\\ B(x)').op, 'single');
  });

  test('mentions tell primed, unprimed, and unchanged names apart', () => {
    const found = mentions('x = "y" /\\ y\' = [y EXCEPT ![k] = r.field] /\\ UNCHANGED <<z, w>> /\\ M!Op');
    assert.deepEqual([...found.plain].sort(), ['EXCEPT', 'M', 'UNCHANGED', 'k', 'r', 'x', 'y']);
    assert.deepEqual([...found.primed], ['y']);
    assert.deepEqual([...found.unchanged], ['z', 'w']);
  });
});

describe('projection analysis', () => {
  test('each action reports what it reads and writes', () => {
    const { actions } = analysis();
    assert.equal(actions.length, 11);
    const cancel = actions.find((action) => action.name === 'CancelOrder_s7_1');
    assert.deepEqual(cancel?.writes, ['order_status', 'payment_status']);
    assert.deepEqual(cancel?.guards, ['order_status', 'payment_status', 'shipment_status']);
    assert.equal(cancel?.sentence, 's7');
    const pack = actions.find((action) => action.name === 'PackShipment_s4');
    assert.equal(pack?.quantifier, '\\E shipment \\in Shipment');
    assert.equal(pack?.args, '(shipment)');
    assert.ok(actions.some((action) => action.name === 'Environment#1' && action.writes.join() === 'stock_status'));
  });

  test('dependencies, independent parts, and candidates follow', () => {
    const result = analysis();
    const order = result.variables.find((variable) => variable.name === 'order_status');
    assert.deepEqual(order?.dependsOn, ['payment_status', 'shipment_status']);
    assert.deepEqual(order?.cone, ['order_status', 'payment_status', 'shipment_status', 'stock_status']);
    assert.deepEqual(result.components, [['order_status', 'payment_status', 'shipment_status', 'stock_status'], ['newsletter_status']]);
    const kinds = result.candidates.map((candidate) => `${candidate.kind}:${candidate.keep.join('+')}:${candidate.exact}`);
    assert.ok(kinds.includes('component:newsletter_status:true'));
    assert.ok(kinds.includes('cone:stock_status:true'));
    assert.ok(kinds.includes('focus:order_status+payment_status+shipment_status:false'));
    assert.ok(kinds.includes('lifecycle:order_status:false'));
  });

  test('a keep set says which actions wait on hidden variables', () => {
    const result = analysis();
    const kept = evaluateKeep(result, ['order_status', 'payment_status']);
    assert.equal(kept.closed, false);
    assert.deepEqual(kept.weakened.map((entry) => entry.action), ['CloseOrder_s6', 'CancelOrder_s7_1']);
    assert.equal(evaluateKeep(result, ['newsletter_status']).closed, true);
  });

  test('the dependency map groups variables by part and draws who reads whom', () => {
    const dot = dependencyDot(analysis(), ['order_status']);
    assert.match(dot, /subgraph cluster_2 \{ label="part 2"/);
    assert.match(dot, /"stock_status" -> "shipment_status" \[label="1"\];/);
    assert.match(dot, /"order_status" \[label="order_status\\n5 writers", color="#c2410c"/);
    assert.match(dot, /"stock_status" \[label="stock_status\\n1 writer"\];/);
  });

  test('a module with no Next is refused with a way forward', () => {
    const result = analyzeProjection('---- MODULE M ----\nVARIABLE x\nStep == x\' = x\n====');
    assert.ok(!result.ok);
    assert.match(result.message, /--next/);
  });
});

describe('the starter view', () => {
  test('an exact view keeps its actions as written and drops the rest', () => {
    const result = draftView(FULFIL, { name: 'FulfilNews', keep: ['newsletter_status'] });
    assert.ok(result.ok);
    const { draft } = result;
    assert.deepEqual(draft.kept, ['SubscribeNewsletter_s8', 'UnsubscribeNewsletter_s9']);
    assert.equal(draft.weakened.length, 0);
    assert.equal(draft.removed.length, 9);
    assert.match(draft.tla, /^VARIABLES newsletter_status$/m);
    assert.match(draft.tla, /^Next == Actions$/m);
    assert.match(draft.tla, /^Spec == Init \/\\ \[\]\[Next\]_vars$/m);
    assert.doesNotMatch(draft.tla.slice(draft.tla.indexOf('VARIABLES')), /UNCHANGED|order_status|Environment/);
  });

  test('a lossy view drops hidden guards, says so, and keeps the frame of what is left', () => {
    const result = draftView(FULFIL, { name: 'FulfilOrder', keep: ['order_status', 'stock_status'] });
    assert.ok(result.ok);
    const { draft } = result;
    assert.deepEqual(draft.weakened.map((entry) => entry.action), ['ApproveOrder_s3', 'CloseOrder_s6', 'CancelOrder_s7_1', 'CancelOrder_s7_2']);
    assert.match(draft.tla, /\\\* hidden \(payment_status\): payment_status = "paid"/);
    assert.match(draft.tla, /\/\\ UNCHANGED stock_status/);
    assert.match(draft.tla, /\\\/ \(stock_status' \\in StockStates \/\\ UNCHANGED order_status\)/);
    assert.deepEqual(draft.omitted, ['InvOrder_s10']);
    assert.match(draft.tla, /^Done ==/m);
    assert.match(draft.cfg, /SPECIFICATION Spec\nINVARIANT TypeOK/);
  });

  test('an unknown variable is refused', () => {
    const result = draftView(FULFIL, { name: 'V', keep: ['order'] });
    assert.ok(!result.ok);
    assert.match(result.message, /no variable order;/);
  });
});

describe('the check module', () => {
  const view = (() => {
    const drafted = draftView(FULFIL, { name: 'FulfilOrder', keep: ['order_status'] });
    assert.ok(drafted.ok);
    return drafted.draft.tla;
  })();

  test('it instances the view on the model and names one Cover_ action per step', () => {
    const result = viewCheckModule({ base: FULFIL, view });
    assert.ok(result.ok);
    const { check } = result;
    assert.equal(check.module, 'FulfilOrderRefines');
    assert.match(check.tla, /^EXTENDS Fulfil$/m);
    assert.match(check.tla, /^View == INSTANCE FulfilOrder WITH order_status <- order_status$/m);
    assert.match(check.tla, /^ImplementsView == View!Spec$/m);
    assert.match(check.tla, /^Cover_CloseOrder_s6 == Next \/\\ View!CloseOrder_s6$/m);
    assert.match(check.tla, /^CoverSpec == Init \/\\ \[\]\[CoverNext\]_vars$/m);
    assert.match(check.cfg, /SPECIFICATION Spec\nPROPERTY ImplementsView/);
    assert.match(check.coverCfg, /SPECIFICATION CoverSpec/);
  });

  test('a quantified step keeps its quantifier', () => {
    const drafted = draftView(FULFIL, { name: 'FulfilShip', keep: ['shipment_status'] });
    assert.ok(drafted.ok);
    const result = viewCheckModule({ base: FULFIL, view: drafted.draft.tla });
    assert.ok(result.ok);
    assert.match(result.check.tla, /^Cover_ShipShipment_s5 == Next \/\\ \\E shipment \\in Shipment : View!ShipShipment_s5\(shipment\)$/m);
  });

  test('a view variable the model lacks needs --map, and gets it', () => {
    const renamed = view.replace(/order_status/g, 'phase');
    const missing = viewCheckModule({ base: FULFIL, view: renamed });
    assert.ok(!missing.ok);
    assert.match(missing.message, /--map "phase <- expression"/);
    const mapped = viewCheckModule({ base: FULFIL, view: renamed, map: { phase: 'order_status' } });
    assert.ok(mapped.ok);
    assert.match(mapped.check.tla, /WITH phase <- order_status$/m);
  });
});

describe('state graphs', () => {
  const graph = (() => {
    const read = readTlcDot(DUMP);
    assert.ok(read.ok);
    return read.graph;
  })();

  test('a TLC dump reads into states, steps, and the parts of function values', () => {
    assert.deepEqual(graph.variables, ['door', 'light']);
    assert.deepEqual(graph.parts, ['light[hall]']);
    assert.equal(graph.states.length, 4);
    assert.equal(graph.states.filter((state) => state.initial).length, 1);
    assert.deepEqual(graph.edges.map((edge) => edge.action), ['Open', 'Switch', 'Close', 'Close']);
    assert.equal(graph.edges[1]?.label, 'Switch("hall")');
    assert.deepEqual(functionParts('(a :> 1 @@ b :> 2)'), [['a', '1'], ['b', '2']]);
  });

  test('a projection merges states and marks a step that waits on a hidden variable', () => {
    const projected = projectGraph(graph, ['light[hall]']);
    assert.ok(projected.ok);
    const { view } = projected;
    assert.equal(view.states.length, 2);
    assert.deepEqual(view.edges.map((edge) => [edge.action, edge.certain, edge.sources]), [['Switch', false, 1]]);
    assert.equal(view.exactness, 0);
    const door = projectGraph(graph, ['door']);
    assert.ok(door.ok);
    assert.deepEqual(door.view.edges.map((edge) => `${edge.action}:${edge.certain}`).sort(), ['Close:true', 'Open:false']);
    const unknown = projectGraph(graph, ['window']);
    assert.ok(!unknown.ok);
  });

  test('the whole graph is its own exact view, and a path can be found and drawn', () => {
    const whole = projectGraph(graph, []);
    assert.ok(whole.ok);
    assert.equal(whole.view.exactness, 1);
    assert.deepEqual(whole.view.states.filter((state) => state.terminal).length, 1);
    const path = shortestPath(whole.view, (state) => state.values.light === '[hall |-> "on"]');
    assert.equal(path?.length, 2);
    const dot = viewDot(whole.view, { title: 'Door', path: path ?? [] });
    assert.match(dot, /label="door = closed\\nlight = hall: off"/);
    assert.match(dot, /peripheries=2/);
    assert.match(dot, /penwidth=2.2/);
    assert.equal(shortestPath(whole.view, () => false), undefined);
  });

  test('statistics give correlation, shared steps, and value pairs that never meet', () => {
    const stats = graphStats(graph, ['door', 'light[hall]']);
    assert.equal(stats.states, 4);
    assert.deepEqual(stats.variables.map((variable) => variable.changes), [3, 1]);
    assert.equal(stats.pairs[0]?.correlation, 0);
    assert.equal(stats.pairs[0]?.neverCount, 0);
  });
});

describe('clew spec projection', () => {
  function workspace(): { dir: string; env: Record<string, string> } {
    const dir = mkdtempSync(join(tmpdir(), 'clew-projection-'));
    copyFileSync(join(root, 'examples', 'projection', 'Fulfil.tla'), join(dir, 'Fulfil.tla'));
    copyFileSync(join(root, 'examples', 'projection', 'Fulfil.cfg'), join(dir, 'Fulfil.cfg'));
    return { dir, env: { CLEW_DATA_DIR: join(dir, 'data') } };
  }

  test('analyze, draft, render, and the session record', () => {
    const { dir, env } = workspace();
    try {
      const analyzed = clew(['spec', 'projection', 'analyze', join(dir, 'Fulfil.tla'), '--keep', 'order_status,payment_status', '--json'], env);
      assert.equal(analyzed.status, 0, analyzed.stderr);
      const document = JSON.parse(analyzed.stdout) as { analysis: { components: string[][] }; evaluation: { closed: boolean } };
      assert.equal(document.analysis.components.length, 2);
      assert.equal(document.evaluation.closed, false);
      assert.equal(clew(['spec', 'projection', 'analyze', join(dir, 'Fulfil.tla'), '--keep', 'nope'], env).status, 2);

      const drafted = clew(['spec', 'projection', 'draft', join(dir, 'Fulfil.tla'), '--name', 'FulfilOrder', '--keep', 'order_status'], env);
      assert.equal(drafted.status, 0, drafted.stderr);
      assert.match(drafted.stdout, /weakened ApproveOrder_s3: dropped payment_status = "paid"/);
      assert.ok(existsSync(join(dir, 'FulfilOrder.tla')));
      const again = clew(['spec', 'projection', 'draft', join(dir, 'Fulfil.tla'), '--name', 'FulfilOrder', '--keep', 'order_status'], env);
      assert.equal(again.status, 2);
      assert.match(again.stderr, /--force/);

      writeFileSync(join(dir, 'door.dot'), DUMP);
      const rendered = clew(['spec', 'projection', 'render', join(dir, 'door.dot'), '--keep', 'door', '--out', join(dir, 'door.dot.out.dot'), '--to', 'door=open'], env);
      assert.equal(rendered.status, 0, rendered.stderr);
      assert.match(rendered.stdout, /view of door: 2 states, 2 steps \(from 4 states, 4 steps\), 50% certain/);
      assert.match(rendered.stdout, /possible: closed -Open-> open {2}\(1 of 2 states\)/);
      assert.match(readFileSync(join(dir, 'door.dot.out.dot'), 'utf8'), /style=dashed/);
      assert.equal(clew(['spec', 'projection', 'render', join(dir, 'door.dot'), '--to', 'door=ajar'], env).status, 2);
      const picture = spawnSync('dot', ['-V']).status === 0;
      if (picture) {
        assert.equal(clew(['spec', 'projection', 'render', join(dir, 'door.dot'), '--out', join(dir, 'door.svg')], env).status, 0);
        assert.match(readFileSync(join(dir, 'door.svg'), 'utf8'), /<svg/);
        const big = clew(['spec', 'projection', 'render', join(dir, 'door.dot'), '--out', join(dir, 'door.png'), '--max-states', '2'], env);
        assert.equal(big.status, 2);
        assert.match(big.stderr, /--max-states/);
      }

      writeFileSync(join(dir, 'spec.md'), 'The customer submits the draft order as submitted.\n');
      assert.equal(clew(['spec', 'init', join(dir, 'spec.md'), '--session', 'fulfil'], env).status, 0);
      const proposed = clew(['spec', 'projection', 'propose', '--name', 'FulfilOrder', '--keep', 'order_status', '--candidate', 'c5', '--reason', 'the order alone'], env);
      assert.equal(proposed.status, 0, proposed.stderr);
      const early = clew(['spec', 'projection', 'finalize', '--name', 'FulfilOrder', '--reason', 'done'], env);
      assert.equal(early.status, 2);
      assert.match(early.stderr, /has no check/);
      assert.equal(clew(['spec', 'projection', 'finalize', '--name', 'FulfilOrder', '--drop', '--reason', 'not needed'], env).status, 0);
      const listed = JSON.parse(clew(['spec', 'projection', 'list', '--json'], env).stdout) as { projections: { name: string; status: string; history: unknown[] }[] };
      assert.deepEqual(listed.projections.map((record) => [record.name, record.status, record.history.length]), [['FulfilOrder', 'dropped', 2]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('check without a jar is exit 2 with a message', () => {
    const { dir, env } = workspace();
    try {
      clew(['spec', 'projection', 'draft', join(dir, 'Fulfil.tla'), '--name', 'FulfilOrder', '--keep', 'order_status'], env);
      const result = clew(['spec', 'projection', 'check', join(dir, 'FulfilOrder.tla'), '--against', join(dir, 'Fulfil.tla')], { ...env, TLA2TOOLS_JAR: '' });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /tla2tools\.jar/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const jar = process.env.TLA2TOOLS_JAR;
  test('TLC accepts a drafted view, rejects a view that forbids a step, and a checked view can be finalized', { skip: jar === undefined || jar === '' || !existsSync(jar) ? 'set TLA2TOOLS_JAR to a tla2tools.jar to run TLC' : false }, () => {
    const { dir, env } = workspace();
    try {
      const model = join(dir, 'Fulfil.tla');
      const view = join(dir, 'FulfilOrder.tla');
      writeFileSync(join(dir, 'spec.md'), 'The customer submits the draft order as submitted.\n');
      clew(['spec', 'init', join(dir, 'spec.md'), '--session', 'fulfil'], env);
      clew(['spec', 'projection', 'propose', '--name', 'FulfilOrder', '--keep', 'order_status', '--reason', 'the order alone'], env);
      clew(['spec', 'projection', 'draft', model, '--name', 'FulfilOrder', '--keep', 'order_status'], env);
      const passed = clew(['spec', 'projection', 'check', view, '--against', model, '--cover', '--name', 'FulfilOrder', '--json'], env);
      assert.equal(passed.status, 0, passed.stdout + passed.stderr);
      const document = JSON.parse(passed.stdout) as { check: { implements: boolean; neverTaken: string[] }; tlc: { states: { distinct: number } } };
      assert.equal(document.check.implements, true);
      assert.deepEqual(document.check.neverTaken, []);
      assert.equal(document.tlc.states.distinct, 92);
      assert.equal(clew(['spec', 'projection', 'finalize', '--name', 'FulfilOrder', '--reason', 'reviewed'], env).status, 0);
      const current = (): boolean | undefined => (JSON.parse(clew(['spec', 'projection', 'list', '--json'], env).stdout) as { projections: { check?: { current: boolean } }[] }).projections[0]?.check?.current;
      assert.equal(current(), true);

      // A milestone versions the spec only: it does not freeze the projection record.
      const closed = clew(['spec', 'milestone', 'close', '--title', 'First', '--goal', 'the sentence as read'], env);
      assert.equal(closed.status, 0, closed.stderr);
      const stored = readdirSync(dir, { recursive: true }).map(String);
      assert.ok(stored.some((file) => /milestones.*sentences\.json$/.test(file)), stored.join(' '));
      assert.ok(stored.some((file) => /projections\.json$/.test(file)));
      assert.ok(!stored.some((file) => /milestones.*projections\.json$/.test(file)));

      // The exact view of a closed set has the graph the projection of the model's graph has.
      clew(['spec', 'projection', 'draft', model, '--name', 'FulfilNews', '--keep', 'newsletter_status'], env);
      const exact = JSON.parse(clew(['spec', 'projection', 'render', join(dir, 'FulfilNews.tla'), '--json'], env).stdout) as { view: { states: number; edges: number } };
      const projected = JSON.parse(clew(['spec', 'projection', 'render', model, '--keep', 'newsletter_status', '--json'], env).stdout) as { view: { states: number; edges: number; exactness: number } };
      assert.deepEqual([exact.view.states, exact.view.edges], [projected.view.states, projected.view.edges]);
      assert.equal(projected.view.exactness, 1);

      // Forbid cancelling an approved order: the model does it, so the view no longer covers the model.
      writeFileSync(view, readFileSync(view, 'utf8').replace('order_status \\in {"submitted", "approved"}', 'order_status = "submitted"'));
      const failed = clew(['spec', 'projection', 'check', view, '--against', model, '--name', 'FulfilOrder', '--json'], env);
      assert.equal(failed.status, 1, failed.stdout);
      const violation = JSON.parse(failed.stdout) as { check: { implements: boolean }; tlc: { trace: { action?: string }[] }; projections: { status: string }[] };
      assert.equal(violation.check.implements, false);
      assert.equal(violation.tlc.trace.at(-1)?.action, 'CancelOrder_s7_1');
      assert.equal(violation.projections[0]?.status, 'proposed');
      const stale = clew(['spec', 'projection', 'finalize', '--name', 'FulfilOrder', '--reason', 'again'], env);
      assert.equal(stale.status, 2);
      // Whether a stored check still describes the files is worked out on every read.
      assert.equal(current(), true);
      writeFileSync(view, `${readFileSync(view, 'utf8')}\n`);
      assert.equal(current(), false);
      assert.match(clew(['spec', 'projection', 'list'], env).stdout, /the files changed since: check again/);

      const dumped = clew(['spec', 'projection', 'dump', model, '--out', join(dir, 'fulfil.dot'), '--json'], env);
      assert.equal(dumped.status, 0, dumped.stdout);
      const withGraph = JSON.parse(clew(['spec', 'projection', 'analyze', model, '--graph', join(dir, 'fulfil.dot'), '--json'], env).stdout) as { scored: { candidate: string; states: number }[]; stats: { states: number } };
      assert.equal(withGraph.stats.states, 92);
      assert.equal(withGraph.scored.find((score) => score.candidate === 'c2')?.states, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
