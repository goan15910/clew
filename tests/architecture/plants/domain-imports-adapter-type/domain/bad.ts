// Planted violation: a type-only import still crosses the layer.
import type { Leak } from '../adapters/leak.js';

export type Alias = Leak;
