// Runs every suite. `node tests/all.mjs`
//
// Two halves, deliberately separate: progression.test.mjs proves the rules are
// right, ui.test.mjs proves the app actually applies them. Every bug that ever
// reached a browser here was in the second half.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';

const dir = dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
