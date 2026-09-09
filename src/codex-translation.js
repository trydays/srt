const { StringDecoder } = require('node:string_decoder');

// Codex's turn.completed is the completion boundary; process exit is cleanup.
function translateCodex(execFile, file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let message;
    let outcome;
    let terminateTimer;
    let killTimer;
    let deadline;
    const failure = () => new Error('Codex completion protocol failed');
    const child = execFile(file, args, {
      timeout: 0, maxBuffer: 1024 * 1024, windowsHide: true
    }, () => {});

    function finish(error) {
      if (outcome) return;
      outcome = { error, message };
      clearTimeout(deadline);
      // Allow normal teardown, then bound cleanup even if SIGTERM is ignored.
      terminateTimer = setTimeout(() => {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 250);
      }, error ? 0 : 250);
    }

    function consume(line) {
      if (outcome || !line.trim()) return;
      if (Buffer.byteLength(line) > 256 * 1024) return finish(failure());
      let event;
      try { event = JSON.parse(line); } catch { return finish(failure()); }
      if (!event || typeof event.type !== 'string') return finish(failure());
      // Codex also emits `error` while reconnecting. Only a terminal turn
      // event, an incomplete process exit, or the original deadline ends a turn.
      if (event.type === 'turn.failed') return finish(failure());
      if (event.type === 'error') return;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        if (typeof event.item.text !== 'string' || Buffer.byteLength(event.item.text) > 64 * 1024) {
          return finish(failure());
        }
        message = event.item.text;
      }
      if (event.type === 'turn.completed') finish(message?.trim() ? null : failure());
    }

    child.stdout.on('data', (chunk) => {
      if (outcome) return;
      pending += decoder.write(chunk);
      let newline;
      while (!outcome && (newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        consume(line);
      }
      if (!outcome && Buffer.byteLength(pending) > 256 * 1024) finish(failure());
    });
    child.on('error', () => finish(failure()));
    child.on('close', () => {
      if (!outcome) consume(pending + decoder.end());
      clearTimeout(deadline);
      clearTimeout(terminateTimer);
      clearTimeout(killTimer);
      if (outcome && !outcome.error) resolve(outcome.message);
      else reject(outcome?.error || failure());
    });
    deadline = setTimeout(() => finish(Object.assign(new Error('Codex turn timed out'), {
      code: 'ETIMEDOUT'
    })), timeoutMs);
    child.stdin.end();
  });
}

module.exports = { translateCodex };
