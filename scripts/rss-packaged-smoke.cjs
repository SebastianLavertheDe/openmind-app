/* Installed-distribution smoke: no DISPLAY, system Python or sibling repositories. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const briefLabels = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/rss/fixtures/brief-labels.json'), 'utf8')).en;
const sourceMode = process.argv[2] === '--source';
const appRoot = sourceMode ? path.resolve(__dirname, '..') : path.resolve(process.argv[2] || 'dist/linux-arm64-unpacked');
const binary = sourceMode ? process.execPath : path.join(appRoot, 'openmind-desktop');
const resources = path.join(appRoot, 'resources');
const compiled = sourceMode ? path.join(appRoot, '.build/electron/electron') : path.join(resources, 'app.asar', '.build', 'electron', 'electron');
const skillLibrary = sourceMode ? path.join(appRoot, '.build/skill-library') : path.join(resources, 'skill-library');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'openmind-rss-packaged-'));
const content = path.join(fixture, 'content'), userData = path.join(fixture, 'user-data');
fs.mkdirSync(content);
const env = { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '', ELECTRON_RUN_AS_NODE: '1' };
if (sourceMode) env.OPENMIND_NODE_EXECUTABLE = process.execPath;
delete env.OPENMIND_SKILL_LIBRARY_BUNDLE;
delete env.OPENMIND_PYTHON_RUNTIME_ASSET_ROOT;
const outputs = [];
function run(args, executable = binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`Packaged command failed (${code}): ${stderr}\n${stdout}`)));
  });
}
const common = ['--root', content, '--user-data', userData];
const cli = (...args) => run([...args, ...common, ...(args[0] === 'runtime' || args[0] === 'x' ? [] : ['--date', '20261027'])], path.join(resources, 'cli', 'openmind'));
const providerCalls = [];
const server = http.createServer((request, response) => {
  if (request.url === '/v1/chat/completions') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        assert.equal(request.headers.authorization, 'Bearer fixture-only');
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'fixture-model');
        const prompt = payload.messages.map(message => message.content).join('\n');
        providerCalls.push(prompt);
        let answer;
        if (prompt.includes('SOURCE:\n')) {
          const source = JSON.parse(prompt.split('SOURCE:\n')[1]);
          const science = source.title.toLowerCase().includes('science');
          answer = { keep: science === prompt.includes('Science only'), translated_title: source.title, summary: 'English research summary', key_points: ['Evidence'], category: science ? 'Science' : 'Design', score: 90, reason: 'Matches the saved preference' };
        } else answer = { items: [{ index: 1, reason: 'Relevant evidence' }], document: briefLabels };
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
      } catch (error) { response.statusCode = 400; response.end(String(error)); }
    });
    return;
  }
  setTimeout(() => { response.setHeader('content-type', 'application/rss+xml'); response.end(`<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Fixture</title><link>http://127.0.0.1/</link><item><guid>stable-guid</guid><title>Product design research</title><link>http://127.0.0.1/article</link><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Researchers tested three interfaces with sixty participants. The simpler design reduced completion errors.</p>]]></content:encoded></item></channel></rss>`); }, 300);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/feed`;
  console.log('Preparing the installed bundled Python runtime in temporary userData…');
  console.log(await cli('runtime', 'prepare', '--scheduled'));
  const pythonRoot = path.join(userData, 'runtimes/environments/shared-python');
  const state = JSON.parse(fs.readFileSync(path.join(pythonRoot, 'state.json')));
  const python = path.join(pythonRoot, 'generations', state.currentFingerprint, '.venv/bin/python');
  const catalog = JSON.parse(fs.readFileSync(path.join(skillLibrary, 'catalog.json')));
  const native = catalog.skills.filter(entry => entry.packageDirectory);
  assert.equal(native.length, 15);
  assert.ok(!native.some(entry => entry.id === 'knowledge-wiki-compiler'));
  const entrypoints = [];
  for (const entry of native) {
    const packageRoot = path.join(skillLibrary, entry.id);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'openmind.skill.yaml')));
    if (manifest.kind === 'process') {
      await run([path.join(packageRoot, manifest.entrypoint.script), '--help'], python);
      entrypoints.push(entry.id);
    }
  }
  assert.equal(entrypoints.length, 11);
  const data = path.join(content, '.agent/skill-data/rss-article-saver'); fs.mkdirSync(data, { recursive: true });
  const sourceFixture = { id: 'fixture', name: 'Fixture', inputUrl: url, kind: 'feed', resolvedFeedUrl: url, adapterId: 'feed', enabled: true, presetId: null, revision: 1, group: '', tags: [], lastAttemptAt: null, lastSuccessAt: null, lastError: null, itemCount: 0, feedRevision: 0 };
  // A result larger than one stdout chunk must remain machine-readable.
  const disabledSources = Array.from({ length: 1024 }, (_, index) => ({ ...sourceFixture, id: 'disabled-' + index, inputUrl: url + '?source=' + index, enabled: false }));
  fs.writeFileSync(path.join(data, 'sources.json'), JSON.stringify({ schemaVersion: 1, initialized: true, revision: 1, deletedPresetIds: [], migrationWarnings: [], sources: [sourceFixture, ...disabledSources] }));
  outputs.push(JSON.parse((await cli('rss', 'sync')).trim()));
  outputs.push(JSON.parse((await cli('rss', 'collect')).trim()));
  // Another broker opening the same history must not recover a live CLI run.
  const observer = run(['-e', `const {RunStore}=require(${JSON.stringify(compiled + '/execution/run-store.js')}); const store=new RunStore(${JSON.stringify(path.join(userData, 'runs'))}); let n=0; const timer=setInterval(()=>{if(store.recoverInterrupted().length) process.exitCode=1; if(++n===80) clearInterval(timer);},50);`]);
  outputs.push(...(await Promise.all([cli('rss', 'pipeline'), cli('rss', 'pipeline')])).map(text => JSON.parse(text.trim())));
  await observer;
  assert.ok(outputs.every(row => row.status === 'succeeded'));
  assert.ok(outputs.every(row => row.result?.results?.length === 1025), 'large JSON results survive stdout chunk boundaries');
  const articles = fs.readdirSync(path.join(content, 'article', '20261027')).filter(name => name.endsWith('.md'));
  assert.equal(articles.length, 1, 'concurrent app/CLI collection must not duplicate content');
  const source = JSON.parse(fs.readFileSync(path.join(content, '.agent/skill-data/rss-article-saver/sources.json'))).sources[0];
  assert.equal(source.itemCount, 1); assert.equal(source.lastError, null);
  assert.match(fs.readFileSync(path.join(content, '.agent/skill-data/rss-article-saver/feeds', source.id + '.xml'), 'utf8'), /stable-guid/);
  // A local synthetic provider verifies desktop config -> broker environment ->
  // packaged Python -> preferences -> documents, without a real API key or model.
  fs.writeFileSync(path.join(content, 'article/20261027/science.md'), '# Science measurements\nA controlled experiment compared observations with a mathematical model.\n');
  fs.mkdirSync(path.join(content, 'config'));
  fs.writeFileSync(path.join(content, 'config/providers.yaml'), JSON.stringify({ schemaVersion: 1, default: 'fixture', providers: [{ id: 'fixture', name: 'Fixture', enabled: true, protocol: 'openai-chat', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-model', proxyPolicy: 'disabled' }] }));
  const runCount = fs.readdirSync(path.join(userData, 'runs')).length;
  for (const area of ['reddit', 'x']) {
    const result = JSON.parse((await cli(area, 'collect', '--check')).trim());
    assert.equal(result.status, 'ready');
    assert.equal(result.skillId, area === 'reddit' ? 'reddit-fetcher' : 'x-following-fetcher');
  }
  assert.equal(fs.readdirSync(path.join(userData, 'runs')).length, runCount, 'checks must not submit collection runs');
  const preferencesDirectory = path.join(content, '.agent/preferences');
  fs.mkdirSync(preferencesDirectory, { recursive: true });
  const savePreferences = (revision, text) => fs.writeFileSync(path.join(preferencesDirectory, 'daily-brief.json'), JSON.stringify({ schemaVersion: 1, revision, text, updatedAt: null }));
  savePreferences(1, 'Design only, exclude science, English, at most 1 item');
  const first = JSON.parse((await cli('brief', 'generate')).trim()); outputs.push(first);
  assert.equal(first.result.selected, 1); assert.equal(first.result.preferencesRevision, 1);
  const summaryPath = path.join(content, first.result.path);
  const initialSummary = fs.readFileSync(summaryPath, 'utf8');
  assert.match(initialSummary, /### Product design research/); assert.doesNotMatch(initialSummary, /### Science measurements/);
  assert.match(initialSummary, /# 20261027 Daily summary/);
  assert.doesNotMatch(initialSummary, /[\u4e00-\u9fff]/, 'English preferences apply to document labels as well as model prose');
  const callsBefore = providerCalls.length;
  const chain = (await cli('rss', 'pipeline', '--summarize')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(chain.map(row => row.skillId), ['rss-article-saver', 'daily-article-summarizer']);
  outputs.push(...chain);
  outputs.push(JSON.parse((await cli('brief', 'generate')).trim()));
  assert.equal(providerCalls.length, callsBefore, 'identical inputs reuse the model cache');
  savePreferences(2, 'Science only, exclude design, English, at most 1 item');
  const topic = JSON.parse((await cli('brief', 'generate', '--topics')).trim()); outputs.push(topic);
  assert.equal(topic.result.selected, 1); assert.equal(topic.result.preferencesRevision, 2);
  const topicText = fs.readFileSync(path.join(content, topic.result.path), 'utf8');
  assert.match(topicText, /### Science measurements/); assert.doesNotMatch(topicText, /### Product design research/);
  assert.match(topicText, /openmind-topics/);
  assert.match(topicText, /# 20261027 Daily topics/);
  assert.doesNotMatch(topicText, /[\u4e00-\u9fff]/);
  assert.ok(providerCalls.length > callsBefore, 'changed preferences invalidate model cache');
  outputs.push(JSON.parse((await cli('brief', 'generate')).trim()));
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /### Science measurements/);
  const versions = path.join(content, 'daily-summary/.versions/20261027');
  assert.ok(fs.readdirSync(versions).some(file => fs.readFileSync(path.join(versions, file), 'utf8') === initialSummary), 'previous output is retained when preferences change');
  assert.ok(outputs.every(row => row.status === 'succeeded'));
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, noDisplay: true, runtime: 'bundled Python', nativePackages: native.length, processEntrypoints: entrypoints, runs: outputs.map(row => ({ id: row.runId, status: row.status })), savedArticles: articles.length, sourceResultsPerRun: 1025, concurrentHistoryPreserved: true, localProviderRequests: providerCalls.length, preferenceCacheAndVersions: true }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server.close(); if (process.env.OPENMIND_KEEP_SMOKE_FIXTURE) console.log('Fixture: ' + fixture); else fs.rmSync(fixture, { recursive: true, force: true }); });
