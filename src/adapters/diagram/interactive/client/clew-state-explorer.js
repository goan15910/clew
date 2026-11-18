/*
 * Browser mount of the Clew state explorer (Cytoscape + dagre). The page holds one ExplorerPayload; this script
 * draws it, lists the next actions of the selected state, and keeps a walk: the steps taken from the start.
 */
(function () {
  'use strict';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mount(payload, root) {
    var states = new Map(payload.states.map(function (state) { return [state.id, state]; }));
    var edges = new Map(payload.edges.map(function (edge) { return [edge.id, edge]; }));
    var out = new Map();
    var into = new Map();
    payload.edges.forEach(function (edge) {
      if (!out.has(edge.from)) out.set(edge.from, []);
      if (!into.has(edge.to)) into.set(edge.to, []);
      out.get(edge.from).push(edge);
      into.get(edge.to).push(edge);
    });
    var starts = payload.states.filter(function (state) { return state.initial; });
    var first = starts[0] || payload.states[0];

    // The walk: where it starts and the edge ids taken, in order.
    var walk = { start: first ? first.id : '', steps: [] };

    function current() {
      if (walk.steps.length === 0) return walk.start;
      return edges.get(walk.steps[walk.steps.length - 1]).to;
    }

    function shortest(target) {
      var cameBy = new Map();
      var queue = [];
      starts.forEach(function (state) { cameBy.set(state.id, null); queue.push(state.id); });
      for (var index = 0; index < queue.length; index += 1) {
        var id = queue[index];
        if (id === target) {
          var steps = [];
          var at = id;
          while (cameBy.get(at)) { steps.unshift(cameBy.get(at).id); at = cameBy.get(at).from; }
          return { start: at, steps: steps };
        }
        (out.get(id) || []).forEach(function (edge) {
          if (!cameBy.has(edge.to)) { cameBy.set(edge.to, edge); queue.push(edge.to); }
        });
      }
      return undefined;
    }

    var elements = [];
    payload.states.forEach(function (state) {
      var classes = [];
      if (state.initial) classes.push('initial');
      if (state.terminal) classes.push('terminal');
      elements.push({ group: 'nodes', data: { id: state.id, label: state.label.join('\n') }, classes: classes.join(' ') });
    });
    // One arrow per pair of states and kind; the actions are listed on it.
    var arrows = new Map();
    payload.edges.forEach(function (edge) {
      var key = edge.from + '>' + edge.to + '>' + (edge.certain ? 'c' : 'p');
      if (!arrows.has(key)) arrows.set(key, { id: 'a:' + key, source: edge.from, target: edge.to, certain: edge.certain, actions: [], edges: [] });
      var arrow = arrows.get(key);
      if (arrow.actions.indexOf(edge.action) < 0) arrow.actions.push(edge.action);
      arrow.edges.push(edge.id);
    });
    var arrowOf = new Map();
    arrows.forEach(function (arrow) {
      arrow.edges.forEach(function (id) { arrowOf.set(id, arrow.id); });
      var shown = arrow.actions.length > 4 ? arrow.actions.slice(0, 3).concat('+' + (arrow.actions.length - 3) + ' more') : arrow.actions;
      elements.push({ group: 'edges', data: { id: arrow.id, source: arrow.source, target: arrow.target, label: shown.join('\n') }, classes: arrow.certain ? 'certain' : 'possible' });
    });

    var canvas = root.querySelector('[data-explorer-canvas]');
    var panel = root.querySelector('[data-explorer-panel]');
    var cy = window.cytoscape({
      container: canvas,
      elements: elements,
      wheelSensitivity: 0.3,
      layout: { name: 'dagre', rankDir: 'LR', nodeSep: 30, rankSep: 90, edgeSep: 20 },
      style: [
        { selector: 'node', style: { 'shape': 'round-rectangle', 'background-color': '#f7f8fa', 'border-color': '#5b6472', 'border-width': 1.2, 'label': 'data(label)', 'text-wrap': 'wrap', 'text-valign': 'center', 'text-halign': 'center', 'font-size': 11, 'font-family': 'Helvetica, Arial, sans-serif', 'color': '#111827', 'width': 'label', 'height': 'label', 'padding': '9px' } },
        { selector: 'node.initial', style: { 'border-width': 3 } },
        { selector: 'node.terminal', style: { 'border-style': 'double', 'border-width': 4 } },
        { selector: 'edge', style: { 'curve-style': 'bezier', 'width': 1.3, 'line-color': '#5b6472', 'target-arrow-color': '#5b6472', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.9, 'label': 'data(label)', 'text-wrap': 'wrap', 'font-size': 9, 'font-family': 'Helvetica, Arial, sans-serif', 'color': '#374151', 'text-background-color': '#ffffff', 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'loop-direction': '-45deg', 'loop-sweep': '40deg' } },
        { selector: 'edge.possible', style: { 'line-style': 'dashed', 'line-color': '#8a93a3', 'target-arrow-color': '#8a93a3', 'color': '#6b7280' } },
        { selector: '.dim', style: { 'opacity': 0.22 } },
        { selector: 'node.walked', style: { 'background-color': '#fff3e8', 'border-color': '#c2410c' } },
        { selector: 'edge.walked', style: { 'line-color': '#c2410c', 'target-arrow-color': '#c2410c', 'color': '#c2410c', 'width': 3 } },
        { selector: 'node.current', style: { 'background-color': '#c2410c', 'border-color': '#7c2d12', 'color': '#ffffff' } },
        { selector: 'edge.next', style: { 'line-color': '#0f766e', 'target-arrow-color': '#0f766e', 'color': '#0f766e', 'width': 2.4 } },
        { selector: 'node.next', style: { 'border-color': '#0f766e', 'border-width': 2.6 } },
        { selector: 'node.found', style: { 'background-color': '#fef9c3' } },
        { selector: 'edge.hover', style: { 'width': 4.5 } }
      ]
    });

    function label(id) {
      var state = states.get(id);
      return state ? state.label.join(', ') : id;
    }

    function step(edgeId) {
      walk.steps.push(edgeId);
      render();
    }

    function select(id) {
      var here = current();
      if (id === here) return;
      var direct = (out.get(here) || []).filter(function (edge) { return edge.to === id; })[0];
      if (direct) { step(direct.id); return; }
      var path = shortest(id);
      walk = path || { start: id, steps: [] };
      render();
    }

    function actionRow(edge, other, onClick) {
      var row = el('button', 'action' + (edge.certain ? '' : ' possible'));
      row.type = 'button';
      row.appendChild(el('span', 'action-name', edge.action));
      row.appendChild(el('span', 'action-target', other));
      if (!edge.certain) row.appendChild(el('span', 'action-note', 'possible: from ' + edge.sources + ' of the ' + edge.of + ' states behind this one'));
      if (payload.actions[edge.action]) row.appendChild(el('span', 'action-text', payload.actions[edge.action]));
      row.addEventListener('click', onClick);
      row.addEventListener('mouseenter', function () { cy.getElementById(arrowOf.get(edge.id)).addClass('hover'); });
      row.addEventListener('mouseleave', function () { cy.getElementById(arrowOf.get(edge.id)).removeClass('hover'); });
      return row;
    }

    function render() {
      var here = current();
      var state = states.get(here);
      cy.elements().removeClass('walked current next dim');
      var walkedNodes = new Set([walk.start]);
      var walkedArrows = new Set();
      walk.steps.forEach(function (id) { walkedNodes.add(edges.get(id).to); walkedArrows.add(arrowOf.get(id)); });
      var nextEdges = out.get(here) || [];
      var nextArrows = new Set(nextEdges.map(function (edge) { return arrowOf.get(edge.id); }));
      var nextNodes = new Set(nextEdges.map(function (edge) { return edge.to; }));
      cy.nodes().forEach(function (node) {
        if (node.id() === here) node.addClass('current');
        else if (walkedNodes.has(node.id())) node.addClass('walked');
        else if (nextNodes.has(node.id())) node.addClass('next');
        else node.addClass('dim');
      });
      cy.edges().forEach(function (edge) {
        if (walkedArrows.has(edge.id())) edge.addClass('walked');
        else if (nextArrows.has(edge.id())) edge.addClass('next');
        else edge.addClass('dim');
      });

      panel.textContent = '';
      panel.appendChild(el('h2', '', 'Current state'));
      var table = el('table', 'values');
      payload.variables.forEach(function (name) {
        var tr = el('tr');
        tr.appendChild(el('th', '', name));
        tr.appendChild(el('td', '', state ? state.values[name] : ''));
        table.appendChild(tr);
      });
      panel.appendChild(table);
      var facts = [];
      if (state && payload.fullStates > payload.states.length) facts.push('stands for ' + state.members + ' of ' + payload.fullStates + ' states');
      if (state && state.initial) facts.push('a start state');
      if (state && state.terminal) facts.push('no step leaves it');
      if (facts.length > 0) panel.appendChild(el('p', 'facts', facts.join('; ')));

      panel.appendChild(el('h2', '', 'Next actions (' + nextEdges.length + ')'));
      if (nextEdges.length === 0) panel.appendChild(el('p', 'empty', 'Nothing can happen from here.'));
      nextEdges.forEach(function (edge) {
        panel.appendChild(actionRow(edge, '→ ' + label(edge.to), function () { step(edge.id); }));
      });

      panel.appendChild(el('h2', '', 'Walk (' + walk.steps.length + (walk.steps.length === 1 ? ' step)' : ' steps)')));
      var controls = el('div', 'controls');
      var back = el('button', 'control', 'Back');
      back.type = 'button';
      back.disabled = walk.steps.length === 0;
      back.addEventListener('click', function () { walk.steps.pop(); render(); });
      var reset = el('button', 'control', 'Restart');
      reset.type = 'button';
      reset.addEventListener('click', function () { walk = { start: first.id, steps: [] }; render(); });
      var shortestButton = el('button', 'control', 'Shortest path here');
      shortestButton.type = 'button';
      shortestButton.addEventListener('click', function () { var path = shortest(here); if (path) { walk = path; render(); } });
      controls.appendChild(back);
      controls.appendChild(reset);
      controls.appendChild(shortestButton);
      panel.appendChild(controls);
      panel.appendChild(el('p', 'walk-start', 'From ' + label(walk.start)));
      var list = el('ol', 'walk');
      walk.steps.forEach(function (id, index) {
        var edge = edges.get(id);
        var item = el('li');
        item.appendChild(el('span', 'action-name', edge.action));
        item.appendChild(el('span', 'action-target', ' → ' + label(edge.to)));
        item.addEventListener('click', function () { walk.steps = walk.steps.slice(0, index + 1); render(); });
        list.appendChild(item);
      });
      panel.appendChild(list);

      var incoming = into.get(here) || [];
      panel.appendChild(el('h2', '', 'Steps that lead here (' + incoming.length + ')'));
      incoming.forEach(function (edge) {
        panel.appendChild(actionRow(edge, label(edge.from) + ' →', function () { select(edge.from); }));
      });
    }

    cy.on('tap', 'node', function (event) { select(event.target.id()); });
    cy.on('tap', 'edge', function (event) {
      var here = current();
      var arrow = event.target.id();
      var match = (out.get(here) || []).filter(function (edge) { return arrowOf.get(edge.id) === arrow; })[0];
      if (match) step(match.id);
      else select(event.target.data('source'));
    });

    var search = root.querySelector('[data-explorer-search]');
    if (search) {
      search.addEventListener('input', function () {
        var text = search.value.trim().toLowerCase();
        cy.nodes().forEach(function (node) {
          node.toggleClass('found', text !== '' && node.data('label').toLowerCase().indexOf(text) >= 0);
        });
      });
    }
    var fit = root.querySelector('[data-explorer-fit]');
    if (fit) fit.addEventListener('click', function () { cy.fit(undefined, 30); });

    if (payload.path.length > 0 && payload.path.every(function (id) { return edges.has(id); })) {
      walk = { start: edges.get(payload.path[0]).from, steps: payload.path.slice() };
    }
    render();
    return { cy: cy, walk: function () { return walk; }, select: select, step: step };
  }

  window.ClewStateExplorer = { mount: mount };
})();
