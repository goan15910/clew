/**
 * Shareable browser mount for Clew interactive graphs (Cytoscape + dagre).
 * Used by the spec viewer Graph tab; `clew chart view` / `clew workflows view` can reuse it.
 *
 * Expects globals: cytoscape, cytoscapeDagre (from vendored scripts).
 * API: window.ClewInteractiveGraph.mount(container, document, options?)
 */
(function (global) {
  'use strict';

  function ensureLayout(cyLib) {
    if (typeof global.cytoscapeDagre === 'function') {
      global.cytoscapeDagre(cyLib);
    }
  }

  function styleSheet() {
    return [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'background-color': '#f6f8fa',
          'border-color': '#57606a',
          'border-width': 1.5,
          color: '#24292f',
          'font-size': 12,
          'font-family': 'Source Sans 3, Segoe UI, sans-serif',
          padding: '10px',
          shape: 'round-rectangle',
          width: 'label',
          height: 'label',
          'text-wrap': 'wrap',
          'text-max-width': 140,
        },
      },
      {
        selector: 'node.start',
        style: {
          shape: 'ellipse',
          width: 14,
          height: 14,
          'background-color': '#1c1917',
          'border-width': 0,
          label: '',
          padding: 0,
        },
      },
      {
        selector: 'node.final',
        style: { 'border-width': 3 },
      },
      {
        selector: 'node.initial',
        style: { 'background-color': '#ccfbf1', 'border-color': '#0f766e' },
      },
      {
        selector: 'node.path',
        style: { 'background-color': '#ddf4ff', 'border-color': '#0969da', 'border-width': 2 },
      },
      {
        selector: 'node.refused',
        style: {
          'background-color': '#f6f8fa',
          'border-style': 'dashed',
          'border-color': '#57606a',
          color: '#57606a',
        },
      },
      {
        selector: 'node.hover',
        style: { 'border-color': '#0f766e', 'border-width': 3 },
      },
      {
        selector: 'edge',
        style: {
          label: 'data(label)',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          width: 1.5,
          'line-color': '#6e7781',
          'target-arrow-color': '#6e7781',
          color: '#24292f',
          'font-size': 10,
          'font-family': 'Source Sans 3, Segoe UI, sans-serif',
          'text-background-color': '#ffffff',
          'text-background-opacity': 0.85,
          'text-background-padding': 2,
          'text-rotation': 'autorotate',
        },
      },
      {
        selector: 'edge.guarded',
        style: { 'line-style': 'dashed' },
      },
      {
        selector: 'edge.path',
        style: {
          width: 3,
          'line-color': '#0969da',
          'target-arrow-color': '#0969da',
          color: '#0969da',
        },
      },
      {
        selector: 'edge.refused',
        style: { 'line-style': 'dashed', 'line-color': '#57606a', 'target-arrow-color': '#57606a' },
      },
      {
        selector: 'edge.hover',
        style: { width: 3, 'line-color': '#0f766e', 'target-arrow-color': '#0f766e' },
      },
      {
        selector: '.faded',
        style: { opacity: 0.25 },
      },
    ];
  }

  function renderDetail(panel, detail) {
    if (!panel) return;
    if (!detail) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    panel.hidden = false;
    var html = '<div class="graph-detail-head"><strong>' + escapeHtml(detail.title) + '</strong>';
    html += ' <span class="graph-detail-kind">' + escapeHtml(detail.kind) + '</span></div>';
    if (detail.summary && detail.summary.length) {
      html += '<ul class="graph-detail-summary">';
      for (var i = 0; i < detail.summary.length; i++) {
        html += '<li>' + escapeHtml(detail.summary[i]) + '</li>';
      }
      html += '</ul>';
    }
    if (detail.condition) {
      html +=
        '<p class="graph-detail-condition"><span class="k">condition</span> ' +
        escapeHtml(detail.condition) +
        '</p>';
    }
    if (detail.sentence) {
      html +=
        '<p class="graph-detail-sentence"><span class="k">sentence</span> ' +
        escapeHtml(detail.sentence) +
        '</p>';
    }
    var lineage = detail.lineage || [];
    if (lineage.length === 0) {
      html += '<p class="graph-detail-empty">No lineage links.</p>';
    } else {
      html += '<div class="graph-detail-lineage" data-testid="graph-hover-lineage">';
      html += '<div class="k">lineage</div><ul>';
      for (var j = 0; j < lineage.length; j++) {
        html += '<li>' + escapeHtml(formatLink(lineage[j])) + '</li>';
      }
      html += '</ul></div>';
    }
    panel.innerHTML = html;
  }

  function formatLink(link) {
    var parts = [link.layer, link.id];
    if (link.kind) parts.push(link.kind);
    if (link.type) parts.push(link.type);
    if (link.name) parts.push(link.name);
    if (link.text) parts.push(link.text);
    if (link.status) parts.push(link.status);
    return parts.join(' · ');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightPath(cy, el) {
    cy.elements().removeClass('faded');
    if (!el) return;
    var neighborhood = el.closedNeighborhood();
    cy.elements().difference(neighborhood).addClass('faded');
  }

  /**
   * @param {HTMLElement} container
   * @param {{ elements: object[], details?: Record<string, object> }} doc
   * @param {{ detailPanel?: HTMLElement }} [options]
   */
  function mount(container, doc, options) {
    options = options || {};
    if (typeof global.cytoscape !== 'function') {
      throw new Error('cytoscape is not loaded');
    }
    ensureLayout(global.cytoscape);
    container.innerHTML = '';
    var canvas = document.createElement('div');
    canvas.className = 'graph-cy';
    canvas.setAttribute('data-graph-id', doc.id || '');
    container.appendChild(canvas);
    var cy = global.cytoscape({
      container: canvas,
      elements: doc.elements || [],
      style: styleSheet(),
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 40,
        edgeSep: 20,
        rankSep: 60,
        padding: 16,
        animate: false,
      },
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
    });
    canvas.__clewCy = cy;
    container.__clewCy = cy;
    var detailPanel = options.detailPanel || null;
    var clearTimer = null;

    function show(el) {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      cy.elements().removeClass('hover');
      if (!el) {
        renderDetail(detailPanel, null);
        highlightPath(cy, null);
        return;
      }
      el.addClass('hover');
      var key = el.data('detail');
      var detail = key && doc.details ? doc.details[key] : null;
      renderDetail(detailPanel, detail);
      highlightPath(cy, el);
    }

    cy.on('mouseover', 'node, edge', function (event) {
      show(event.target);
    });
    cy.on('mouseout', 'node, edge', function () {
      clearTimer = setTimeout(function () {
        show(null);
      }, 120);
    });
    cy.on('tap', function (event) {
      if (event.target === cy) show(null);
    });

    return {
      cy: cy,
      destroy: function () {
        cy.destroy();
      },
      fit: function () {
        cy.fit(undefined, 24);
      },
    };
  }

  global.ClewInteractiveGraph = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
