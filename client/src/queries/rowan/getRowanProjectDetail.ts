import { QueryExecutor } from '../types';
import { escapeString } from '../util';

export interface RowanProjectDetail {
  found: boolean;
  name: string;
  isDirty: boolean;
  isCommitted: boolean;
  loadedCommitId: string;
  commitId: string;
  useGit: boolean;
  branch: string;
  repositoryRootPath: string;
  gitUrl: string;
  remote: string;
  revision: string;
  packageConvention: string;
  defaultSymbolDict: string;
  conditionalAttributes: string[];
  components: string[];
  packageCount: number;
  comment: string;
}

const COMMENT_MARKER = '@@COMMENT@@';

function emptyDetail(name: string): RowanProjectDetail {
  return {
    found: false, name, isDirty: false, isCommitted: false, loadedCommitId: '',
    commitId: '', useGit: false, branch: '', repositoryRootPath: '', gitUrl: '',
    remote: '', revision: '', packageConvention: '', defaultSymbolDict: '',
    conditionalAttributes: [], components: [], packageCount: 0, comment: '',
  };
}

// Full metadata + load-recipe (config/spec) for a loaded Rowan project, for the
// browser's project context pane. Every field is error-guarded; the multi-line
// comment trails a @@COMMENT@@ marker. List-valued fields (components,
// conditional attributes) are comma-joined.
export function getRowanProjectDetail(execute: QueryExecutor, projectName: string): RowanProjectDetail {
  const esc = escapeString(projectName);
  const code = `| r img proj ws join |
r := System myUserProfile symbolList objectNamed: #'Rowan'.
r isNil ifTrue: [^''].
img := r image.
proj := [img loadedProjectNamed: '${esc}'] on: Error do: [:e | nil].
proj isNil ifTrue: [^''].
ws := WriteStream on: Unicode7 new.
join := [:coll | | s |
  s := WriteStream on: String new.
  coll asSortedCollection asArray doWithIndex: [:x :i | i > 1 ifTrue: [s nextPutAll: ', ']. s nextPutAll: x asString].
  s contents].
ws nextPutAll: 'name'; tab; nextPutAll: ([proj name] on: Error do: [:e | '${esc}']) asString; lf.
ws nextPutAll: 'isDirty'; tab; nextPutAll: ([proj isDirty] on: Error do: [:e | false]) printString; lf.
ws nextPutAll: 'isCommitted'; tab; nextPutAll: ([proj isCommitted] on: Error do: [:e | false]) printString; lf.
ws nextPutAll: 'loadedCommitId'; tab; nextPutAll: ([proj loadedCommitId] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'commitId'; tab; nextPutAll: ([proj commitId] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'useGit'; tab; nextPutAll: ([proj useGit] on: Error do: [:e | false]) printString; lf.
ws nextPutAll: 'branch'; tab; nextPutAll: ([proj currentBranchName] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'repositoryRootPath'; tab; nextPutAll: ([proj repositoryRootPath] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'gitUrl'; tab; nextPutAll: ([proj gitUrl] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'remote'; tab; nextPutAll: ([proj remote] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'revision'; tab; nextPutAll: ([proj revision] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'packageConvention'; tab; nextPutAll: ([proj packageConvention] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'defaultSymbolDict'; tab; nextPutAll: ([proj gemstoneDefaultSymbolDictName] on: Error do: [:e | '']) asString; lf.
ws nextPutAll: 'conditionalAttributes'; tab; nextPutAll: ([join value: proj conditionalAttributes] on: Error do: [:e | '']); lf.
ws nextPutAll: 'components'; tab; nextPutAll: ([join value: proj componentNames] on: Error do: [:e | '']); lf.
ws nextPutAll: 'packageCount'; tab; nextPutAll: ([proj loadedPackages size] on: Error do: [:e | 0]) printString; lf.
ws nextPutAll: '${COMMENT_MARKER}'; lf.
ws nextPutAll: ([proj comment] on: Error do: [:e | '']) asString.
ws contents`;

  const raw = execute(`getRowanProjectDetail(project: ${projectName})`, code);
  if (raw.trim().length === 0) return emptyDetail(projectName);

  const markerIdx = raw.indexOf(`\n${COMMENT_MARKER}\n`);
  const scalarBlock = markerIdx === -1 ? raw : raw.slice(0, markerIdx);
  const comment = markerIdx === -1 ? '' : raw.slice(markerIdx + COMMENT_MARKER.length + 2);

  const map = new Map<string, string>();
  for (const line of scalarBlock.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  const list = (key: string) =>
    (map.get(key) ?? '').split(',').map(s => s.trim()).filter(s => s.length > 0);

  return {
    found: true,
    name: map.get('name') || projectName,
    isDirty: map.get('isDirty') === 'true',
    isCommitted: map.get('isCommitted') === 'true',
    loadedCommitId: map.get('loadedCommitId') ?? '',
    commitId: map.get('commitId') ?? '',
    useGit: map.get('useGit') === 'true',
    branch: map.get('branch') ?? '',
    repositoryRootPath: map.get('repositoryRootPath') ?? '',
    gitUrl: map.get('gitUrl') ?? '',
    remote: map.get('remote') ?? '',
    revision: map.get('revision') ?? '',
    packageConvention: map.get('packageConvention') ?? '',
    defaultSymbolDict: map.get('defaultSymbolDict') ?? '',
    conditionalAttributes: list('conditionalAttributes'),
    components: list('components'),
    packageCount: parseInt(map.get('packageCount') ?? '0', 10) || 0,
    comment,
  };
}
