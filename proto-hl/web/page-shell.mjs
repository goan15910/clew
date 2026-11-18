// Write a self-contained HTML page: inline the bundle so the page opens from disk.
import { readFileSync, writeFileSync } from 'node:fs';
export function page(out, title, head, body, scripts) {
  const inline = scripts.map((f) => `<script>\n${readFileSync(f, 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');
  writeFileSync(out, `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { --bg: #f6f7f9; --panel: #fff; --ink: #111827; --muted: #5b6472; --line: #e2e5ea; }
:root[data-theme="dark"] { --bg: #0f1115; --panel: #171a21; --ink: #e5e7eb; --muted: #9aa3b2; --line: #2a2f3a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 16px; }
h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin: 18px 0 6px; }
p.note { color: var(--muted); font-size: 13px; margin: 2px 0 10px; }
${head}
</style></head><body><main>${body}</main>
${inline}
</body></html>`);
}
