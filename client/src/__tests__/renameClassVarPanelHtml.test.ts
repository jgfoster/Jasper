import { describe, it, expect } from 'vitest';
import { renderClassVarPanelHtml, renderClassVarCards } from '../renameClassVarPanelHtml';
import { ClassVarRenameChange } from '../renameClassVarPreview';

const defChange: ClassVarRenameChange = {
  id: '1',
  kind: 'classDefinitionEdit',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: null,
  category: null,
  oldSource: "Object subclass: 'Account' classVars: #( Rate)",
  newSource: "Object subclass: 'Account' classVars: #( Tally)",
};
const methodChange: ClassVarRenameChange = {
  id: '2',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'accrue',
  category: 'computing',
  oldSource: 'accrue ^balance * Rate',
  newSource: 'accrue ^balance * Tally',
};

function html(over: Partial<Parameters<typeof renderClassVarPanelHtml>[0]> = {}): string {
  return renderClassVarPanelHtml({
    oldName: 'Rate',
    newName: 'Tally',
    total: 2,
    changes: [defChange, methodChange],
    done: true,
    outOfScope: { references: 0, skipped: 0, collision: null },
    skippedMethods: [],
    nonce: 'n0nce',
    script: '/* view js */',
    ...over,
  });
}

describe('rename-class-variable panel HTML', () => {
  it('renders one card per change with a stable id and a diff', () => {
    const out = html();

    expect(out).toContain('data-id="1"');
    expect(out).toContain('data-id="2"');
    expect(out).toContain('class="diff');
  });

  it('renders NO selection checkboxes (the rename is all-or-nothing)', () => {
    const out = html();

    expect(out).not.toContain('class="sel"');
    expect(out).not.toContain('type="checkbox"');
  });

  it('shows the old and new names in the header', () => {
    // Orthogonal names (neither a substring of the other) with a precise element
    // assertion, so a broken old-name render can't false-pass on a shared substring.
    const out = html();

    expect(out).toContain('<code>Rate</code>');
    expect(out).toContain('<code>Tally</code>');
  });

  it('states that the whole rename applies together', () => {
    const out = html().toLowerCase();

    expect(out).toMatch(/applies together|all-or-nothing|whole rename|as a whole/);
  });

  it('wires the apply, cancel, and pager controls', () => {
    const out = html({ done: false });

    expect(out).toContain('id="apply"');
    expect(out).toContain('id="cancel"');
    expect(out).toContain('id="more"');
    expect(out).toContain('id="loadAll"');
  });

  it('warns when the new name collides with an existing binding', () => {
    const out = html({
      outOfScope: {
        references: 0,
        skipped: 0,
        collision: 'the name InterestRate is already a class variable in the hierarchy',
      },
    });

    expect(out).toContain('already a class variable');
  });

  it('injects the view script under the nonce with a strict CSP', () => {
    const out = html();

    expect(out).toContain("script-src 'nonce-n0nce'");
    expect(out).toContain('/* view js */');
  });

  it('renders appended cards identically to the first page', () => {
    const cards = renderClassVarCards([methodChange]);

    expect(cards).toContain('data-id="2"');
    expect(cards).not.toContain('type="checkbox"');
  });

  it('renders a multi-line method as a per-line diff so a large method stays readable', () => {
    const multiLine: ClassVarRenameChange = {
      id: '9',
      kind: 'methodRecompile',
      dictName: 'UserGlobals',
      className: 'Account',
      isMeta: false,
      selector: 'accrue',
      category: 'computing',
      oldSource: 'accrue\n\t"add interest"\n\tbalance := balance + (balance * Rate).\n\t^balance',
      newSource:
        'accrue\n\t"add interest"\n\tbalance := balance + (balance * InterestRate).\n\t^balance',
    };

    const cards = renderClassVarCards([multiLine]);

    // Each source line becomes its own diff <div class="line ...">, and only the
    // one changed line is marked add/del — the unchanged lines stay context.
    expect((cards.match(/class="line /g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(cards).toContain('class="line context"');
    expect(cards).toContain('class="line del"');
    expect(cards).toContain('class="line add"');
  });

  it('HTML-escapes special characters in the diff so the webview cannot be broken out of', () => {
    const nasty: ClassVarRenameChange = {
      id: '7',
      kind: 'methodRecompile',
      dictName: 'UserGlobals',
      className: 'Account',
      isMeta: false,
      selector: 'test',
      category: 'testing',
      oldSource: 'test ^x > 0 & y < 1 "<b>Rate</b>"',
      newSource: 'test ^x > 0 & y < 1 "<b>Tally</b>"',
    };

    const cards = renderClassVarCards([nasty]);

    expect(cards).toContain('&gt;');
    expect(cards).toContain('&lt;');
    expect(cards).toContain('&amp;');
    // No raw markup from the source leaks into the rendered card.
    expect(cards).not.toContain('<b>');
  });
});
