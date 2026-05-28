import { describe, expect, it } from 'vitest';
import { validateCommand } from './command-validator';

describe('validateCommand', () => {
  it('allows low-risk read-only commands', () => {
    expect(validateCommand('ls -la')).toMatchObject({
      valid: true,
      action: 'allow',
    });
  });

  it('requires approval for mutating commands', () => {
    expect(validateCommand('git reset --hard HEAD')).toMatchObject({
      valid: true,
      action: 'approval_required',
    });
  });

  it('hard-blocks dangerous system commands', () => {
    expect(validateCommand('mkfs.ext4 /dev/sda')).toMatchObject({
      valid: false,
      action: 'block',
    });
  });

  it('hard-blocks the canonical fork bomb', () => {
    expect(validateCommand(':(){ :|:& };:')).toMatchObject({
      valid: false,
      action: 'block',
    });
  });

  it('hard-blocks fork bomb variants with extra whitespace', () => {
    expect(validateCommand(': () { : | : & ; } ; :')).toMatchObject({
      valid: false,
      action: 'block',
    });
  });
});
