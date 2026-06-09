import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const keybindings: Array<{
  command: string;
  key: string;
  mac: string;
  when: string;
}> = pkg.contributes.keybindings;

describe('keybindings', () => {
  it('should all use the ctrl+k chord prefix (Windows/Linux)', () => {
    for (const kb of keybindings) {
      expect(kb.key, `${kb.command} has unexpected key: "${kb.key}"`).toMatch(
        /^ctrl\+k [a-z]$/,
      );
    }
  });

  it('should all use the cmd+k chord prefix (macOS)', () => {
    for (const kb of keybindings) {
      expect(kb.mac, `${kb.command} has unexpected mac key: "${kb.mac}"`).toMatch(
        /^cmd\+k [a-z]$/,
      );
    }
  });

  it('should have matching second keys on both platforms', () => {
    for (const kb of keybindings) {
      const winKey = kb.key.split(' ')[1];
      const macKey = kb.mac.split(' ')[1];
      expect(winKey).toBe(macKey);
    }
  });

  it('should have no duplicate second keys', () => {
    const secondKeys = keybindings.map((kb) => kb.key.split(' ')[1]);
    expect(new Set(secondKeys).size).toBe(secondKeys.length);
  });

  it('should map to expected commands', () => {
    const expected: Record<string, string> = {
      d: 'gemstone.displayIt',
      e: 'gemstone.executeIt',
      i: 'gemstone.inspectIt',
      o: 'gemstone.superInspectIt',
      b: 'gemstone.openBrowser',
      c: 'gemstone.findClass',
      m: 'gemstone.findMethod',
    };

    for (const kb of keybindings) {
      const letter = kb.mac.split(' ')[1];
      expect(expected[letter]).toBe(kb.command);
    }
  });

  it('should require active session for all bindings', () => {
    for (const kb of keybindings) {
      expect(kb.when).toContain('gemstone.hasActiveSession');
    }
  });

  it('should gate editor commands on editorTextFocus and !executing', () => {
    const editorCommands = ['gemstone.displayIt', 'gemstone.executeIt', 'gemstone.inspectIt'];
    for (const kb of keybindings) {
      if (editorCommands.includes(kb.command)) {
        expect(kb.when).toContain('editorTextFocus');
        expect(kb.when).toContain('!gemstone.executing');
      }
    }
  });

  it('inspector welcome text should match the actual inspectIt chord', () => {
    const inspectIt = keybindings.find((kb) => kb.command === 'gemstone.inspectIt');
    expect(inspectIt).toBeDefined();
    const letter = inspectIt!.mac.split(' ')[1].toUpperCase();

    const welcomes: Array<{ view: string; contents: string; when?: string }> =
      pkg.contributes.viewsWelcome;
    const inspectorWelcomes = welcomes.filter((w) => w.view === 'gemstoneInspector');
    expect(inspectorWelcomes.length).toBe(2);

    const mac = inspectorWelcomes.find((w) => w.when === 'isMac');
    const nonMac = inspectorWelcomes.find((w) => w.when === '!isMac');
    expect(mac?.contents).toContain(`Cmd+K ${letter} to inspect`);
    expect(nonMac?.contents).toContain(`Ctrl+K ${letter} to inspect`);
  });
});
