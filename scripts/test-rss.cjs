const { spawnSync } = require('node:child_process');
const python = process.env.OPENMIND_TEST_PYTHON || 'python3';
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests/rss', '-v'], { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
