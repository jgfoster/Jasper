import { RowanCatalogEntry } from './rowanCatalog';

// Smalltalk single-quoted string escaping (this builds a Smalltalk expression,
// not STON): a literal quote is doubled. STON strings escape with backslashes
// instead — don't reuse this for .ston content.
function q(s: string): string {
  return s.replace(/'/g, "''");
}

// The idiomatic Smalltalk to load a catalogue entry's Metacello baseline into a
// GemStone stone. Run as DataCurator. It brings Grease/Metacello current (the
// documented prerequisite), then GsDeployer-wraps a Metacello baseline load from
// the entry's repository — GsDeployer handles class migration and the commit,
// and Metacello fetches the Tonel from the repository gem-side.
//
// `loads` narrows to specific Metacello groups; 'default' (or none) loads the
// baseline's default group.
export function metacelloLoadExpression(entry: RowanCatalogEntry): string {
  const groups = entry.loads.filter((g) => g && g !== 'default');
  const loadMsg = groups.length ? `load: #(${groups.map((g) => `'${q(g)}'`).join(' ')})` : 'load';
  return [
    `"Load ${entry.name} (Metacello baseline '${entry.baseline}') into this stone.`,
    ` Run as DataCurator; fetches from GitHub gem-side and may take a few minutes."`,
    '',
    'Gofer new',
    "\tpackage: 'GsUpgrader-Core';",
    "\turl: 'http://ss3.gemtalksystems.com/ss/gsUpgrader';",
    '\tload.',
    '(Smalltalk at: #GsUpgrader) upgradeGrease.',
    '',
    'GsDeployer deploy: [',
    '\tMetacello new',
    `\t\tbaseline: '${q(entry.baseline)}';`,
    `\t\trepository: '${q(entry.repository)}';`,
    '\t\tonLock: [:ex | ex honor];',
    `\t\t${loadMsg} ].`,
  ].join('\n');
}
