import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

interface MenuItem {
  command: string;
  when: string;
  group: string;
}

const editorContext: MenuItem[] = pkg.contributes.menus['editor/context'];

function getMenuItem(command: string): MenuItem | undefined {
  return editorContext.find((item) => item.command === command);
}

describe('editor/context menu', () => {
  it('shows exactly six GemStone actions in the editor context menu', () => {
    expect(editorContext).toHaveLength(6);
  });

  it('shows "Display It" only in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.displayIt')?.when)
      .toBe('editorTextFocus && resourceScheme == gemstone && !gemstone.executing');
  });

  it('shows "Inspect It" only in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.inspectIt')?.when)
      .toBe('editorTextFocus && resourceScheme == gemstone && !gemstone.executing');
  });

  it('shows "Execute It" only in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.executeIt')?.when)
      .toBe('editorTextFocus && resourceScheme == gemstone && !gemstone.executing');
  });

  it('shows "Senders Of..." only in gemstone documents', () => {
    expect(getMenuItem('gemstone.sendersOf')?.when)
      .toBe('editorTextFocus && resourceScheme == gemstone');
  });

  it('shows "Implementors Of..." only in gemstone documents', () => {
    expect(getMenuItem('gemstone.implementorsOf')?.when)
      .toBe('editorTextFocus && resourceScheme == gemstone');
  });

  it('shows "Toggle Selector Breakpoint" only in gemstone documents', () => {
    expect(getMenuItem('gemstone.toggleSelectorBreakpoint')?.when)
      .toBe('editorTextFocus && resourceScheme == gemstone');
  });
});
