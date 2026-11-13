import { describe, expect, it } from 'vitest';
import { UndoStack } from '../../web/src/host/UndoStack';

describe('UndoStack', () => {
  it('undoes and redoes in order', () => {
    const s = new UndoStack('a');
    s.push('b');
    s.push('c');
    expect(s.undo()).toBe('b');
    expect(s.undo()).toBe('a');
    expect(s.undo()).toBeUndefined();
    expect(s.redo()).toBe('b');
    expect(s.redo()).toBe('c');
    expect(s.redo()).toBeUndefined();
    expect(s.current).toBe('c');
  });

  it('drops the redo part on push after undo', () => {
    const s = new UndoStack('a');
    s.push('b');
    s.undo();
    s.push('x');
    expect(s.redo()).toBeUndefined();
    expect(s.undo()).toBe('a');
  });

  it('does not push a text equal to current', () => {
    const s = new UndoStack('a');
    s.push('a');
    expect(s.undo()).toBeUndefined();
    s.push('b');
    s.push('b');
    expect(s.undo()).toBe('a');
  });

  it('keeps at most max steps and drops the oldest', () => {
    const s = new UndoStack('0');
    for (let i = 1; i <= 205; i++) s.push(String(i));
    let steps = 0;
    let last: string | undefined;
    for (let t = s.undo(); t !== undefined; t = s.undo()) {
      steps++;
      last = t;
    }
    expect(steps).toBe(200);
    expect(last).toBe('5');
  });

  it('reset clears both directions', () => {
    const s = new UndoStack('a');
    s.push('b');
    s.push('c');
    s.undo();
    s.reset('z');
    expect(s.current).toBe('z');
    expect(s.undo()).toBeUndefined();
    expect(s.redo()).toBeUndefined();
  });
});
