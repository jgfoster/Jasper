import { describe, it, expect } from 'vitest';
import { renderTemporaryPanelHtml, renderTemporaryCards } from '../renameTemporaryPanelHtml';
import { TemporaryRenameChange, TemporaryOutOfScope } from '../renameTemporaryPreview';

const change: TemporaryRenameChange = {
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'computeTemp',
  category: 'computing',
  oldSource: 'computeTemp | t | t := 1. ^t',
  newSource: 'computeTemp | sum | sum := 1. ^sum',
};

const noWarnings: TemporaryOutOfScope = {
  references: 0,
  skipped: 0,
  collision: null,
  decline: null,
};

function html(over: Partial<Parameters<typeof renderTemporaryPanelHtml>[0]> = {}): string {
  return renderTemporaryPanelHtml({
    oldName: 't',
    newName: 'sum',
    total: 1,
    changes: [change],
    done: true,
    outOfScope: noWarnings,
    nonce: 'NONCE',
    script: '/* view js */',
    ...over,
  });
}

describe('rename-temporary panel HTML', () => {
  it('shows the old and new names in the header', () => {
    const out = html();

    expect(out).toContain('<code>t</code>');
    expect(out).toContain('<code>sum</code>');
  });

  it('renders the method label and the before/after diff', () => {
    const out = html();

    expect(out).toContain('Account&gt;&gt;computeTemp');
    expect(out).toContain('sum := 1');
  });

  it('renders no selection checkboxes (single all-or-nothing change)', () => {
    const out = html();

    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain('class="sel"');
  });

  it('carries a strict CSP with the given nonce', () => {
    const out = html();

    expect(out).toContain("script-src 'nonce-NONCE'");
    expect(out).toContain('<script nonce="NONCE">');
  });

  it('shows a collision warning banner when the new name is taken', () => {
    const out = html({
      outOfScope: {
        references: 0,
        skipped: 0,
        collision: 'the name count is already an instance variable',
        decline: null,
      },
    });

    expect(out).toContain('already an instance variable');
  });

  it('shows a decline warning banner when the target is not a local', () => {
    const out = html({
      outOfScope: {
        references: 0,
        skipped: 0,
        collision: null,
        decline: 'that position is not a temporary or argument',
      },
    });

    expect(out).toContain('not a temporary or argument');
  });

  it('escapes HTML metacharacters in the rendered source', () => {
    const out = renderTemporaryCards([
      { ...change, newSource: 'x ^a < b & c > d', oldSource: 'x ^a' },
    ]);

    expect(out).toContain('&lt;');
    expect(out).toContain('&amp;');
    expect(out).not.toContain('< b & c >');
  });
});
