import { describe, expect, it } from 'vitest';
import { isBoardName, toBoardName, webCopyName } from '../../web/shared/boardNames';

describe('isBoardName', () => {
  it.each(['sample.canvas', 'my plan.canvas', 'a.b.canvas'])('accepts %s', (name) => {
    expect(isBoardName(name)).toBe(true);
  });

  it.each(['../a.canvas', 'a/b.canvas', 'a\\b.canvas', '.hidden.canvas', '.canvas', 'a.txt', 'a..canvas', 'a\u0000.canvas', 'a:b.canvas', 'a?.canvas', `${'x'.repeat(194)}.canvas`])(
    'refuses %j',
    (name) => {
      expect(isBoardName(name)).toBe(false);
    },
  );

  it('allows exactly 200 characters', () => {
    expect(isBoardName(`${'x'.repeat(193)}.canvas`)).toBe(true);
  });
});

describe('toBoardName', () => {
  it('adds .canvas and trims', () => {
    expect(toBoardName('plan')).toBe('plan.canvas');
    expect(toBoardName('  plan.canvas ')).toBe('plan.canvas');
  });

  it('refuses names that are not plain files', () => {
    expect(toBoardName('../x')).toBeUndefined();
    expect(toBoardName('')).toBeUndefined();
    expect(toBoardName('a/b')).toBeUndefined();
  });
});

describe('webCopyName', () => {
  it('numbers the copies', () => {
    expect(webCopyName('sample.canvas', 1)).toBe('sample_web.canvas');
    expect(webCopyName('sample.canvas', 2)).toBe('sample_web-2.canvas');
    expect(webCopyName('sample.canvas', 3)).toBe('sample_web-3.canvas');
  });
});
