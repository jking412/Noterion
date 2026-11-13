import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('./release.mjs', import.meta.url));
const commit = '0123456789abcdef0123456789abcdef01234567';
const fixture = path.join(process.env.SystemRoot, 'System32', 'whoami.exe');
const metadata = { SOURCE_SHA: commit, SOURCE_REF: 'refs/heads/main', SOURCE_RUN_URL: 'https://github.com/jking412/Noterion/actions/runs/1234' };

function run(command, options = [], environment = {}) {
  return spawnSync(process.execPath, [cli, command, ...options], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, ...metadata, ...environment },
  });
}

async function withDirectory(operation) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noterion-release-test-'));
  try { await operation(root); }
  finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('noterion-release-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('portable delivery can be packaged, independently verified and extracted with source identity', async () => {
  await withDirectory(async root => {
    const assets = path.join(root, 'assets');
    const packaged = run('package', [`--exe=${fixture}`, `--output=${assets}`]);
    assert.equal(packaged.status, 0, packaged.stderr);
    const manifest = JSON.parse(await fs.readFile(path.join(assets, 'manifest.json'), 'utf8'));
    assert.equal(manifest.commit, commit);
    assert.equal(manifest.version, `0.1.0-main.${commit.slice(0, 12)}`);
    assert.equal(manifest.tag, `main-${commit}`);
    assert.equal(manifest.prerelease, true);
    assert.equal(manifest.target, 'x86_64-pc-windows-msvc');
    const extracted = path.join(root, 'extracted');
    const verified = run('verify', [`--directory=${assets}`, `--extract=${extracted}`]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual(await fs.readFile(path.join(extracted, 'noterion.exe')), await fs.readFile(fixture));
    assert.deepEqual((await fs.readdir(extracted)).sort(), ['README.txt', 'manifest.json', 'noterion.exe']);
    assert.deepEqual((await fs.readdir(assets)).sort(), ['README.txt', 'SHA256SUMS', 'manifest.json', manifest.zip].sort());
  });
});

test('download verification rejects corrupted assets and a different source commit', async () => {
  await withDirectory(async root => {
    const assets = path.join(root, 'assets');
    const packaged = run('package', [`--exe=${fixture}`, `--output=${assets}`]);
    assert.equal(packaged.status, 0, packaged.stderr);
    const wrongCommit = run('verify', [`--directory=${assets}`, `--extract=${path.join(root, 'wrong-source')}`], { SOURCE_SHA: 'f'.repeat(40) });
    assert.notEqual(wrongCommit.status, 0);
    assert.match(wrongCommit.stderr, /Release commit differs/);
    await fs.appendFile(path.join(assets, 'README.txt'), 'tampered');
    const corrupted = run('verify', [`--directory=${assets}`, `--extract=${path.join(root, 'corrupt')}`]);
    assert.notEqual(corrupted.status, 0);
    assert.match(corrupted.stderr, /SHA-256 mismatch: README.txt/);
    await assert.rejects(fs.access(path.join(root, 'corrupt', 'noterion.exe')));
  });
});

test('PR delivery is a distinct CI candidate and official tag must equal the source version', async () => {
  await withDirectory(async root => {
    const candidate = run('package', [`--exe=${fixture}`, `--output=${path.join(root, 'pr')}`], { SOURCE_REF: 'refs/pull/23/merge' });
    assert.equal(candidate.status, 0, candidate.stderr);
    const manifest = JSON.parse(candidate.stdout);
    assert.equal(manifest.tag, `ci-${commit}`);
    assert.equal(manifest.version, `0.1.0-ci.${commit.slice(0, 12)}`);
    const wrongTag = run('package', [`--exe=${fixture}`, `--output=${path.join(root, 'bad-tag')}`], { SOURCE_REF: 'refs/tags/v9.9.9' });
    assert.notEqual(wrongTag.status, 0);
    assert.match(wrongTag.stderr, /Official tag must match/);
    const official = run('package', [`--exe=${fixture}`, `--output=${path.join(root, 'official')}`], { SOURCE_REF: 'refs/tags/v0.1.0' });
    assert.equal(official.status, 0, official.stderr);
    assert.equal(JSON.parse(official.stdout).prerelease, false);
    assert.equal(JSON.parse(official.stdout).version, '0.1.0');
  });
});

test('one version command synchronizes all source manifests and refuses a conflicting starting state', async () => {
  await withDirectory(async root => {
    const copy = path.join(root, 'app');
    const app = fileURLToPath(new URL('..', import.meta.url));
    const files = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json', 'scripts/release.mjs'];
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(copy, file)), { recursive: true });
      await fs.copyFile(path.join(app, file), path.join(copy, file));
    }
    const copiedCli = path.join(copy, 'scripts/release.mjs');
    const changed = spawnSync(process.execPath, [copiedCli, 'version', '--version=0.2.0'], { encoding: 'utf8', windowsHide: true });
    assert.equal(changed.status, 0, changed.stderr);
    const pkg = JSON.parse(await fs.readFile(path.join(copy, 'package.json'), 'utf8'));
    const lock = JSON.parse(await fs.readFile(path.join(copy, 'package-lock.json'), 'utf8'));
    const tauri = JSON.parse(await fs.readFile(path.join(copy, 'src-tauri/tauri.conf.json'), 'utf8'));
    assert.equal(pkg.version, '0.2.0'); assert.equal(lock.version, '0.2.0');
    assert.equal(lock.packages[''].version, '0.2.0'); assert.equal(tauri.version, '0.2.0');
    assert.match(await fs.readFile(path.join(copy, 'src-tauri/Cargo.toml'), 'utf8'), /\[package\]\r?\nname = "noterion"\r?\nversion = "0.2.0"/);
    assert.match(await fs.readFile(path.join(copy, 'src-tauri/Cargo.lock'), 'utf8'), /name = "noterion"\r?\nversion = "0.2.0"/);
    tauri.version = '0.3.0';
    await fs.writeFile(path.join(copy, 'src-tauri/tauri.conf.json'), JSON.stringify(tauri));
    const before = await Promise.all(files.map(file => fs.readFile(path.join(copy, file))));
    const conflict = spawnSync(process.execPath, [copiedCli, 'version', '--version=0.4.0'], { encoding: 'utf8', windowsHide: true });
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /Tauri version must match/);
    const after = await Promise.all(files.map(file => fs.readFile(path.join(copy, file))));
    assert.deepEqual(after, before, 'Conflict must be detected before modifying any manifest');
  });
});
