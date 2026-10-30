// Runs read() about once a second, one at a time, and hands each result to report(). wake() asks for the
// next read soon (after a control press) without starting a second loop. A read that hangs is given up
// after 5 s so polling never stalls; onError lets the caller reset its connection.
exports.startPolling = (read, report, onError = () => {}) => {
  let timer, busy = false, soon = false, stopped = false;
  async function tick() {
    busy = true;
    let out = { active: false };
    try {
      out = await Promise.race([read(), new Promise((_, fail) => setTimeout(() => fail(new Error('no answer from the player')), 5000))]);
    } catch (e) {
      console.error('[media]', e.message);
      onError();
    }
    report(out);
    busy = false;
    if (!stopped) timer = setTimeout(tick, soon ? 300 : 1000);
    soon = false;
  }
  tick();
  return {
    wake: () => { if (busy) soon = true; else { clearTimeout(timer); timer = setTimeout(tick, 300); } },
    stop: () => { stopped = true; clearTimeout(timer); },
  };
};
