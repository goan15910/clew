// Planted violation: `@plants/adapters/*` is a tsconfig path, not a relative import.
import { leak } from '@plants/adapters/leak.js';

export const value = leak;
