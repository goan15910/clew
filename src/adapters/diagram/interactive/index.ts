// Shareable interactive graph surface for HTML hosts (spec viewer Graph tab, chart/workflows view).
// Element builders live in application/; this adapter owns vendored Cytoscape assets and the browser mount.
export { chartInteractive, workflowInteractive } from '../../../application/interactive-graph.js';
export type {
  DraftGraphCyElement,
  DraftGraphHoverDetail,
  DraftGraphInteractive,
} from '../../../application/documents.js';
export {
  installInteractiveGraphAssets,
  interactiveGraphClientPath,
  interactiveGraphScriptTags,
  interactiveGraphVendorDir,
} from './assets.js';
export {
  INTERACTIVE_GRAPH_ASSET_FILES,
  INTERACTIVE_GRAPH_CLIENT_FILE,
  INTERACTIVE_GRAPH_VENDOR_FILES,
} from './types.js';
