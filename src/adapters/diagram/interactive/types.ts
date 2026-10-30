/** Vendored browser asset names for the interactive graph (no CDN). */
export const INTERACTIVE_GRAPH_VENDOR_FILES = [
  'cytoscape.min.js',
  'cytoscape-dagre.min.js',
] as const;

export const INTERACTIVE_GRAPH_CLIENT_FILE = 'clew-interactive-graph.js';

/** Asset filenames copied next to a viewer HTML (vendor + client mount). */
export const INTERACTIVE_GRAPH_ASSET_FILES = [
  ...INTERACTIVE_GRAPH_VENDOR_FILES,
  INTERACTIVE_GRAPH_CLIENT_FILE,
] as const;
