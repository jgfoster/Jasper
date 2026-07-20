import type { CancellationToken, TestItem } from 'vscode';
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';
import * as sunit from './sunitQueries';

/**
 * Test item ID scheme (dictionary-qualified — the same class name can exist
 * in two dictionaries as two genuinely different test suites, so the
 * dictionary is part of every id and is always known before a test runs):
 *   Class:  sunit/<sessionId>/<dictName>/<className>
 *   Method: sunit/<sessionId>/<dictName>/<className>/<selector>
 *
 * These three functions are the single source of truth for that layout — build
 * ids only via make*Id and read them only via parseTestId, so the segment
 * offsets live in one place. (Segments are raw, not encoded: GemStone
 * dictionary names, class names, and test selectors cannot contain '/'.)
 */
function makeClassId(sessionId: number, dictName: string, className: string): string {
  return `sunit/${sessionId}/${dictName}/${className}`;
}

function makeMethodId(
  sessionId: number,
  dictName: string,
  className: string,
  selector: string,
): string {
  return `${makeClassId(sessionId, dictName, className)}/${selector}`;
}

interface ParsedTestId {
  dictName: string;
  className: string;
  /** undefined for a class id; present for a method id. */
  selector?: string;
}

function parseTestId(id: string): ParsedTestId {
  const [, , dictName, className, selector] = id.split('/');
  return { dictName, className, selector };
}

/**
 * Integrates GemStone SUnit tests with VS Code's Test Explorer.
 */
export class SunitTestController implements vscode.Disposable {
  private controller: vscode.TestController;
  private disposables: vscode.Disposable[] = [];

  /** category cache populated during method discovery, keyed by dictName/className/selector */
  private methodCategory = new Map<string, string>();

  constructor(private sessionManager: SessionManager) {
    this.controller = vscode.tests.createTestController('gemstone-sunit', 'GemStone SUnit Tests');

    this.controller.resolveHandler = async (item) => {
      if (!item) {
        await this.discoverTests();
      } else {
        await this.resolveTestMethods(item);
      }
    };

    this.controller.createRunProfile(
      'Run Tests',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runTests(request, token),
      true,
    );

    this.controller.refreshHandler = async () => {
      this.methodCategory.clear();
      this.controller.items.replace([]);
      await this.discoverTests();
    };

    this.disposables.push(
      sessionManager.onDidChangeSelection(async () => {
        this.methodCategory.clear();
        this.controller.items.replace([]);
        await this.discoverTests();
      }),
    );
  }

  dispose(): void {
    this.controller.dispose();
    for (const d of this.disposables) d.dispose();
  }

  /** Clear items and let resolveHandler re-discover on next view. */
  refresh(): void {
    this.methodCategory.clear();
    this.controller.items.replace([]);
  }

  /** Run all tests in a named class (bridge for browser tree context menu). */
  async runClassByName(dictName: string, className: string): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      vscode.window.showErrorMessage('No active GemStone session.');
      return;
    }

    // Ensure discovery has run so the item exists
    let classItem = this.findClassItem(dictName, className);
    if (!classItem) {
      await this.discoverTests();
      classItem = this.findClassItem(dictName, className);
    }

    if (!classItem) {
      vscode.window.showWarningMessage(`${className} is not a TestCase subclass in ${dictName}.`);
      return;
    }

    // Ensure children are resolved
    if (classItem.children.size === 0) {
      await this.resolveTestMethods(classItem);
    }

    // Run directly via a TestRun
    const run = this.controller.createTestRun({
      include: [classItem],
      exclude: [],
      profile: undefined,
      preserveFocus: false,
    });
    await this.runClassTests(session, run, classItem, className, dictName);
    run.end();
  }

  /**
   * Run all tests in the provided class names, all within one dictionary,
   * using a single TestRun.
   */
  async runClassesByName(dictName: string, classNames: string[]): Promise<void> {
    await this.discoverTests();
    const classItems: TestItem[] = this.itemsForClasses(dictName, classNames);

    await this.runTestItems(classItems);
  }

  /** Run all test methods in a method category from browser context menus. */
  async runMethodCategoryByName(
    dictName: string,
    className: string,
    category: string,
  ): Promise<void> {
    await this.discoverTests();

    const classItem = this.findClassItem(dictName, className);
    if (!classItem) {
      vscode.window.showWarningMessage(this.notATestClassErrorMessage(className));
      return;
    }

    if (classItem.children.size === 0) {
      await this.resolveTestMethods(classItem);
    }

    const methodItems: TestItem[] = [];
    classItem.children.forEach((child) => {
      if (this.methodCategory.get(`${dictName}/${className}/${child.label}`) === category) {
        methodItems.push(child);
      }
    });

    await this.runTestItems(methodItems);
  }

  /** Run test methods by class/selector from browser context menus. */
  async runTestsByName(dictName: string, className: string, selectors: string[]): Promise<void> {
    await this.discoverTests();

    const classItem = this.findClassItem(dictName, className);
    if (!classItem) {
      vscode.window.showWarningMessage(this.notATestClassErrorMessage(className));
      return;
    }

    if (classItem.children.size === 0) {
      await this.resolveTestMethods(classItem);
    }

    const methodItems = selectors
      .map((selector) => this.itemForMethodNamed(classItem, selector))
      .filter((result) => result !== undefined);

    await this.runTestItems(methodItems);
  }

  public notATestClassErrorMessage(className: string) {
    return `${className} is not a test class.`;
  }

  public noTestsFoundErrorMessage() {
    return `No tests found`;
  }

  // ── Discovery ──────────────────────────────────────────────

  private async discoverTests(): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    try {
      const classes = sunit.discoverTestClasses(session);
      const items: vscode.TestItem[] = [];

      // A class name is ambiguous when it exists in more than one dictionary.
      // Only then do we qualify the label with the dictionary — the Test
      // Results tab renders only labels (not the dimmed description), so this
      // is the one place the dictionary can disambiguate same-named classes
      // there. Unique names stay clean.
      const nameCounts = new Map<string, number>();
      for (const cls of classes) {
        nameCounts.set(cls.className, (nameCounts.get(cls.className) ?? 0) + 1);
      }

      for (const cls of classes) {
        const ambiguous = (nameCounts.get(cls.className) ?? 0) > 1;
        const label = ambiguous ? `${cls.className} {${cls.dictName}}` : cls.className;

        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
            `/${encodeURIComponent(cls.dictName)}` +
            `/${encodeURIComponent(cls.className)}` +
            `/definition`,
        );
        const classItem = this.controller.createTestItem(
          makeClassId(session.id, cls.dictName, cls.className),
          label,
          uri,
        );
        classItem.canResolveChildren = true;
        // Dimmed qualifier (sidebar only): test count. The dictionary never
        // goes here — it lives in the label, and only when the name is
        // ambiguous. A null count means the stone returned an unparseable
        // value; show "(?)" rather than a misleading "(0)".
        classItem.description = cls.testCount === null ? '(?)' : `(${cls.testCount})`;
        items.push(classItem);
      }

      this.controller.items.replace(items);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`SUnit discovery failed: ${msg}`);
    }
  }

  private async resolveTestMethods(classItem: vscode.TestItem): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    // dictName and className come from the class item's own id, so the
    // methods are discovered from the exact class the user is looking at (not
    // a same-named class in another dictionary). The label is NOT the class
    // name — for ambiguous names it carries a " {Dict}" suffix.
    const { dictName, className } = parseTestId(classItem.id);

    try {
      const methods = sunit.discoverTestMethods(session, className, dictName);
      const children: vscode.TestItem[] = [];

      for (const { selector, category } of methods) {
        this.methodCategory.set(`${dictName}/${className}/${selector}`, category);

        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
            `/${encodeURIComponent(dictName)}` +
            `/${encodeURIComponent(className)}` +
            `/instance` +
            `/${encodeURIComponent(category || 'as yet unclassified')}` +
            `/${encodeURIComponent(selector)}`,
        );
        const methodItem = this.controller.createTestItem(
          makeMethodId(session.id, dictName, className, selector),
          selector,
          uri,
        );
        children.push(methodItem);
      }

      classItem.children.replace(children);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      classItem.error = new vscode.MarkdownString(`Discovery failed: ${msg}`);
    }
  }

  // ── Test Execution ─────────────────────────────────────────

  private async runTests(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      vscode.window.showErrorMessage('No active GemStone session.');
      return;
    }

    const run = this.controller.createTestRun(request);
    const queue = this.getTestsToRun(request);

    for (const item of queue) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        continue;
      }

      const { dictName, className, selector } = parseTestId(item.id);

      if (selector === undefined) {
        await this.runClassTests(session, run, item, className, dictName);
      } else {
        run.started(item);
        this.runSingleTest(session, run, item, className, selector, dictName);
      }
    }

    run.end();
  }

  private getTestsToRun(request: vscode.TestRunRequest): vscode.TestItem[] {
    const queue: vscode.TestItem[] = [];

    if (request.include) {
      for (const item of request.include) {
        queue.push(item);
      }
    } else {
      this.controller.items.forEach((item) => queue.push(item));
    }

    const excluded = new Set(request.exclude?.map((i) => i.id) ?? []);
    return queue.filter((i) => !excluded.has(i.id));
  }

  private runSingleTest(
    session: ActiveSession,
    run: vscode.TestRun,
    item: vscode.TestItem,
    className: string,
    selector: string,
    dictName: string,
  ): void {
    try {
      const result = sunit.runTestMethod(session, className, selector, dictName);
      this.reportResult(run, item, result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      run.errored(item, new vscode.TestMessage(`Execution error: ${msg}`));
    }
  }

  private async runClassTests(
    session: ActiveSession,
    run: vscode.TestRun,
    classItem: vscode.TestItem,
    className: string,
    dictName: string,
  ): Promise<void> {
    // Ensure children are resolved
    if (classItem.children.size === 0) {
      await this.resolveTestMethods(classItem);
    }

    // Mark all children as started
    run.started(classItem);
    classItem.children.forEach((child) => run.started(child));

    try {
      const results = sunit.runTestClass(session, className, dictName);
      const resultMap = new Map(results.map((r) => [r.selector, r]));

      let allPassed = true;
      classItem.children.forEach((child) => {
        // Children are always method ids, so selector is present.
        const selector = parseTestId(child.id).selector!;
        const result = resultMap.get(selector);

        if (!result) {
          run.skipped(child);
          return;
        }

        this.reportResult(run, child, result);
        if (result.status !== 'passed') allPassed = false;
      });

      if (allPassed) {
        run.passed(classItem);
      } else {
        run.failed(classItem, new vscode.TestMessage('Some tests failed.'));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const errMsg = new vscode.TestMessage(`Execution error: ${msg}`);
      run.errored(classItem, errMsg);
      classItem.children.forEach((child) => {
        run.errored(child, new vscode.TestMessage(`Class execution error: ${msg}`));
      });
    }
  }

  private reportResult(
    run: vscode.TestRun,
    item: vscode.TestItem,
    result: sunit.TestRunResult,
  ): void {
    switch (result.status) {
      case 'passed':
        run.passed(item, result.durationMs);
        break;
      case 'failed':
        run.failed(item, new vscode.TestMessage(result.message), result.durationMs);
        break;
      case 'error':
        run.errored(item, new vscode.TestMessage(result.message), result.durationMs);
        break;
    }
  }

  /**
   * True when a class item belongs to dictName and is named className.
   * Both come from the id — the label carries the test-count suffix and is
   * NOT the class name.
   */
  private classItemMatches(item: TestItem, dictName: string, className: string): boolean {
    const { dictName: itemDict, className: itemClass } = parseTestId(item.id);
    return itemDict === dictName && itemClass === className;
  }

  private itemsForClasses(dictName: string, classNames: string[]): TestItem[] {
    const result: TestItem[] = [];

    this.controller.items.forEach((testItem) => {
      const { dictName: itemDict, className: itemClass } = parseTestId(testItem.id);
      if (itemDict === dictName && classNames.includes(itemClass)) {
        result.push(testItem);
      }
    });

    return result;
  }

  private findClassItem(dictName: string, className: string): TestItem | undefined {
    let classItem: TestItem | undefined;

    this.controller.items.forEach((testItem) => {
      if (this.classItemMatches(testItem, dictName, className)) {
        classItem = testItem;
      }
    });

    return classItem;
  }

  private itemForMethodNamed(classItem: TestItem, selector: string): TestItem | undefined {
    let methodItem: TestItem | undefined;

    classItem.children.forEach((child) => {
      if (child.label === selector) {
        methodItem = child;
      }
    });

    return methodItem;
  }

  private async runTestItems(testItems: TestItem[]) {
    if (testItems.length === 0) {
      vscode.window.showWarningMessage(this.noTestsFoundErrorMessage());
      return;
    }

    await this.runTests(
      {
        include: testItems,
        exclude: undefined,
        preserveFocus: false,
        profile: undefined,
        continuous: false,
      },
      {
        isCancellationRequested: false,
      } as CancellationToken,
    );
  }
}
