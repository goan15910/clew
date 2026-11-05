// Chart YAML is clew.spec.v1. Location-id files fail schema.
// Analyze/view consume a label-flat Model. Verify loads Spec separately.
import type { FileLoad } from '../../application/ports.js';
import type { Model } from '../../domain/model.js';
import { specViewModel } from './spec-view-model.js';
import { loadSpec } from './spec-loader.js';
import { readYaml } from './read-yaml.js';

export function loadModel(input: unknown): FileLoad<Model> {
  const loaded = loadSpec(input);
  if (!loaded.ok) return loaded;
  return { ok: true, value: specViewModel(loaded.value) };
}

export const yamlModelLoader: { load(file: string): FileLoad<Model> } = {
  load(file) {
    const read = readYaml(file);
    if (!read.ok) return { ok: false, fault: 'unreadable', errors: [{ path: '', message: read.error }] };
    return loadModel(read.value);
  },
};
