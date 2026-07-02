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
  it('shows exactly eight GemStone actions in the editor context menu', () => {
    expect(editorContext).toHaveLength(8);
  });

  it('shows "Display It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.displayIt')?.when)
      .toBe(`editorTextFocus && resourceLangId == gemstone-smalltalk && !gemstone.executing`);
  });

  it('shows "Inspect It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.inspectIt')?.when)
      .toBe(`editorTextFocus && resourceLangId == gemstone-smalltalk && !gemstone.executing`);
  });

  it('shows "GT Inspect It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.superInspectIt')?.when)
      .toBe('editorTextFocus && resourceLangId == gemstone-smalltalk && gemstone.enhancedInspectorAvailable && !gemstone.executing');
  });

  it('shows "Execute It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.executeIt')?.when)
      .toBe(`editorTextFocus && resourceLangId == gemstone-smalltalk && !gemstone.executing`);
  });

  it('shows "Debug It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.debugIt')?.when)
      .toBe(`editorTextFocus && resourceLangId == gemstone-smalltalk && !gemstone.executing`);
  });

  it('shows "Senders Of..." in gemstone documents', () => {
    expect(getMenuItem('gemstone.sendersOf')?.when)
      .toBe(`editorTextFocus && resourceLangId == gemstone-smalltalk`);
  });

  it('shows "Implementors Of..." in gemstone documents', () => {
    expect(getMenuItem('gemstone.implementorsOf')?.when)
      .toBe(`editorTextFocus && resourceLangId == gemstone-smalltalk`);
  });

  it('shows "Toggle Selector Breakpoint" in gemstone documents', () => {
    expect(getMenuItem('gemstone.toggleSelectorBreakpoint')?.when)
      .toBe(`editorTextFocus && resourceLangId == gemstone-smalltalk`);
  });
});
