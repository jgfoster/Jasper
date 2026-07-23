import * as fs from 'fs';
import * as path from 'path';

// Loads a refactoring webview script — plain JS that runs in the webview DOM and
// is deliberately NOT bundled into the extension (read at runtime, see the client
// workspace conventions). The scripts live in this `refactoring/` directory
// alongside their owning panels.
//
// The lookup has to work in two layouts:
//   • Bundled runtime — `extension.js` sits in `client/out/`, so `__dirname` is
//     `client/out` and the scripts are at `../src/refactoring/`.
//   • From source (unit tests, ts-node) — `__dirname` is `client/src/refactoring`
//     and the scripts sit right beside this module.
// We try the source-adjacent path first, then fall back to the bundled path (and
// let that path surface in the error if neither exists).
export function readRefactoringWebviewScript(fileName: string): string {
  const beside = path.join(__dirname, fileName);
  if (fs.existsSync(beside)) {
    return fs.readFileSync(beside, 'utf8');
  }
  return fs.readFileSync(path.join(__dirname, '..', 'src', 'refactoring', fileName), 'utf8');
}
