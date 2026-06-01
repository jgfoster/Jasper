import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { SysadminStorage } from './sysadminStorage';
import { GemStoneDatabase, GemStoneProcess } from './sysadminTypes';
import { appendSysadmin, showSysadmin } from './sysadminChannel';
import { needsWsl, windowsPathToWsl, wslSpawn, wslExecSync } from './wslBridge';

export interface StaleLockReport {
  /** Path to the .LCK file on the host filesystem (a WSL path under Windows). */
  lockPath: string;
  /** True when we believe the lock is orphaned and safe to remove. */
  safe: boolean;
  /** One-line explanation suitable for a confirmation dialog. */
  reason: string;
  /** Current command line `ps` reports for the recorded PID, when known. */
  currentPidOwner?: string;
}

/** Classify what `ps -p <pid> -o command=` returned. Exported so the safety
 *  rule can be tested without spawning a shell.
 *
 *  Inputs:
 *   - psOutput: trimmed stdout from `ps -p <pid> -o command= 2>/dev/null || echo GONE`
 *   - stoneName: process name from gslist; used as a corroborating signal
 *               (it appears as the last arg of the stoned/netldid command line). */
export function classifyPidOwnership(
  psOutput: string,
  stoneName: string,
): { pidGone: boolean; isGemStoneServer: boolean; command: string } {
  const command = psOutput.trim();
  if (command === '' || command === 'GONE') {
    return { pidGone: true, isGemStoneServer: false, command: '' };
  }
  // Real stoned/netldid processes have one of those tokens as the executable
  // basename (matched at a word boundary so unrelated apps like
  // "ssh-agent" or "iTunesHelper" do not get a false positive).
  const lowered = command.toLowerCase();
  const looksLikeServer = /(?:^|[\/\s])(?:stoned|netldid)(?:\s|$)/.test(lowered);
  return { pidGone: false, isGemStoneServer: looksLikeServer, command };
}

/** Decide whether a gslist-reported version matches a database's configured
 *  version. They usually come from different sources (the gslist Version column
 *  vs. the version parsed out of the product directory name), so we treat them
 *  as matching when the shorter one is a dotted-component prefix of the longer
 *  (e.g. "3.7.4" matches "3.7.4.3"). This keeps genuinely different installs —
 *  "3.6.2" vs "3.7.5" — distinct, which is what lets the Databases panel tie a
 *  running stone to the version that actually started it. Exported for testing. */
export function versionsMatch(a: string, b: string): boolean {
  const as = a.split('.');
  const bs = b.split('.');
  const shared = Math.min(as.length, bs.length);
  for (let i = 0; i < shared; i++) {
    if (as[i] !== bs[i]) return false;
  }
  return shared > 0;
}

/** Parse `gslist -cvl` output into structured process records.
 *  Exported for testing. Lines that don't match the data-row format
 *  (header, separator, info lines, blanks) are silently skipped. */
export function parseGslist(output: string): GemStoneProcess[] {
  const processes: GemStoneProcess[] = [];
  for (const line of output.split('\n')) {
    // Data row: {status}  {version}  {owner}  {pid} {port} {month} {day} {time} {type}  {name}
    // Status can be one word ("OK", "frozen", "killed", "exists", "unknown(EPERM)")
    // or two ("exe deleted"). We anchor on the version, which always starts with a digit,
    // so the non-greedy first capture absorbs the status without eating into version.
    const match = line.match(
      /^\s*(\S+(?: \S+)?)\s+(\d[\d.]*)\s+\S+\s+(\d+)\s+(\d+)\s+(\w+\s+\d+\s+[\d:]+)\s+(Stone|Netldi)\s+(.+)$/i,
    );
    if (!match) continue;
    const typeLower = match[6].toLowerCase();
    if (typeLower !== 'stone' && typeLower !== 'netldi') continue;
    const type = typeLower === 'stone' ? 'stone' : 'netldi';
    const status = match[1].trim();
    const proc: GemStoneProcess = {
      type,
      version: match[2],
      pid: parseInt(match[3], 10),
      name: match[7].trim(),
      startTime: match[5],
      status,
      responding: status.toUpperCase() === 'OK',
    };
    if (type === 'netldi') {
      proc.port = parseInt(match[4], 10);
    }
    processes.push(proc);
  }
  return processes;
}

export class ProcessManager {
  private cachedProcesses: GemStoneProcess[] = [];

  constructor(private storage: SysadminStorage) {}

  getProcesses(): GemStoneProcess[] {
    return this.cachedProcesses;
  }

  /** Run gslist -cvl and parse output */
  refreshProcesses(): GemStoneProcess[] {
    const gslistPath = this.findGslist();
    if (!gslistPath) {
      this.cachedProcesses = [];
      return [];
    }
    try {
      const gsPath = gslistPath.replace(/\/bin\/gslist$/, '');
      const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
      const env: Record<string, string> = {
        GEMSTONE: gsPath,
        PATH: `${gsPath}/bin:/usr/local/bin:/usr/bin:/bin`,
        GEMSTONE_GLOBAL_DIR: rootPath,
      };
      if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = `${gsPath}/lib`;
      } else {
        env.LD_LIBRARY_PATH = `${gsPath}/lib`;
      }
      const output = wslExecSync(`"${gslistPath}" -cvl`, env);
      this.cachedProcesses = parseGslist(output);
    } catch {
      this.cachedProcesses = [];
    }
    return this.cachedProcesses;
  }

  /** Determine whether the .LCK file for a stale process appears safe to remove.
   *  Safe = recorded PID is gone, or has been reused by some non-GemStone process.
   *  Unsafe = a real stoned/netldid is still running under that PID (a genuinely
   *  hung server that the operator should investigate, not auto-clean). */
  inspectStaleLock(proc: GemStoneProcess): StaleLockReport {
    const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
    const lockPath = `${rootPath}/locks/${proc.name}..LCK`;
    let psOutput = '';
    try {
      // `|| echo GONE` collapses the "no such pid" exit into stdout so we get
      // one branch to parse instead of catching and decoding errno strings.
      psOutput = wslExecSync(`ps -p ${proc.pid} -o command= 2>/dev/null || echo GONE`).trim();
    } catch {
      // execSync threw before producing output — likely no shell or ps. Treat
      // as inconclusive; the safer default is to refuse.
      return {
        lockPath,
        safe: false,
        reason: `Could not check PID ${proc.pid} (ps unavailable). Refusing to delete the lock.`,
      };
    }
    const ownership = classifyPidOwnership(psOutput, proc.name);
    if (ownership.pidGone) {
      return {
        lockPath,
        safe: true,
        reason: `PID ${proc.pid} no longer exists. The lock file is orphaned.`,
      };
    }
    if (ownership.isGemStoneServer) {
      return {
        lockPath,
        safe: false,
        reason: `PID ${proc.pid} is still a running GemStone server (${ownership.command}). Use stopstone instead.`,
        currentPidOwner: ownership.command,
      };
    }
    return {
      lockPath,
      safe: true,
      reason: `PID ${proc.pid} has been reused by an unrelated process (${ownership.command}). The lock file is orphaned.`,
      currentPidOwner: ownership.command,
    };
  }

  /** Delete the .LCK file at `lockPath`. Returns true on success.
   *  Callers must inspect safety first; this method does not re-check. */
  deleteStaleLock(lockPath: string): boolean {
    try {
      wslExecSync(`rm -f "${lockPath.replace(/"/g, '\\"')}"`);
      return true;
    } catch {
      return false;
    }
  }

  private findGslist(): string | undefined {
    // Look for gslist in any extracted version
    const versions = this.storage.getExtractedVersions();
    for (const version of versions) {
      const gsPath = needsWsl()
        ? this.storage.getWslGemstonePath(version)
        : this.storage.getGemstonePath(version);
      if (gsPath) {
        const gslistPath = `${gsPath}/bin/gslist`;
        try {
          wslExecSync(`test -x "${gslistPath}"`);
          return gslistPath;
        } catch {
          continue;
        }
      }
    }
    return undefined;
  }

  private getEnvironment(db: GemStoneDatabase): Record<string, string> {
    const gsPath = needsWsl()
      ? this.storage.getWslGemstonePath(db.config.version)
      : this.storage.getGemstonePath(db.config.version);
    if (!gsPath) throw new Error(`GemStone ${db.config.version} not found. Please extract it first.`);
    const dbPath = needsWsl() ? windowsPathToWsl(db.path) : db.path;
    const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
    const env: Record<string, string> = {
      GEMSTONE: gsPath,
      GEMSTONE_SYS_CONF: `${dbPath}/conf`,
      GEMSTONE_GLOBAL_DIR: rootPath,
      GEMSTONE_LOG: `${dbPath}/log/${db.config.stoneName}.log`,
      GEMSTONE_EXE_CONF: `${dbPath}/conf`,
      GEMSTONE_NRS_ALL: `#netldi:${db.config.ldiName}#dir:${dbPath}#log:${dbPath}/log/%N_%P.log`,
      PATH: `${gsPath}/bin:/usr/local/bin:/usr/bin:/bin`,
    };
    if (process.platform === 'darwin') {
      env.DYLD_LIBRARY_PATH = `${gsPath}/lib`;
    } else {
      env.LD_LIBRARY_PATH = `${gsPath}/lib`;
    }
    env.MANPATH = `${gsPath}/doc`;
    return env;
  }

  /** Start a stone */
  async startStone(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    const dbPath = needsWsl() ? windowsPathToWsl(db.path) : db.path;
    const logPath = `${dbPath}/log/${db.config.stoneName}.log`;
    return this.runCommand(
      `${gsPath}/bin/startstone`,
      ['-l', logPath, db.config.stoneName],
      env,
      `Starting stone ${db.config.stoneName}`,
    );
  }

  /** Stop a stone */
  async stopStone(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    return this.runCommand(
      `${gsPath}/bin/stopstone`,
      [db.config.stoneName, 'DataCurator', 'swordfish'],
      env,
      `Stopping stone ${db.config.stoneName}`,
    );
  }

  /** Start NetLDI */
  async startNetldi(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    const dbPath = needsWsl() ? windowsPathToWsl(db.path) : db.path;
    const logPath = `${dbPath}/log/${db.config.ldiName}.log`;
    const user = needsWsl()
      ? wslExecSync('whoami').trim()
      : os.userInfo().username;
    return this.runCommand(
      `${gsPath}/bin/startnetldi`,
      ['-a', user, '-g', '-l', logPath, db.config.ldiName],
      env,
      `Starting NetLDI ${db.config.ldiName}`,
    );
  }

  /** Stop NetLDI */
  async stopNetldi(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    return this.runCommand(
      `${gsPath}/bin/stopnetldi`,
      [db.config.ldiName],
      env,
      `Stopping NetLDI ${db.config.ldiName}`,
    );
  }

  /** Open a terminal with GemStone environment */
  openTerminal(db: GemStoneDatabase): void {
    const env = this.getEnvironment(db);
    if (needsWsl()) {
      const dbPath = windowsPathToWsl(db.path);
      const envExports = Object.entries(env)
        .map(([k, v]) => `export ${k}='${v}'`)
        .join('; ');
      const terminal = vscode.window.createTerminal({
        name: `GemStone: ${db.config.stoneName}`,
        shellPath: 'wsl.exe',
        shellArgs: ['-e', 'bash'],
      });
      terminal.show();
      terminal.sendText(`cd '${dbPath}' && ${envExports} && exec bash`);
    } else {
      const terminal = vscode.window.createTerminal({
        name: `GemStone: ${db.config.stoneName}`,
        env,
        cwd: db.path,
      });
      terminal.show();
    }
  }

  private runCommand(
    cmd: string,
    args: string[],
    env: Record<string, string>,
    label: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      appendSysadmin(`\n--- ${label} ---`);
      showSysadmin();
      const proc = wslSpawn(cmd, args, env);
      let output = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        appendSysadmin(text.trimEnd());
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        appendSysadmin(text.trimEnd());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`${label} failed (exit code ${code})\n${output}`));
        } else {
          resolve(output);
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`${label} failed: ${err.message}`));
      });
    });
  }

  /** Check if a stone is running for the given version. Name alone is ambiguous
   *  when two installed versions share a stone name, so the version must match
   *  too (see versionsMatch). */
  isStoneRunning(stoneName: string, version: string): boolean {
    return this.cachedProcesses.some(
      p => p.type === 'stone' && p.name === stoneName && versionsMatch(p.version, version),
    );
  }

  /** Check if a netldi is running for the given version. See isStoneRunning. */
  isNetldiRunning(ldiName: string, version: string): boolean {
    return this.cachedProcesses.some(
      p => p.type === 'netldi' && p.name === ldiName && versionsMatch(p.version, version),
    );
  }
}
