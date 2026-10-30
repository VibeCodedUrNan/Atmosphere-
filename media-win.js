// Now playing on Windows: media.ps1 asks Windows' media controls and prints one JSON report per second.
const { spawn } = require('child_process');
const path = require('path');

// In the built app the code is packed into app.asar, which PowerShell can't read from, so media.ps1 is
// kept outside it, in app.asar.unpacked (see "package" in package.json).
const SCRIPT = path.join(__dirname, 'media.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

exports.start = report => {
  let helper, stopped = false;
  const run = () => {
    helper = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true });
    let buf = '';
    helper.stdout.setEncoding('utf8'); // decodes characters split across chunks correctly
    helper.stdout.on('data', chunk => {
      buf += chunk;
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        report(m);
      }
    });
    helper.stderr.on('data', d => console.error('[media]', String(d)));
    helper.stdin.on('error', () => {}); // a write racing the helper's exit must not crash the app
    helper.on('error', e => console.error('[media]', e.message)); // e.g. powershell.exe missing; 'exit' still retries
    helper.on('exit', () => { if (!stopped) setTimeout(run, 3000); });
  };
  run();
  return {
    control: cmd => { if (helper?.exitCode === null) helper.stdin.write(cmd + '\n'); },
    stop: () => { stopped = true; helper?.stdin.end(); helper?.kill(); }, // media.ps1 exits when its input closes
  };
};
