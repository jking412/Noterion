// Test credentials stay in process memory, outside argv and evidence files.
export async function readTestCredential(options) {
  if (options.stdin !== 'true') return process.env.NOTERION_DEEPSEEK_KEY ?? '';
  if (!process.stdin.isTTY) throw new Error('Secret input requires a private terminal');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise(resolve => {
    let buffer = '';
    const read = bytes => {
      buffer += bytes.toString('utf8');
      if (/[\r\n]/.test(buffer)) {
        process.stdin.off('data', read);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(buffer.trim());
      }
    };
    process.stdin.on('data', read);
  });
}
