/**
 * A Playwright reporter that writes the run as a storyboard: every scenario in
 * order, every step, and under each step the actions it took paired with the
 * screenshot taken right after them.
 *
 * Playwright's own HTML report is a debugging tool — it files the pictures a
 * step behind a disclosure triangle, which is the wrong shape for reading the
 * suite as a description of the product.
 *
 * This file only gathers data. Everything about how the page *looks* lives in
 * `storyboard.html`, which is a working standalone page: the reporter injects
 * the run into its `<script type="application/json">` placeholder and writes
 * the result. Edit the template to restyle the report; no need to touch
 * TypeScript or re-run a build.
 *
 * It reports the run, not the source: the actions are the ones Playwright
 * recorded, so a step cannot claim to have done something it did not do.
 *
 * UNRESOLVED — reading a failure. The storyboard is built for a green run: a
 * scenario appears because it passed, so nothing is badged. A failed scenario
 * currently shows only a status pill and the frames captured before it died,
 * with no error, no diff, and no indication of which step gave way; the
 * Playwright HTML report beside it remains the only usable account. Deciding
 * how a failure should read here — and whether this page is even the right
 * place to read one — is still to do.
 */
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { MARKS, FRAME_SEPARATOR } from '../helpers/marks';

/**
 * One thing the run did, and whether it acted on the window or checked it —
 * the same distinction the frame's rings draw, so a sentence and the control it
 * is about are the same colour.
 */
/**
 * 'act' and 'check' name a control the frame rings, and take its colour.
 * 'plain' is for the rest — a keystroke has no control to point at, and a
 * check that something is *gone* has nothing left to ring. Colouring those
 * would promise a mark the picture cannot show.
 */
type ActionKind = 'act' | 'check' | 'plain';

interface StoryboardAction {
  text: string;
  kind: ActionKind;
}

interface StoryboardFrame {
  /** The moment within the step, or '' for the frame taken once it finished. */
  label: string;
  /** What the run did between the previous frame and this one. */
  actions: StoryboardAction[];
  image: string;
}

interface StoryboardStep {
  keyword: string;
  title: string;
  /**
   * What the step's ring is coloured with, so the sentence can be written in
   * the same colour. A reader pairs a sentence with the ring below it by
   * colour, so the pairing has to be on the sentence they actually read — the
   * step — not only on the sub-line describing the moment.
   */
  kind: ActionKind;
  frames: StoryboardFrame[];
}

interface StoryboardScenario {
  name: string;
  status: TestResult['status'];
  steps: StoryboardStep[];
}

interface StoryboardFeature {
  name: string;
  description: string;
  scenarios: StoryboardScenario[];
}

interface StoryboardSection {
  /** Which directory under features/ this is, '' for features at the root. */
  folder?: string;
  /** The folder's own title, from its README heading or its directory name. */
  name: string;
  /** The folder's README, rendered — what this part of the product is for. */
  preamble: string;
  features: StoryboardFeature[];
}

export interface StoryboardData {
  status: FullResult['status'];
  generatedAt: string;
  /** Jasper's own icon, so the page is branded from the product, not a copy. */
  logo: string;
  /** The ring colours baked into the frames, for the page to match. */
  marks: typeof MARKS;
  sections: StoryboardSection[];
}

const DATA_PLACEHOLDER = '__STORYBOARD_DATA__';

/** A key chord as a person would write it, not as the CDP protocol spells it. */
function readChord(chord: string): string {
  return chord
    .split('+')
    .map((key) =>
      key
        .replace(/^Key(?=[A-Z]$)/, '')
        .replace(/^Control$/, 'Ctrl')
        .replace(/^Meta$/, 'Cmd')
        .replace(/^Digit(?=\d$)/, ''),
    )
    .join('+');
}

/** Assertions whose subject is, by the time it holds, not on screen to ring. */
const ABSENT = new Set(['toBeHidden']);

/** How an assertion reads once its subject has been named. */
const MATCHERS: Record<string, string> = {
  toBeVisible: 'is visible',
  toBeHidden: 'is gone',
  toBeEnabled: 'is enabled',
  toBeDisabled: 'is disabled',
  toContainText: 'shows the expected text',
  toHaveText: 'reads as expected',
  toHaveValue: 'holds the expected value',
};

/** Roles whose ARIA name is not what a person would call the thing. */
const ROLE_WORDS: Record<string, string> = {
  treeitem: 'row',
  textbox: 'box',
  menuitem: 'menu item',
};

/**
 * A quoted string or a regex literal, as the plain text a reader would see.
 * A pattern is matched against the accessible name, so stripping its anchors
 * and escapes leaves the name itself — `/^Rowan\\b/` is about "Rowan".
 */
function readName(source: string): string {
  const text = source.trim();

  const quoted = /^'(.*)'$|^"(.*)"$/.exec(text);
  if (quoted) return quoted[1] ?? quoted[2];

  const pattern = /^\/(.*)\/[gimsuy]*$/.exec(text);
  if (!pattern) return text;
  return pattern[1]
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\\b/g, '')
    .replace(/\\(?=\W)/g, '')
    .trim();
}

/**
 * The control a step acted on, described the way the accessibility tree
 * describes it — which is to say, the way a screen reader would announce it.
 *
 * Playwright writes its step titles out of the locator, so a `getByRole` call
 * already carries the role and accessible name: the user-facing identity of the
 * control, not an implementation detail. A locator built from CSS carries no
 * such name, and returns null rather than putting a selector in a document.
 */
function describeTarget(title: string): string | null {
  const roles = [...title.matchAll(/getByRole\('([^']+)'(?:,\s*\{\s*name:\s*(.+?)\s*\})?\)/g)];
  if (roles.length) {
    // The last in a chain is the thing itself; earlier ones only scope it.
    const [, role, name] = roles[roles.length - 1];
    const word = ROLE_WORDS[role] ?? role;
    if (name) return `${readName(name)} ${word}`;
    // An unnamed role narrowed by its text — the text is what identifies it.
    const contains = /filter\(\{\s*hasText:\s*(.+?)\s*\}\)/.exec(title);
    return contains ? `${readName(contains[1])} ${word}` : word;
  }

  const placeholder = /getByPlaceholder\((.+?)\)/.exec(title);
  if (placeholder) return `${readName(placeholder[1])} box`;

  const labelled = /getBy(?:Label|Title|TestId)\((.+?)\)/.exec(title);
  if (labelled) return readName(labelled[1]);

  const text = /getByText\((.+?)\)/.exec(title);
  if (text) return `${readName(text[1])} text`;

  return null;
}

/**
 * One recorded action, as a sentence — or null when it says nothing a reader
 * needs. Waiting, scrolling and screenshotting are how the test copes with a
 * live window, not things the user does; a click on a CSS-only locator has no
 * name to give, and a selector in a manual is worse than an omission.
 */
function phrase(title: string): StoryboardAction | null {
  const key = /^Press "(.+)"$/.exec(title);
  if (key) return { text: `Press ${readChord(key[1])}`, kind: 'plain' };

  const typed = /^(?:Type|Fill) "(.*)"$/.exec(title);
  if (typed) {
    return { text: typed[1] ? `Type \u201c${typed[1]}\u201d` : 'Clear the text', kind: 'plain' };
  }

  const acted = /^(Click|Double click|Hover|Check|Uncheck|Select option)\b/.exec(title);
  if (acted) {
    const target = describeTarget(title);
    return target ? { text: `${acted[1]} the ${target}`, kind: 'act' } : null;
  }

  const expected = /^Expect "(\w+)"/.exec(title);
  if (expected) {
    const target = describeTarget(title);
    if (!target) return null;
    return {
      text: `The ${target} ${MATCHERS[expected[1]] ?? 'is as expected'}`,
      kind: ABSENT.has(expected[1]) ? 'plain' : 'check',
    };
  }

  return null;
}

interface SourceFeature {
  /** The .feature it was declared in — how the table of contents refers to it. */
  file: string;
  /**
   * The prose under the `Feature:` line — the author's own summary of what the
   * feature is for. Gherkin allows free text there until the first tag or
   * Scenario, which is exactly the paragraph worth reprinting as an intro.
   */
  description: string;
}

/** What each `Feature:` on disk is called, keyed by the name it declares. */
function readFeatureSources(featuresDir: string): Map<string, SourceFeature> {
  const byName = new Map<string, SourceFeature>();
  for (const entry of featureOrder(featuresDir)) {
    const lines = fs.readFileSync(path.join(featuresDir, entry), 'utf8').split('\n');
    const headingAt = lines.findIndex((l) => l.trim().startsWith('Feature:'));
    if (headingAt === -1) continue;

    const prose: string[] = [];
    for (const line of lines.slice(headingAt + 1)) {
      const trimmed = line.trim();
      if (/^(@|Scenario|Rule:|Background:|Example|Given|When|Then|And|But)\b/.test(trimmed)) break;
      prose.push(trimmed);
    }
    byName.set(lines[headingAt].trim().replace(/^Feature:\s*/, ''), {
      file: entry,
      description: prose.join(' ').replace(/\s+/g, ' ').trim(),
    });
  }
  return byName;
}

const README_FILE = 'README.md';

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/** Links, emphasis and code spans within a line. */
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>');
}

/**
 * A deliberately small Markdown subset — headings, paragraphs, lists, links,
 * emphasis, code spans — enough for a folder's README and no more. The alternative
 * is a Markdown dependency in a reporter that exists to avoid dependencies.
 *
 * A leading `# ` heading is taken as the section's title rather than rendered,
 * so the README names its own chapter.
 */
function renderMarkdown(source: string): { title: string; html: string } {
  const lines = source.split('\n');
  let title = '';
  if (lines[0]?.startsWith('# ')) title = (lines.shift() as string).slice(2).trim();

  const html: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list.length)
      html.push(`<ul>${list.map((i) => `<li>${renderInline(i)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      closeParagraph();
      list.push(item[1]);
      continue;
    }
    // A wrapped list item continues the one above rather than starting a
    // paragraph; only a blank line ends the list.
    if (list.length) {
      list[list.length - 1] += ' ' + line;
      continue;
    }
    paragraph.push(line);
  }
  closeParagraph();
  closeList();
  return { title, html: html.join('\n') };
}

/** A folder's own introduction, from its README.md. */
function readSectionIntro(dir: string, fallbackName: string): { name: string; preamble: string } {
  try {
    const { title, html } = renderMarkdown(fs.readFileSync(path.join(dir, README_FILE), 'utf8'));
    return { name: title || fallbackName, preamble: html };
  } catch {
    return { name: fallbackName, preamble: '' };
  }
}

/**
 * A directory states the order of *its own* entries — features and
 * subdirectories — in `.contents.json`, and nothing deeper. The reading order
 * is composed by descending, so a folder can be rearranged without its parent
 * knowing, and a folder with no outline simply reads alphabetically.
 *
 * Entries are filenames rather than Feature titles: a filename is exact and
 * only changes deliberately, whereas a title is prose someone may reword.
 */
export const CONTENTS_FILE = '.contents.json';

/** The entries of `dir` worth ordering — features and subdirectories. */
function orderableEntries(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.name.endsWith('.feature'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** `dir`'s entries in reading order: those its outline places, then the rest. */
export function outlineOf(dir: string): string[] {
  const present = orderableEntries(dir);

  let placed: string[] = [];
  try {
    const outline: unknown = JSON.parse(fs.readFileSync(path.join(dir, CONTENTS_FILE), 'utf8'));
    const listed = (outline as { contents?: unknown }).contents;
    if (Array.isArray(listed)) {
      placed = listed.filter((name): name is string => typeof name === 'string');
    }
  } catch {
    // No outline here — the filesystem's own order will do.
  }

  // An outline may name something that has since gone; the rest follow it.
  const kept = placed.filter((name) => present.includes(name));
  return [...kept, ...present.filter((name) => !kept.includes(name)).sort()];
}

/** Every feature under `root`, in reading order, as paths relative to `root`. */
export function featureOrder(root: string, dir: string = root): string[] {
  const found: string[] = [];
  for (const name of outlineOf(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) found.push(...featureOrder(root, full));
    else found.push(path.relative(root, full));
  }
  return found;
}

/** Every descendant of `step`, in the order it ran. */
function* descendants(step: TestStep): Generator<TestStep> {
  for (const child of step.steps) {
    yield child;
    yield* descendants(child);
  }
}

/**
 * The colour a step is written in: that of the first control it marks. A step
 * that vouches for something rings it first, so a Then reads as a check; a step
 * that acts clicks first, so a When reads as an act. Steps that mark nothing
 * stay plain rather than claim a ring the frames don't have.
 */
function stepKind(frames: StoryboardFrame[]): ActionKind {
  for (const frame of frames) {
    for (const action of frame.actions) {
      if (action.kind !== 'plain') return action.kind;
    }
  }
  return 'plain';
}

/** Split "Given the project is open" into its keyword and the rest. */
function splitKeyword(title: string): { keyword: string; title: string } {
  const m = /^(Given|When|Then|And|But)\s+(.*)$/s.exec(title);
  return m ? { keyword: m[1], title: m[2] } : { keyword: '', title };
}

export default class StoryboardReporter implements Reporter {
  private readonly features = new Map<string, StoryboardFeature>();
  private readonly templateFile: string;
  private readonly outputFile: string;
  private readonly featuresDir: string;

  constructor(options: { outputFile?: string; templateFile?: string } = {}) {
    const acceptanceDir = path.resolve(__dirname, '..');
    this.featuresDir = path.join(acceptanceDir, 'features');
    this.templateFile = options.templateFile
      ? path.resolve(acceptanceDir, options.templateFile)
      : path.join(__dirname, 'storyboard.html');
    this.outputFile = path.resolve(
      acceptanceDir,
      options.outputFile ?? 'playwright-report/storyboard.html',
    );
  }

  /**
   * Turn one Gherkin step into its frames. Walking the recorded tree in order,
   * actions accumulate until a screenshot is attached — those are the actions
   * that produced it — and the tally restarts for the next frame.
   */
  private framesOf(gherkinStep: TestStep): StoryboardFrame[] {
    const frames: StoryboardFrame[] = [];
    let actions: StoryboardAction[] = [];

    for (const step of descendants(gherkinStep)) {
      const attachment = step.attachments.find((a) => a.contentType.startsWith('image/'));
      if (attachment) {
        const body = attachment.body ?? (attachment.path ? fs.readFileSync(attachment.path) : null);
        if (!body) continue;
        frames.push({
          label: attachment.name.split(FRAME_SEPARATOR)[1] ?? '',
          actions,
          image: `data:${attachment.contentType};base64,${body.toString('base64')}`,
        });
        actions = [];
        continue;
      }
      if (step.category !== 'pw:api' && step.category !== 'expect') continue;
      const said = phrase(step.title);
      if (said) actions.push(said);
    }
    return frames;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const steps: StoryboardStep[] = [];
    for (const step of result.steps) {
      // Only the Gherkin steps; hooks and fixtures are setup, not narrative.
      if (step.category !== 'test.step') continue;
      const frames = this.framesOf(step);
      if (frames.length === 0) continue;
      steps.push({ ...splitKeyword(step.title), kind: stepKind(frames), frames });
    }
    // Nothing to show for a test that captured no frames; the HTML report has it.
    if (steps.length === 0) return;

    // playwright-bdd nests each scenario in a describe named for its Feature.
    const name = test.parent.title || 'Scenarios';
    const feature = this.features.get(name) ?? { name, description: '', scenarios: [] };
    feature.scenarios.push({ name: test.title, status: result.status, steps });
    this.features.set(name, feature);
  }

  /** The extension's own icon, inlined so the page stays a single file. */
  private logo(): string {
    try {
      const icon = path.resolve(__dirname, '..', '..', 'resources', 'gemstone-icon.png');
      return `data:image/png;base64,${fs.readFileSync(icon).toString('base64')}`;
    } catch {
      return '';
    }
  }

  onEnd(result: FullResult): void {
    if (this.features.size === 0) return;

    const sources = readFeatureSources(this.featuresDir);
    // Chapter order comes from the table of contents; anything it doesn't name
    // sorts after, so an unlisted feature is visibly last rather than missing.
    const chapters = featureOrder(this.featuresDir);
    const placeOf = (name: string) => {
      const at = chapters.indexOf(sources.get(name)?.file ?? '');
      return at === -1 ? chapters.length : at;
    };

    const ordered = [...this.features.values()]
      .sort((a, b) => placeOf(a.name) - placeOf(b.name) || a.name.localeCompare(b.name))
      .map((feature) => ({
        ...feature,
        description: sources.get(feature.name)?.description ?? '',
      }));

    // A folder is a part of the manual: its features stay together, in the order
    // the outline put them, and it introduces itself from its own README.
    const sections: StoryboardSection[] = [];
    for (const feature of ordered) {
      const file = sources.get(feature.name)?.file ?? '';
      const folder = file.includes(path.sep) ? file.split(path.sep)[0] : '';
      let section = sections.find((s) => s.folder === folder);
      if (!section) {
        const intro = readSectionIntro(path.join(this.featuresDir, folder), folder);
        section = { folder, ...intro, features: [] };
        sections.push(section);
      }
      section.features.push(feature);
    }

    const data: StoryboardData = {
      status: result.status,
      generatedAt: new Date().toISOString(),
      logo: this.logo(),
      marks: MARKS,
      sections: sections.map(({ name, preamble, features }) => ({ name, preamble, features })),
    };

    let template: string;
    try {
      template = fs.readFileSync(this.templateFile, 'utf8');
    } catch {
      console.error(`  Storyboard template missing: ${this.templateFile}`);
      return;
    }

    // `<` is escaped so a string in the data can never close the script tag.
    const json = JSON.stringify(data).replace(/</g, '\\u003c');
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, template.replace(DATA_PLACEHOLDER, json), 'utf8');
    console.log(`\n  Storyboard written to ${this.outputFile}`);
  }
}
