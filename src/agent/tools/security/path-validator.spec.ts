import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validatePath } from './path-validator';

describe('validatePath', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sera-path-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects prefix escapes that only share a string prefix', () => {
    const sibling = `${root}2`;
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret');

    const result = validatePath(
      path.join('..', path.basename(sibling), 'secret.txt'),
      root,
    );

    expect(result.valid).toBe(false);
    fs.rmSync(sibling, { recursive: true, force: true });
  });

  it('rejects symlinks that resolve outside the workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sera-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(root, 'link'));

    const result = validatePath('link/secret.txt', root);

    expect(result.valid).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('allows new files under an existing workspace directory', () => {
    const result = validatePath('nested/new.txt', root);

    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(path.join(root, 'nested', 'new.txt'));
  });
});
