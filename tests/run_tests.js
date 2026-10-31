const esbuild = require('esbuild');
const path = require('path');

async function run() {
  const outfile = path.join(__dirname, '..', 'dist', 'test_bundle.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'test_client.mjs')],
    bundle: true,
    platform: 'node',
    outfile: outfile,
  });
  console.log('Build succeeded:', outfile);
  require(outfile);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

