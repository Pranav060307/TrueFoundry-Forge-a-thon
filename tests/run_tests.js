const esbuild = require('esbuild');
const path = require('path');

async function run() {
  const testFiles = ['test_client.mjs', 'test_diff_engine.mjs'];

  for (const testFile of testFiles) {
    const outfile = path.join(__dirname, '..', 'dist', `bundle_${testFile.replace('.mjs', '.js')}`);
    await esbuild.build({
      entryPoints: [path.join(__dirname, testFile)],
      bundle: true,
      platform: 'node',
      outfile: outfile,
    });
    console.log(`\n========================================`);
    console.log(`Running: ${testFile}`);
    console.log(`========================================`);
    require(outfile);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
