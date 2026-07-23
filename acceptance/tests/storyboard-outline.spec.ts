/**
 * Guards the storyboard's outline against drift.
 *
 * A directory may carry a `.contents.json` naming its own entries in reading
 * order, which buys editorial control at the cost of a second place to keep
 * current: add a feature and forget the file, and it quietly sorts to the end;
 * delete or rename one, and the entry silently matches nothing.
 *
 * Only directories that *have* an outline are held to it — a folder without one
 * has opted into alphabetical order and can't drift.
 *
 * This compares the *source* — what is on disk — rather than the run, because
 * the reporter only ever sees features that executed, so a filtered run would
 * look exactly like a missing entry.
 *
 * No browser: it reads files, so it costs nothing to run alongside the suite.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const featuresDir = path.resolve(__dirname, '..', 'features');
const CONTENTS_FILE = '.contents.json';

/** Every directory under features/, including features/ itself. */
function directories(dir: string = featuresDir): string[] {
  const nested = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => directories(path.join(dir, entry.name)));
  return [dir, ...nested];
}

/** The entries of `dir` an outline is expected to place. */
function orderable(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.name.endsWith('.feature'))
    .map((entry) => entry.name);
}

/** Directories that state an order, paired with what they place. */
function outlined(): { dir: string; where: string; listed: string[] }[] {
  return directories()
    .filter((dir) => fs.existsSync(path.join(dir, CONTENTS_FILE)))
    .map((dir) => ({
      dir,
      where: path.relative(featuresDir, path.join(dir, CONTENTS_FILE)) || CONTENTS_FILE,
      listed: JSON.parse(fs.readFileSync(path.join(dir, CONTENTS_FILE), 'utf8')).contents,
    }));
}

test.describe('a storyboard outline', () => {
  test('places everything in its own directory', () => {
    const unplaced = outlined().flatMap(({ dir, where, listed }) =>
      orderable(dir)
        .filter((entry) => !listed.includes(entry))
        .map((entry) => `${where} does not place ${entry}`),
    );

    expect(unplaced, 'entries missing from an outline').toEqual([]);
  });

  test('places only what is there', () => {
    const unknown = outlined().flatMap(({ dir, where, listed }) => {
      const present = orderable(dir);
      return listed
        .filter((entry: string) => !present.includes(entry))
        .map((entry: string) => `${where} places ${entry}, which does not exist`);
    });

    expect(unknown, 'outline entries matching nothing on disk').toEqual([]);
  });

  test('places each entry once', () => {
    const duplicated = outlined().flatMap(({ where, listed }) =>
      listed
        .filter((entry: string, at: number) => listed.indexOf(entry) !== at)
        .map((entry: string) => `${where} places ${entry} more than once`),
    );

    expect(duplicated, 'duplicate outline entries').toEqual([]);
  });
});
