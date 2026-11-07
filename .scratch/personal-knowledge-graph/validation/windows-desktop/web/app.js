const status = document.querySelector('#status');
const details = document.querySelector('#details');
document.querySelector('#roundtrip-form').addEventListener('submit', async event => {
  event.preventDefault();
  status.textContent = 'PENDING · Rust 调用中';
  try {
    const reply = await window.__TAURI__.core.invoke('issue3_roundtrip', {
      request: document.querySelector('#request').value
    });
    status.textContent = `Rust OK | ${reply.uppercase} | chars=${reply.charCount} | call=${reply.call} | pid=${reply.pid}`;
    details.textContent = JSON.stringify(reply, null, 2);
  } catch (error) {
    status.textContent = `Rust ERROR | ${error.code ?? 'IPC_FAILURE'} | ${error.message ?? String(error)} | call=${error.call ?? '?'} | pid=${error.pid ?? '?'}`;
    details.textContent = JSON.stringify(error, null, 2);
  }
});
