import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

export interface RowanLoadSpec {
  // Absolute path to the load-spec .ston file.
  path: string;
  // The spec's #specName (its project name), or the file basename as a fallback.
  name: string;
}

// A load spec's on-disk marker: RwLoadSpecificationV2 STON files start with this.
const LOAD_SPEC_SIGNATURE = 'RwLoadSpecificationV2';
const MAX_DEPTH = 5;

// Find every Rowan load specification under `root`, identified by content
// signature rather than a fixed path — the specs directory varies by layout
// (`specsV2/` for a shipped project, `rowan/specs/` for a freshly created one).
// Lets the loader accept a project's root folder and locate its load spec(s).
export function findRowanLoadSpecs(root: string): RowanLoadSpec[] {
  const specs: RowanLoadSpec[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.ston')) {
        let content: string;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        if (content.trimStart().startsWith(LOAD_SPEC_SIGNATURE)) {
          const m = content.match(/#specName\s*:\s*'([^']*)'/);
          specs.push({ path: full, name: m ? m[1] : path.basename(entry.name, '.ston') });
        }
      }
    }
  };

  walk(root, 0);
  specs.sort((a, b) => a.name.localeCompare(b.name));
  return specs;
}

// The default local directory name `git clone <url>` would produce: the last
// path segment of the URL with a trailing `.git` removed. Handles scp-style
// (git@host:owner/repo.git), https, and file URLs.
export function deriveRepoName(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const segment = trimmed.split(/[/:]/).pop() || '';
  return segment.replace(/\.git$/i, '') || 'project';
}

// Where Jasper clones tracked Rowan repositories: a `repos/` folder inside the
// extension's global storage. Global (not workspace) storage matches where the
// repo registry lives — a tracked repo stays available across windows and
// stones. The default clone location so the user isn't asked to pick a folder.
export function rowanClonesDir(globalStoragePath: string): string {
  const dir = path.join(globalStoragePath, 'repos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Clone a git repository to `dest` using the user's own git (so their SSH keys /
// credential helper apply — a gem-side clone wouldn't have them). Submodules are
// cloned too: a Rowan project may vendor its package sources that way (e.g.
// seaside-rowan), and without them the checkout is unloadable. Rejects with
// git's stderr on failure.
export function cloneGitRepo(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', ['clone', '--recurse-submodules', url, dest], { timeout: 300_000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error((stderr && stderr.trim()) || err.message));
      else resolve();
    });
  });
}
