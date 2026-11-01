const esbuild = require('esbuild');
const path = require('path');

async function run() {
  const testSuites = [
    { file: 'test_client.mjs', label: 'Engine Test: TrueForge Client SSE Parser & Delta Merger' },
    { file: 'test_diff_engine.mjs', label: 'Engine Test: Myers Diff Algorithm, Hunk Assembly & Rollback' },
    { file: 'test_task_a.mjs', label: 'Engine Verification: Task A Diff Computation, Patching & Rollback' },
    { file: 'test_task_b.mjs', label: 'Engine Verification: Task B Multi-File Diff Engine & Masking Logic' },
    { file: 'test_task_c.mjs', label: 'Engine Verification: ModelFailoverManager Resilience & Routing' },
  ];

  console.log(`================================================================`);
  console.log(`TrueForge Coding Agent - Engine Unit & Algorithmic Test Suites`);
  console.log(`(Verifies engine diff computation, state safety, and failover logic)`);
  console.log(`================================================================`);

  for (const suite of testSuites) {
    const outfile = path.join(__dirname, '..', 'dist', `bundle_${suite.file.replace('.mjs', '.js')}`);
    await esbuild.build({
      entryPoints: [path.join(__dirname, suite.file)],
      bundle: true,
      platform: 'node',
      outfile: outfile,
    });
    console.log(`\n========================================`);
    console.log(`Running: ${suite.label} (${suite.file})`);
    console.log(`========================================`);
    require(outfile);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
