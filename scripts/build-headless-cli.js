const path = require('node:path');
const esbuild = require('esbuild');
// Shared services also expose desktop-only operations. Their Electron imports
// use this explicit adapter in the CLI bundle; invoking a GUI operation fails.
esbuild.buildSync({
  entryPoints: [path.resolve('electron/cli/openmind.ts')],
  outfile: path.resolve('.build/electron/electron/cli/openmind.js'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
  alias: { electron: path.resolve('electron/cli/headless-electron.cjs') },
  logLevel: 'info'
});
