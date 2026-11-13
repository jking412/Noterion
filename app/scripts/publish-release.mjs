// Only the trusted release job receives GH_TOKEN. The check/PR job cannot call
// the Releases write API. Existing public releases are verified, never replaced.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const at = argument.indexOf('=');
  assert.ok(at > 2, 'Use --directory=... --driver=... --output=...');
  return [argument.slice(2, at), argument.slice(at + 1)];
}));
assert.ok(Object.keys(options).every(key => ['directory', 'driver', 'output'].includes(key)));
const directory = path.resolve(options.directory);
const output = path.resolve(options.output);
const scripts = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.GH_REPO;
const sha = process.env.SOURCE_SHA;
const ref = process.env.SOURCE_REF;
assert.equal(repo, 'jking412/Noterion', 'Release repository must be the trusted upstream');
assert.match(sha ?? '', /^[a-f0-9]{40}$/);
assert.ok(ref === 'refs/heads/main' || /^refs\/tags\/v\d+\.\d+\.\d+$/.test(ref ?? ''), 'Only main or a version tag may publish');
assert.ok(process.env.GH_TOKEN, 'Release job requires its scoped GitHub token');
await fs.mkdir(output); // Immutable per-attempt evidence; never reuse previous data.

function run(binary, args, input, env = process.env) {
  const result = spawnSync(binary, args, { input, env, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(binary)} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}
function api(route, method = 'GET', body) {
  const args = ['api', `repos/${repo}/${route}`, '--method', method];
  if (body !== undefined) args.push('--input', '-');
  const text = run('gh', args, body === undefined ? undefined : JSON.stringify(body));
  return text.trim() ? JSON.parse(text) : undefined;
}
function verify(input, extract) {
  return JSON.parse(run(process.execPath, [path.join(scripts, 'release.mjs'), 'verify', `--input=${input}`, `--commit=${sha}`, `--extract=${extract}`]));
}
async function summary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}
async function currentMain() {
  return api('git/ref/heads/main').object.sha === sha;
}
async function tagCommit(tag) {
  // The API may return either a lightweight ref or an annotated tag object.
  let object = api(`git/ref/tags/${encodeURIComponent(tag)}`).object;
  for (let depth = 0; object.type === 'tag' && depth < 8; depth++) object = api(`git/tags/${object.sha}`).object;
  assert.equal(object.type, 'commit', 'Release tag must resolve to a commit');
  return object.sha;
}
async function downloadDraft(tag, destination) {
  await fs.mkdir(destination);
  run('gh', ['release', 'download', tag, '--repo', repo, '--dir', destination]);
}
function smoke(extract, destination) {
  const { GH_TOKEN, GITHUB_TOKEN, ...clientEnvironment } = process.env;
  run(process.execPath, [path.join(scripts, 'release-smoke.mjs'), `--exe=${path.join(extract, 'noterion.exe')}`, `--driver=${path.resolve(options.driver)}`, `--output=${destination}`], undefined, clientEnvironment);
}

const candidate = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
assert.equal(candidate.commit, sha);
assert.equal(candidate.ref, ref);
assert.ok(candidate.profile === 'release', 'Only optimized release assets can publish');
const tag = candidate.tag;
assert.match(tag, /^[A-Za-z0-9.-]+$/);
const prerelease = ref === 'refs/heads/main';
if (!prerelease) {
  assert.equal(tag, ref.slice('refs/tags/'.length));
  assert.equal(await tagCommit(tag), sha, 'Version tag moved after checks');
  const comparison = api(`compare/${sha}...main`);
  assert.ok(['ahead', 'identical'].includes(comparison.status), 'Version tag must point to a commit reachable from main');
}

const releases = api('releases?per_page=100');
// Use the tag lookup for public versions, and the list for an unfinished draft.
// Pagination matters once the repository has more than 100 daily versions.
let release;
for (let page = 1; !release; page++) {
  const entries = page === 1 ? releases : api(`releases?per_page=100&page=${page}`);
  release = entries.find(item => item.tag_name === tag);
  if (entries.length < 100) break;
}

if (release && !release.draft) {
  assert.equal(await tagCommit(tag), sha, 'Published tag does not match checked commit');
  const downloaded = path.join(output, 'existing-assets');
  await downloadDraft(tag, downloaded);
  const original = JSON.parse(await fs.readFile(path.join(downloaded, 'manifest.json'), 'utf8'));
  assert.equal(original.commit, sha, 'A published version cannot be overwritten with another commit');
  assert.equal(original.tag, tag);
  const extract = path.join(output, 'existing-extracted');
  verify(downloaded, extract);
  smoke(extract, path.join(output, 'existing-client'));
  await summary(`Verified existing immutable release [${tag}](${release.html_url}) at ${sha}. Rerun published no duplicate and replaced no assets.`);
  process.exit(0);
}

// Historical public releases remain verifiable on rerun, even after main moves.
// Only a new publication must still be the current main commit.
if (prerelease && !(await currentMain())) {
  await summary(`Skipped obsolete main commit ${sha}; main has advanced. No release was published.`);
  process.exit(0);
}

verify(directory, path.join(output, 'candidate-extracted'));
const assets = (await fs.readdir(directory)).sort();
assert.equal(assets.length, 4, 'Release must contain exactly ZIP, manifest, README and SHA256SUMS');
const note = `Noterion ${candidate.version}\n\n` +
  `Source: https://github.com/${repo}/commit/${sha}\n\nBuild: ${candidate.runUrl}\n\n` +
  'Windows x64 portable ZIP. Extract into a writable directory, verify SHA256SUMS, then run noterion.exe. Microsoft Edge WebView2 Runtime is required.\n\n' +
  'Keep your complete data directory when upgrading; the application stores knowledge locally. This build is unsigned. The CI smoke verifies the embedded production UI and a real Rust save/restart/search operation. Full large-video/media and live AI-service acceptance are outside this smoke. See README.txt and manifest.json for provenance and usage.\n';
if (!release) {
  release = api('releases', 'POST', {
    tag_name: tag, target_commitish: sha, name: `Noterion ${candidate.version}`,
    body: note, draft: true, prerelease, make_latest: 'false',
  });
} else {
  assert.equal(release.target_commitish, sha, 'Unfinished release belongs to a different commit');
  assert.ok(release.draft);
  api(`releases/${release.id}`, 'PATCH', { name: `Noterion ${candidate.version}`, body: note, prerelease });
}

try {
  // Removing partial assets is safe only while the release is a private draft.
  const draft = api(`releases/${release.id}`);
  assert.equal(draft.draft, true, 'Never overwrite public assets');
  for (const asset of draft.assets) api(`releases/assets/${asset.id}`, 'DELETE');
  run('gh', ['release', 'upload', tag, '--repo', repo, ...assets.map(name => path.join(directory, name))]);
  const downloaded = path.join(output, 'uploaded-assets');
  await downloadDraft(tag, downloaded);
  for (const name of assets) {
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest(await fs.readFile(path.join(downloaded, name))), digest(await fs.readFile(path.join(directory, name))), `Uploaded asset differs: ${name}`);
  }
  const extract = path.join(output, 'uploaded-extracted');
  verify(downloaded, extract);
  smoke(extract, path.join(output, 'downloaded-client'));
  if (prerelease && !(await currentMain())) {
    await summary(`Kept ${tag} as an unpublished draft because main advanced during verification.`);
    process.exit(0);
  }
  const published = api(`releases/${release.id}`, 'PATCH', { draft: false, make_latest: prerelease ? 'false' : 'legacy' });
  assert.equal(published.draft, false);
  assert.equal(await tagCommit(tag), sha, 'Published tag must resolve to the checked commit');

  // Prove the final assets have public download URLs, without authenticating
  // the download. The downloaded bytes are the same ones already smoke-tested.
  const publicDirectory = path.join(output, 'public-assets');
  await fs.mkdir(publicDirectory);
  const publicRelease = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { signal: AbortSignal.timeout(30000) });
  assert.equal(publicRelease.status, 200, 'Published release must be publicly visible');
  const publicData = await publicRelease.json();
  assert.equal(publicData.assets.length, assets.length);
  for (const asset of publicData.assets) {
    assert.ok(assets.includes(asset.name));
    const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(90000) });
    assert.equal(response.status, 200, `Public asset download: ${asset.name}`);
    await fs.writeFile(path.join(publicDirectory, asset.name), Buffer.from(await response.arrayBuffer()));
  }
  verify(publicDirectory, path.join(output, 'public-extracted'));
  await fs.writeFile(path.join(output, 'release-result.json'), JSON.stringify({ passed: true, tag, sha, url: published.html_url, assets: published.assets.map(asset => ({ name: asset.name, url: asset.browser_download_url })) }, null, 2));
  await summary(`Published and publicly downloaded [${tag}](${published.html_url}) from checked commit ${sha}. SHA-256, embedded UI and real Rust persistence passed.`);
} catch (error) {
  // No incomplete release is exposed. In case a public visibility/download
  // check failed after publication, return the complete release to draft.
  try { api(`releases/${release.id}`, 'PATCH', { draft: true }); }
  catch (rollback) { console.error(`Could not return release to draft: ${rollback.message}`); }
  await fs.writeFile(path.join(output, 'release-result.json'), JSON.stringify({ passed: false, tag, sha, error: error.message }, null, 2));
  throw error;
}
