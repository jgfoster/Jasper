import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Start the Seaside Zinc adaptor in a detached GemStone gem inside the
 * container and wait until it serves the Hello World page. `WAGsZincAdaptor
 * startOn:` blocks (it runs the scheduler loop that keeps the listener alive),
 * so it must live in its own topaz process. Requires the HelloSeaside project
 * to be loaded (its postload registers the app at /hello).
 *
 * Runs from the test's own process, which inherits GEMSTONE/PATH from
 * stone-entrypoint.sh — this is the "test drives it directly" path.
 */
export async function startSeasideServer(port: number): Promise<void> {
  const stone = process.env.JASPER_STONE_NAME;
  if (!stone) throw new Error('JASPER_STONE_NAME not set (not running in the stone container)');

  const scriptPath = path.join(os.tmpdir(), `seaside-serve-${port}.tpz`);
  fs.writeFileSync(
    scriptPath,
    [
      `set gemstone ${stone}`,
      'set user SystemUser',
      'set pass swordfish',
      'login',
      'run',
      `WAGsZincAdaptor startOn: ${port}.`,
      '%',
      '',
    ].join('\n'),
  );

  const logPath = path.join(os.tmpdir(), `seaside-serve-${port}.log`);
  const child = spawn('bash', ['-c', `topaz -l < ${scriptPath} > ${logPath} 2>&1`], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/hello`);
      if (res.ok) {
        const body = await res.text();
        if (body.includes('Hello World')) return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-1500) : '(no log)';
  throw new Error(`Seaside server on ${port} never served Hello World.\n${log}`);
}
