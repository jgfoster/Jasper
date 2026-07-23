import * as fs from 'fs';
import * as path from 'path';

// A dependency on another Rowan project, referenced either by git URL (with a
// revision) or by a local directory. Rowan models both as an
// RwLoadSpecificationV2 under rowan/projects/, with exactly one repo field set
// (#gitUrl or #diskUrl) — see RwLoadSpecificationV2's "only one of (gitUrl
// diskUrl …)" rule.
export interface GitDependency {
  kind: 'git';
  name: string;
  gitUrl: string;
  // A branch, tag, or commit. Rowan requires a revision for a non-file URL.
  revision: string;
}

export interface DiskDependency {
  kind: 'disk';
  name: string;
  // An absolute path to a Rowan project on disk.
  diskUrl: string;
}

export type ProjectDependency = GitDependency | DiskDependency;

export interface AddDependencyResult {
  success: boolean;
  // Absolute path to the reference spec written under rowan/projects/.
  referenceFile?: string;
  // True when a reference by this name already existed (it's overwritten).
  alreadyPresent?: boolean;
  error?: string;
}

// STON single-quoted string escaping, matching GemStone's STONWriter: a
// backslash escapes a literal backslash and a literal quote (not Smalltalk-style
// quote doubling). Escape the backslash first so an escaped quote isn't
// re-escaped.
function escapeStonString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// The inverse: a backslash escapes whatever follows it.
function unescapeStonString(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

// Read a single-quoted STON field (`#key : 'value'`), honouring the backslash
// escapes escapeStonString writes — so a value containing a quote reads back
// whole rather than truncating at it.
function stonField(content: string, key: string): string | undefined {
  const m = new RegExp(`#${key}\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'`).exec(content);
  return m ? unescapeStonString(m[1]) : undefined;
}

// Where a dependency's reference spec lives. The file is the dependency's
// record on disk, so it is also what git tracks — and therefore what a view row
// points at to pick up git's own decorations.
export function dependencyReferenceFile(projectRoot: string, name: string): string {
  return path.join(projectRoot, 'rowan', 'projects', `${name}.ston`);
}

// Read one reference spec. Null when it can't be read, names no project, or
// names no repository to fetch the project from — Rowan needs exactly one of
// #gitUrl / #diskUrl, so a spec with neither describes no dependency we can show.
function readDependency(file: string): ProjectDependency | null {
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const name = stonField(content, 'projectName') ?? stonField(content, 'specName');
  if (!name) return null;

  const gitUrl = stonField(content, 'gitUrl');
  if (gitUrl) {
    return { kind: 'git', name, gitUrl, revision: stonField(content, 'revision') ?? '' };
  }
  const diskUrl = stonField(content, 'diskUrl');
  return diskUrl ? { kind: 'disk', name, diskUrl } : null;
}

// The dependencies declared by the Rowan project at `projectRoot`, sorted by
// name. Pure disk — the inverse of addProjectDependency, and like it, no stone
// required. Empty when the project declares none or isn't a project at all.
export function readProjectDependencies(projectRoot: string): ProjectDependency[] {
  const projectsDir = path.join(projectRoot, 'rowan', 'projects');
  let entries: string[];
  try {
    entries = fs.readdirSync(projectsDir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.ston'))
    .map((e) => readDependency(path.join(projectsDir, e)))
    .filter((d): d is ProjectDependency => d !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The project name Rowan would use for a git dependency: the repository's basename,
// minus a trailing `.git`. Handles https, ssh (git@host:owner/repo), and git://.
export function dependencyNameFromGitUrl(url: string): string {
  const cleaned = url
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const segment = cleaned.split(/[/:]/).pop() ?? '';
  return segment || 'dependency';
}

function referenceSton(dep: ProjectDependency): string {
  const lines = [
    'RwLoadSpecificationV2 {',
    `\t#specName : '${escapeStonString(dep.name)}',`,
    `\t#projectName : '${escapeStonString(dep.name)}',`,
  ];
  if (dep.kind === 'git') {
    lines.push(`\t#gitUrl : '${escapeStonString(dep.gitUrl)}',`);
    lines.push(`\t#revision : '${escapeStonString(dep.revision)}',`);
  } else {
    lines.push(`\t#diskUrl : '${escapeStonString(dep.diskUrl)}',`);
  }
  lines.push(
    "\t#projectSpecFile : 'rowan/project.ston',",
    '\t#componentNames : [',
    "\t\t'Core'",
    '\t],',
    '\t#platformProperties : {',
    "\t\t'gemstone' : {",
    "\t\t\t'allusers' : {",
    "\t\t\t\t#defaultSymbolDictName : 'UserGlobals'",
    '\t\t\t}',
    '\t\t}',
    '\t},',
    "\t#comment : ''",
    '}',
  );
  return lines.join('\n');
}

// Add `name` to a component's #projectNames array so the dependency actually
// loads with the component. Returns the component unchanged when it's already
// listed, or null when the field can't be found. Names are simple identifiers,
// so existing entries are left as-is and only the new one is escaped.
function addProjectNameToComponent(componentSton: string, name: string): string | null {
  const arrayMatch = componentSton.match(/#projectNames\s*:\s*\[([\s\S]*?)\]/);
  if (!arrayMatch) return null;
  const existing = [...arrayMatch[1].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((m) => m[1]);
  if (existing.includes(name)) return componentSton;
  const rendered = [...existing, escapeStonString(name)].map((n) => `\t\t'${n}'`).join(',\n');
  return componentSton.replace(
    /#projectNames\s*:\s*\[[\s\S]*?\]/,
    `#projectNames : [\n${rendered}\n\t]`,
  );
}

// Add a project dependency to the Rowan project at `projectRoot`: write its
// reference spec under rowan/projects/, and list it in the component's
// #projectNames so it loads. Pure disk — no stone required.
export function addProjectDependency(
  projectRoot: string,
  dep: ProjectDependency,
  componentName = 'Core',
): AddDependencyResult {
  const projectsDir = path.join(projectRoot, 'rowan', 'projects');
  const referenceFile = dependencyReferenceFile(projectRoot, dep.name);
  const componentFile = path.join(projectRoot, 'rowan', 'components', `${componentName}.ston`);
  if (!fs.existsSync(componentFile)) {
    return {
      success: false,
      error: `Rowan component "${componentName}" not found at ${componentFile}.`,
    };
  }
  try {
    const alreadyPresent = fs.existsSync(referenceFile);

    const wired = addProjectNameToComponent(fs.readFileSync(componentFile, 'utf8'), dep.name);
    if (wired === null) {
      return { success: false, error: `Could not find #projectNames in ${componentName}.ston.` };
    }

    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(referenceFile, referenceSton(dep));
    fs.writeFileSync(componentFile, wired);

    return { success: true, referenceFile, alreadyPresent };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
