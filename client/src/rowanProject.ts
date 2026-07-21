import * as fs from 'fs';
import * as path from 'path';
import { findRowanLoadSpecs } from './rowanLoad';

// A package inside a Rowan project: a directory of Tonel/filetree class files
// under the project's packages root.
export interface RowanProjectPackage {
  name: string;
  // Absolute path to the package directory.
  path: string;
}

// The Rowan project rooted at an open workspace folder, read from disk. This is
// the *disk* lens — no stone/session is involved (Rowan authoring runs against a
// solo extent). Loading it into an image ("known to the stone") is separate.
export interface RowanWorkspaceProject {
  // Absolute path to the project root (the workspace folder).
  root: string;
  // Absolute path to rowan/project.ston.
  specPath: string;
  // Display name — from the sole load spec, else the folder basename (see below).
  name: string;
  // Where package source lives, relative to root ('src' for V3, 'rowan/src' for
  // the older self-hosting V2 layout). Read from #packagesPath, never assumed.
  packagesPath: string;
  // Relative paths declared in the project spec, when present.
  componentsPath?: string;
  specsPath?: string;
  packageFormat?: string;
  packageConvention?: string;
  // The project's packages (immediate subdirectories of packagesPath), sorted.
  packages: RowanProjectPackage[];
}

// A project's on-disk marker: the project spec at rowan/project.ston.
const PROJECT_SPEC_FILE = path.join('rowan', 'project.ston');
// The spec's content signature. Matched as a prefix so RwProjectSpecificationV2
// and a future V3 both qualify.
const PROJECT_SPEC_SIGNATURE = 'RwProjectSpecification';
// RwProjectSpecificationV3 defaults packages to the project root's src/; the
// older V2 self-hosting layout uses rowan/src. Only used when #packagesPath is
// absent.
const DEFAULT_PACKAGES_PATH = 'src';
const DEFAULT_SPECS_PATH = 'rowan/specs';

// Pull a single-quoted STON field value (`#key : 'value'`) by pattern, matching
// how rowanLoad.ts reads #specName — the specs are small flat dictionaries and a
// full STON parse would be overkill here.
function field(content: string, key: string): string | undefined {
  const m = content.match(new RegExp(`#${key}\\s*:\\s*'([^']*)'`));
  return m ? m[1] : undefined;
}

// True when `root` looks like a Rowan project: it has a rowan/project.ston.
export function isRowanProjectRoot(root: string): boolean {
  return fs.existsSync(path.join(root, PROJECT_SPEC_FILE));
}

// The package directories under `packagesRoot` (the immediate subdirectories —
// package source, not the sibling properties.st file). Empty when the directory
// is absent or unreadable.
function listPackages(packagesRoot: string): RowanProjectPackage[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: path.join(packagesRoot, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Read the Rowan project rooted at `root`, or null when `root` is not a Rowan
// project (no readable rowan/project.ston, or the file isn't a project spec).
export function readRowanWorkspaceProject(root: string): RowanWorkspaceProject | null {
  const specPath = path.join(root, PROJECT_SPEC_FILE);
  let content: string;
  try {
    content = fs.readFileSync(specPath, 'utf8');
  } catch {
    return null;
  }
  if (!content.trimStart().startsWith(PROJECT_SPEC_SIGNATURE)) return null;

  const packagesPath = field(content, 'packagesPath') ?? DEFAULT_PACKAGES_PATH;
  const componentsPath = field(content, 'componentsPath');
  const specsPath = field(content, 'specsPath');
  const packageFormat = field(content, 'packageFormat');
  const packageConvention = field(content, 'packageConvention');

  // project.ston's #specName is the literal 'project' for every project, so it
  // can't name the project. The load spec (rowan/specs/<Name>.ston) carries the
  // real name in its own #specName — reuse findRowanLoadSpecs, scoped to the
  // specs dir so its depth-5 walk can't reach into nested checkouts. With more
  // than one spec (or none), fall back to the folder name rather than guess.
  const specs = findRowanLoadSpecs(path.join(root, specsPath ?? DEFAULT_SPECS_PATH));
  const name = specs.length === 1 ? specs[0].name : path.basename(root);

  return {
    root,
    specPath,
    name,
    packagesPath,
    componentsPath,
    specsPath,
    packageFormat,
    packageConvention,
    packages: listPackages(path.join(root, packagesPath)),
  };
}
