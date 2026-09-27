// Runs all end-to-end suites against the built app (npm run build first). On Linux run under xvfb-run.
import { spawnSync } from 'node:child_process';

let failed = 0;
for (const suite of ['tests/e2e/scenario.mjs', 'tests/e2e/tour.mjs', 'tests/e2e/toolbar-qa.mjs']) {
  console.log(`\n=== ${suite} ===`);
  const r = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
