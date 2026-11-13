// Windows portable release boundary. No user data or development output directories are copied.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = 'x86_64-pc-windows-msvc';
const executableLimit = 512 * 1024 * 1024;
const sourceCommit = value => assert.match(value ?? '', /^[a-f0-9]{40}$/, 'SOURCE_SHA must be a full lowercase commit SHA');
const digest = async filename => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
};
const json = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));

function powershell(script, environment) {
  const result = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, ...environment }, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `Windows ZIP operation failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.replace(/^\uFEFF/, '').trim();
}

async function emptyDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
  assert.deepEqual(await fs.readdir(directory), [], `Output must be empty: ${directory}`);
}

async function removeTemporaryDirectory(directory) {
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('noterion-release-'));
  await fs.rm(directory, { recursive: true, force: true });
}

async function sourceVersion() {
  const packageJson = await json(path.join(app, 'package.json'));
  const npmLock = await json(path.join(app, 'package-lock.json'));
  const tauri = await json(path.join(app, 'src-tauri/tauri.conf.json'));
  const cargo = await fs.readFile(path.join(app, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoLock = await fs.readFile(path.join(app, 'src-tauri/Cargo.lock'), 'utf8');
  const cargoVersion = cargo.match(/^\[package\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/)?.[1].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const lockedVersion = cargoLock.split('[[package]]').find(block => /^name = "noterion"$/m.test(block))?.match(/^version = "([^"]+)"/m)?.[1];
  const version = packageJson.version;
  assert.match(version, /^\d+\.\d+\.\d+$/, 'Release source version must be MAJOR.MINOR.PATCH');
  for (const [name, actual] of Object.entries({ 'npm lock': npmLock.version, 'npm lock root': npmLock.packages?.['']?.version, Cargo: cargoVersion, 'Cargo lock': lockedVersion, Tauri: tauri.version })) {
    assert.equal(actual, version, `${name} version must match app/package.json (${version})`);
  }
  return version;
}

async function updateVersion(options) {
  const previous = await sourceVersion();
  const version = options.version;
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/, 'Use version --version=MAJOR.MINOR.PATCH');
  const updates = [];
  for (const filename of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
    const fullPath = path.join(app, filename);
    const content = await json(fullPath);
    content.version = version;
    if (filename === 'package-lock.json') content.packages[''].version = version;
    updates.push([fullPath, JSON.stringify(content, null, 2) + '\n']);
  }
  for (const [filename, expression] of [
    ['src-tauri/Cargo.toml', /(^\[package\]\r?\n[\s\S]*?^version\s*=\s*")[^"]+("[ \t]*\r?$)/m],
    ['src-tauri/Cargo.lock', /(^name = "noterion"\r?\nversion = ")[^"]+("[ \t]*\r?$)/m],
  ]) {
    const fullPath = path.join(app, filename);
    const content = await fs.readFile(fullPath, 'utf8');
    assert.ok(expression.test(content), `Cannot locate source version in ${filename}`);
    updates.push([fullPath, content.replace(expression, (_match, prefix, suffix) => prefix + version + suffix)]);
  }
  // All versions and replacement sites are validated before changing any file.
  for (const [filename, content] of updates) await fs.writeFile(filename, content, 'utf8');
  assert.equal(await sourceVersion(), version);
  return { previous, version, files: updates.map(([filename]) => path.relative(app, filename)) };
}

function identity(version, commit, ref) {
  sourceCommit(commit);
  assert.ok(typeof ref === 'string' && /^refs\/(heads|tags|pull)\/[A-Za-z0-9_./-]+$/.test(ref), 'SOURCE_REF must be an explicit Git ref');
  if (ref.startsWith('refs/tags/')) {
    assert.equal(ref, `refs/tags/v${version}`, 'Official tag must match the source version');
    return { version, tag: `v${version}`, prerelease: false };
  }
  const channel = ref === 'refs/heads/main' ? 'main' : 'ci';
  return { version: `${version}-${channel}.${commit.slice(0, 12)}`, tag: `${channel}-${commit}`, prerelease: true };
}

function checkManifest(manifest, expectedCommit) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.product, 'Noterion');
  sourceCommit(manifest.commit);
  assert.equal(manifest.commit, expectedCommit, 'Release commit differs from SOURCE_SHA');
  assert.match(manifest.sourceVersion ?? '', /^\d+\.\d+\.\d+$/);
  const expected = identity(manifest.sourceVersion, manifest.commit, manifest.ref);
  for (const [key, value] of Object.entries(expected)) assert.equal(manifest[key], value, `Invalid release ${key}`);
  assert.equal(manifest.target, target);
  assert.equal(manifest.profile, 'release');
  assert.match(manifest.runUrl ?? '', /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/);
  assert.equal(manifest.zip, `Noterion-${manifest.version}-windows-x64.zip`);
  assert.equal(manifest.executable?.name, 'noterion.exe');
  assert.match(manifest.executable.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(manifest.executable.size) && manifest.executable.size > 0 && manifest.executable.size <= executableLimit);
}

async function checkExecutable(filename) {
  const file = await fs.open(filename, 'r');
  try {
    const size = (await file.stat()).size;
    assert.ok(size >= 128 && size <= executableLimit, 'Invalid executable size');
    const header = Buffer.alloc(64);
    assert.equal((await file.read(header, 0, 64, 0)).bytesRead, 64);
    assert.equal(header.toString('ascii', 0, 2), 'MZ', 'Executable must be Windows PE');
    const offset = header.readUInt32LE(60);
    assert.ok(offset >= 64 && offset + 26 <= size, 'Invalid PE header offset');
    const pe = Buffer.alloc(26);
    assert.equal((await file.read(pe, 0, 26, offset)).bytesRead, 26);
    assert.deepEqual(pe.subarray(0, 4), Buffer.from([80, 69, 0, 0]), 'Missing PE signature');
    assert.equal(pe.readUInt16LE(4), 0x8664, 'Executable must target Windows x64');
    assert.equal(pe.readUInt16LE(24), 0x20b, 'Executable must be PE32+');
    return size;
  } finally { await file.close(); }
}

async function packageRelease(options) {
  assert.ok(options.exe && options.output, 'package requires --exe and --output');
  const commit = options.commit ?? process.env.SOURCE_SHA;
  const ref = options.ref ?? process.env.SOURCE_REF;
  const version = await sourceVersion();
  const manifest = {
    schemaVersion: 1, product: 'Noterion', sourceVersion: version, ...identity(version, commit, ref), commit, ref,
    runUrl: options['run-url'] ?? process.env.SOURCE_RUN_URL ?? process.env.RUN_URL,
    target, profile: 'release', executable: { name: 'noterion.exe', size: await checkExecutable(options.exe), sha256: await digest(options.exe) },
  };
  manifest.zip = `Noterion-${manifest.version}-windows-x64.zip`;
  checkManifest(manifest, commit);
  const output = path.resolve(options.output);
  await emptyDirectory(output);
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'noterion-release-package-'));
  try {
    await fs.copyFile(options.exe, path.join(stage, 'noterion.exe'));
    const readme = `Noterion ${manifest.version}\nSource version: ${version}\nCommit: ${commit}\nRef: ${ref}\nBuild: ${manifest.runUrl}\nTarget: Windows x64 (optimized release)\n\nExtract the complete ZIP into a writable folder, then double-click noterion.exe.\nRequires Windows x64 and Microsoft Edge WebView2 Runtime.\nWebView2: https://developer.microsoft.com/microsoft-edge/webview2/\nNo Vite, Node, Python, database server or object storage service is required to run.\nThe executable embeds the production interface.\n\nKnowledge and saved files are stored in a data directory. The default is data beside\nthe executable; an existing directory selection in the user profile takes precedence.\nUse the application's data-directory control to confirm the active location.\nBefore upgrading, close the app and back up the COMPLETE data directory. Extract the\nnew program separately; keep existing data and select it from the new program.\nNever replace an open database or remove the data directory during upgrade.\n\nThis portable release has no installer, auto-updater or purchased code-signing\ncertificate. Windows may display an unknown-publisher/SmartScreen prompt.\nSHA256SUMS verifies archive, manifest and this README; manifest.json records the\nexecutable's SHA-256. Verify downloads before starting the executable.\n\nRunner smoke covers startup, embedded interface and real Rust local persistence.\nIt does not certify all media codecs, 1-2 GB video playback, external AI providers\nor the full interactive desktop acceptance suite. No paid AI account is needed\nfor the standard CI checks.\n`;
    await fs.writeFile(path.join(stage, 'README.txt'), readme, 'utf8');
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    powershell(`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream=[IO.File]::Create($env:NOTERION_RELEASE_ZIP)
try {
  $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
  try {
    foreach($name in @('noterion.exe','README.txt','manifest.json')) {
      $entry=$archive.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime=[DateTimeOffset]::new(2000,1,1,0,0,0,[TimeSpan]::Zero)
      $input=[IO.File]::OpenRead((Join-Path $env:NOTERION_RELEASE_STAGE $name))
      $destination=$entry.Open()
      try { $input.CopyTo($destination) } finally { $destination.Dispose(); $input.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally { $stream.Dispose() }`, { NOTERION_RELEASE_STAGE: stage, NOTERION_RELEASE_ZIP: path.join(output, manifest.zip) });
    for (const name of ['manifest.json', 'README.txt']) await fs.copyFile(path.join(stage, name), path.join(output, name));
    const checksums = [];
    for (const name of [manifest.zip, 'manifest.json', 'README.txt']) checksums.push(`${await digest(path.join(output, name))}  ${name}`);
    await fs.writeFile(path.join(output, 'SHA256SUMS'), checksums.join('\n') + '\n', 'utf8');
    return { ...manifest, directory: output, assets: [manifest.zip, 'manifest.json', 'README.txt', 'SHA256SUMS'] };
  } finally { await removeTemporaryDirectory(stage); }
}

async function verifyRelease(options) {
  const directory = path.resolve(options.directory ?? options.input ?? '');
  assert.ok(options.directory || options.input, 'verify requires --directory');
  assert.ok(options.extract, 'verify requires --extract');
  const expectedCommit = options.commit ?? process.env.SOURCE_SHA;
  sourceCommit(expectedCommit);
  const manifest = await json(path.join(directory, 'manifest.json'));
  checkManifest(manifest, expectedCommit);
  const assets = ['README.txt', 'SHA256SUMS', 'manifest.json', manifest.zip].sort();
  assert.deepEqual((await fs.readdir(directory)).sort(), assets, 'Release assets must match the exact allowlist');
  for (const name of assets) assert.ok((await fs.lstat(path.join(directory, name))).isFile(), 'Assets must be regular files');
  const sums = (await fs.readFile(path.join(directory, 'SHA256SUMS'), 'utf8')).trim().split(/\r?\n/);
  assert.equal(sums.length, 3, 'SHA256SUMS must cover exactly the archive, manifest and README');
  const expectedNames = new Set([manifest.zip, 'manifest.json', 'README.txt']);
  for (const line of sums) {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/);
    assert.ok(match && expectedNames.delete(match[2]), 'Invalid, duplicate or unexpected checksum entry');
    assert.equal(await digest(path.join(directory, match[2])), match[1], `SHA-256 mismatch: ${match[2]}`);
  }
  assert.equal(expectedNames.size, 0);
  const extract = path.resolve(options.extract);
  await emptyDirectory(extract);
  powershell(`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($env:NOTERION_RELEASE_ZIP)
try {
  $entries=@($archive.Entries)
  if($entries.Count -ne 3) { throw 'ZIP must contain exactly three files' }
  foreach($name in @('noterion.exe','README.txt','manifest.json')) {
    if(@($entries | Where-Object { $_.FullName -ceq $name }).Count -ne 1) { throw 'Unexpected ZIP path or duplicate entry' }
  }
  foreach($entry in $entries) {
    if($entry.Name -ceq 'noterion.exe') {
      if($entry.Length -ne [long]$env:NOTERION_RELEASE_EXE_SIZE) { throw 'ZIP executable length mismatch' }
    } elseif($entry.Length -gt 1048576) { throw 'ZIP metadata too large' }
  }
} finally { $archive.Dispose() }
Expand-Archive -LiteralPath $env:NOTERION_RELEASE_ZIP -DestinationPath $env:NOTERION_RELEASE_EXTRACT`, {
    NOTERION_RELEASE_ZIP: path.join(directory, manifest.zip), NOTERION_RELEASE_EXTRACT: extract, NOTERION_RELEASE_EXE_SIZE: String(manifest.executable.size),
  });
  assert.deepEqual((await fs.readdir(extract)).sort(), ['README.txt', 'manifest.json', 'noterion.exe']);
  for (const name of ['manifest.json', 'README.txt']) {
    assert.deepEqual(await fs.readFile(path.join(extract, name)), await fs.readFile(path.join(directory, name)), `ZIP ${name} differs from published metadata`);
  }
  const exe = path.join(extract, 'noterion.exe');
  assert.equal(await checkExecutable(exe), manifest.executable.size);
  assert.equal(await digest(exe), manifest.executable.sha256, 'Executable SHA-256 mismatch');
  return { ...manifest, directory, extract, exe };
}

try {
  assert.equal(process.platform, 'win32', 'Portable release packaging requires Windows');
  const [command, ...arguments_] = process.argv.slice(2);
  const options = {};
  for (const argument of arguments_) {
    const match = argument.match(/^--([a-z-]+)=(.+)$/);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Use unique --name=value arguments');
    options[match[1]] = match[2];
  }
  assert.ok(Object.keys(options).every(key => ['exe', 'output', 'directory', 'input', 'extract', 'commit', 'ref', 'run-url', 'version'].includes(key)), 'Unknown option');
  const result = command === 'package' ? await packageRelease(options) : command === 'verify' ? await verifyRelease(options) : command === 'version' ? await updateVersion(options) : assert.fail('Use package, verify or version');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
