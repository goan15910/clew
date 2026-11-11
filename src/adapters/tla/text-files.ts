// TLA+ modules and TLC configs as plain text files. Clew never reads stdin or writes stdout here.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TextFiles } from '../../application/ports.js';

export const tlaTextFiles: TextFiles = {
  exists(file) {
    return existsSync(file);
  },
  read(file) {
    if (file === '-') return { ok: false, message: 'Clew does not read stdin; pass a .tla file' };
    try {
      return { ok: true, text: readFileSync(file, 'utf8') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `cannot read ${file}: ${message}` };
    }
  },
  write(file, text) {
    const directory = dirname(file);
    if (directory !== '' && !existsSync(directory)) return { ok: false, message: `cannot write ${file}: directory does not exist` };
    try {
      writeFileSync(file, text);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `cannot write ${file}: ${message}` };
    }
  },
};
