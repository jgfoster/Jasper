import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn() }));

import { workspace, window } from '../__mocks__/vscode';
import {openWorkspace, WORKSPACE_TEMPLATE} from '../workspace';

describe('openWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a gemstone-smalltalk document', async () => {
    await openWorkspace();
    
    expect(workspace.openTextDocument).toHaveBeenCalledWith(
      { content: WORKSPACE_TEMPLATE, language: 'gemstone-smalltalk' },
    );
  });

  it('shows the document with preview disabled', async () => {
    await openWorkspace();
    
    expect(window.showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: false }),
    );
  });

  it('opens a new workspace document each time it is called', async () => {
    await openWorkspace();
    
    await openWorkspace();
    
    expect(workspace.openTextDocument).toHaveBeenCalledTimes(2);
  });
});
