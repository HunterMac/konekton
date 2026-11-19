import { describe, expect, it } from 'vitest';
import {
  addToDay,
  composeTaskText,
  listTokens,
  retitle,
  decodeValue,
  deleteTask,
  describeRepeat,
  encodeValue,
  estimateMinutes,
  expandDateShortcuts,
  formatMinutes,
  getValue,
  indentTask,
  insertSubtask,
  insertTask,
  isTodoPath,
  laneOf,
  setLane,
  ensureTaskId,
  linkTask,
  moveTask,
  moveTaskTo,
  newTaskId,
  outdentTask,
  parseRepeat,
  parseTodo,
  readTokens,
  renderTask,
  replaceTaskLines,
  setDone,
  setDoneWithSubtasks,
  setMeta,
  setStatus,
  statusOf,
  retitleTask,
  taskFullText,
  taskMeta,
  setTaskValue,
  subtreeEnd,
  summary,
  unlinkTask,
  updateTask,
} from '../../src/shared/todoFormat';

const SAMPLE = [
  '# Work',
  '',
  '- [ ] Prepare project report #work @Anna !2026-11-14 ~2h <!--',
  '  id: k3f9',
  '  priority: high',
  '  note: Include financial results and milestones.',
  '  -->',
  '  - [x] Collect numbers <!-- id:p0a2 done:2026-11-12 -->',
  '  - [ ] Write summary ~1h <!--',
  '    id: x7c1',
  '    after: p0a2',
  '    status: inProgress',
  '    -->',
  '- [ ] Pay rent !2026-12-01 <!-- id:r5t8 repeat:+1m -->',
  '',
].join('\n');

describe('todo files', () => {
  it('recognizes todo file names', () => {
    expect(isTodoPath('home.todo.md')).toBe(true);
    expect(isTodoPath('notes/Release-2.TODO.md')).toBe(true);
    expect(isTodoPath('TODO.md')).toBe(true);
    expect(isTodoPath('a/todo.md')).toBe(true);
    expect(isTodoPath('notes.md')).toBe(false);
    expect(isTodoPath('mytodo.md')).toBe(false);
  });
});

describe('parseTodo', () => {
  const doc = parseTodo(SAMPLE);

  it('reads tasks, nesting and both comment forms', () => {
    expect(doc.tasks.map((t) => t.text)).toEqual(['Prepare project report #work @Anna !2026-11-14 ~2h', 'Collect numbers', 'Write summary ~1h', 'Pay rent !2026-12-01']);
    const [report, collect, summaryTask, rent] = doc.tasks;
    expect(report).toMatchObject({ line: 2, end: 6, form: 'block', parent: null, children: [1, 2], depth: 0, checked: false });
    expect(report.data).toEqual([
      { key: 'id', value: 'k3f9' },
      { key: 'priority', value: 'high' },
      { key: 'note', value: 'Include financial results and milestones.' },
    ]);
    expect(collect).toMatchObject({ line: 7, end: 7, form: 'short', parent: 0, checked: true, depth: 1 });
    expect(getValue(collect, 'done')).toBe('2026-11-12');
    expect(summaryTask).toMatchObject({ line: 8, end: 12, form: 'block', parent: 0 });
    expect(getValue(summaryTask, 'status')).toBe('inProgress');
    expect(rent).toMatchObject({ line: 13, parent: null, form: 'short' });
    expect(doc.tasks.every((t) => t.problems.length === 0)).toBe(true);
    expect(doc.headings).toEqual([{ line: 0, level: 1, title: 'Work' }]);
  });

  it('reads quoted and escaped short values', () => {
    const d = parseTodo('- [ ] A <!-- note:"Ask about \\"specs\\"" path:a--\\>b k: v -->');
    expect(d.tasks[0].data).toEqual([
      { key: 'note', value: 'Ask about "specs"' },
      { key: 'path', value: 'a-->b' },
      { key: 'k', value: 'v' },
    ]);
  });

  it('keeps plain text in a short comment, so writing the task does not lose it', () => {
    const d = parseTodo('- [ ] Buy milk <!-- ask Anna first id:a -->');
    expect(d.tasks[0].data).toEqual([
      { key: 'id', value: 'a' },
      { key: '', value: 'ask Anna first' },
    ]);
    expect(setDone(d, 0, true, '2026-11-13').text).toBe('- [x] Buy milk <!--\n  id: a\n  ask Anna first\n  done: 2026-11-13\n  -->');
  });

  it('keeps URLs and hand-typed backslashes as written', () => {
    const d = parseTodo('- [ ] A <!--\n  https://example.com/x\n  path: C:\\Users\\me\n  -->');
    expect(d.tasks[0].data).toEqual([
      { key: '', value: 'https://example.com/x' },
      { key: 'path', value: 'C:\\Users\\me' },
    ]);
    const written = setDone(d, 0, true, '2026-11-13').text;
    expect(written.split('\n').slice(1, 3)).toEqual(['  https://example.com/x', '  path: C:\\\\Users\\\\me']);
    expect(getValue(parseTodo(written).tasks[0], 'path')).toBe('C:\\Users\\me');
    expect(parseTodo('- [ ] A <!-- https://example.com -->').tasks[0].data).toEqual([{ key: '', value: 'https://example.com' }]);
  });

  it('reads the comment on the lines below (older form)', () => {
    const d = parseTodo(['- [ ] Prepare project report', '  <!--', '  id: task-001', '  due: 2026-11-14T15:00', '  -->', '', '- [ ] Contact client', '  <!-- id: task-002 -->'].join('\n'));
    expect(d.tasks).toHaveLength(2);
    expect(d.tasks[0]).toMatchObject({ form: 'below', end: 4 });
    expect(d.tasks[0].data).toEqual([
      { key: 'id', value: 'task-001' },
      { key: 'due', value: '2026-11-14T15:00' },
    ]);
    expect(d.tasks[1]).toMatchObject({ form: 'below', end: 7 });
    expect(getValue(d.tasks[1], 'id')).toBe('task-002');
  });

  it('reports comment lines that break the preview', () => {
    const blank = parseTodo('- [ ] A <!--\n  id: a\n\n  note: x\n  -->');
    expect(blank.tasks[0].problems[0]).toMatch(/Blank line 3/);
    const list = parseTodo('- [ ] A <!--\n  - not a key\n  -->');
    expect(list.tasks[0].problems[0]).toMatch(/does not start with a key/);
    expect(list.tasks[0].data).toEqual([{ key: '', value: '- not a key' }]);
    const unindented = parseTodo('- [ ] A\n  <!--\nid: a\n  -->');
    expect(unindented.tasks[0].problems[0]).toMatch(/not indented/);
    const open = parseTodo('- [ ] A <!--\n  id: a');
    expect(open.tasks[0].problems[0]).toMatch(/not closed/);
    expect(open.tasks).toHaveLength(1);
  });

  it('accepts unindented key lines in the block form', () => {
    const d = parseTodo('- [ ] A <!--\nid: a\n-->\n- [ ] B');
    expect(d.tasks.map((t) => t.problems)).toEqual([[], []]);
    expect(d.tasks[1].parent).toBeNull();
  });

  it('skips code blocks and front matter, and other checkbox characters', () => {
    const d = parseTodo(['---', 'title: x', '- [ ] not a task', '---', '```', '- [ ] in code', '```', '- [/] custom state', '* [X] Star task', '1. [ ] Numbered'].join('\n'));
    expect(d.tasks.map((t) => [t.text, t.marker, t.checked])).toEqual([
      ['Star task', '*', true],
      ['Numbered', '1.', false],
    ]);
  });

  it('ends nesting at a heading or an unindented line', () => {
    const d = parseTodo(['- [ ] A', '  - [ ] A1', '## Next', '  - [ ] B1', 'text', '  - [ ] C1'].join('\n'));
    expect(d.tasks.map((t) => t.parent)).toEqual([null, 0, null, null]);
  });
});

describe('tokens', () => {
  it('splits the title from the tokens', () => {
    expect(readTokens('Call plumber #home @Anna !2026-11-14 ~30m')).toEqual({ title: 'Call plumber', tags: ['home'], people: ['Anna'], due: '2026-11-14', estimate: '30m' });
  });

  it('needs a space before a token and skips inline code and invalid values', () => {
    const t = readTokens('Mail a@b.com about C# and `#notag` !important ~soon !2026-02-30 (see @Bob).');
    expect(t.tags).toEqual([]);
    expect(t.people).toEqual(['Bob']);
    expect(t.due).toBeUndefined();
    expect(t.estimate).toBeUndefined();
    expect(t.title).toContain('!important');
  });

  it('reads a due time', () => {
    expect(readTokens('Call !2026-11-14T15:00').due).toBe('2026-11-14T15:00');
  });

  it('keeps the meta in the comment: due date, estimate, tags and people', () => {
    const d = parseTodo('- [ ] Call plumber');
    expect(setMeta(d, 0, 'due', '2026-11-14').text).toBe('- [ ] Call plumber <!--\n  due: 2026-11-14\n  -->');
    const withEstimate = parseTodo(setMeta(d, 0, 'estimate', '2h').text);
    const two = parseTodo(setMeta(withEstimate, 0, 'due', '2026-11-14').text);
    expect(two.lines.join('\n')).toBe('- [ ] Call plumber <!--\n  due: 2026-11-14\n  estimate: 2h\n  -->');
    expect(taskMeta(two.tasks[0])).toEqual({ title: 'Call plumber', tags: [], people: [], due: '2026-11-14', estimate: '2h' });
    expect(setMeta(two, 0, 'due', '2026-11-20').text).toContain('due: 2026-11-20');
    expect(setMeta(two, 0, 'due', undefined).text).toBe('- [ ] Call plumber <!--\n  estimate: 2h\n  -->');
    expect(setMeta(parseTodo(setMeta(d, 0, 'due', '2026-11-14').text), 0, 'due', undefined).text).toBe('- [ ] Call plumber');
  });

  it('moves the tokens of an older line into the comment when the task is written', () => {
    const d = parseTodo('- [ ] Le task !2026-12-23 #home @Anna ~1h <!-- id:a -->');
    expect(taskMeta(d.tasks[0])).toEqual({ title: 'Le task', tags: ['home'], people: ['Anna'], due: '2026-12-23', estimate: '1h' });
    expect(setTaskValue(d, 0, 'priority', 'high').text).toBe('- [ ] Le task <!--\n  due: 2026-12-23\n  estimate: 1h\n  tags: home\n  people: Anna\n  id: a\n  priority: high\n  -->');
    // Not written: not changed.
    expect(d.lines.join('\n')).toContain('Le task !2026-12-23');
  });

  it('shows the title with its meta as tokens, and a token removed in the editor leaves the comment', () => {
    const d = parseTodo('- [ ] Call <!--\n  due: 2026-11-14\n  tags: home, work\n  -->');
    expect(taskFullText(d.tasks[0])).toBe('Call #home #work !2026-11-14');
    expect(retitleTask(d, 0, 'Call #home').text).toBe('- [ ] Call <!--\n  tags: home\n  -->');
    expect(retitleTask(d, 0, 'Call back #home #work !2026-11-15').text).toBe('- [ ] Call back <!--\n  due: 2026-11-15\n  tags: home, work\n  -->');
    expect(retitleTask(d, 0, 'Call').text).toBe('- [ ] Call');
  });

  it('lists tokens as written', () => {
    expect(listTokens('Call #home @Anna !2026-12-23 ~1h')).toEqual([
      { kind: 'tag', value: 'home', raw: '#home' },
      { kind: 'person', value: 'Anna', raw: '@Anna' },
      { kind: 'due', value: '2026-12-23', raw: '!2026-12-23' },
      { kind: 'estimate', value: '1h', raw: '~1h' },
    ]);
  });

  it('puts an edited title back together with the kept tokens', () => {
    expect(composeTaskText('Le task', ['!2026-12-23'])).toBe('Le task !2026-12-23');
    expect(composeTaskText('  New title ', ['#home', '@Anna'])).toBe('New title #home @Anna');
    expect(composeTaskText('Call !2026-12-24 #Home', ['!2026-12-23', '#home', '~1h'])).toBe('Call !2026-12-24 #Home ~1h');
    expect(composeTaskText('', ['#home'])).toBe('#home');
    expect(composeTaskText('', [])).toBe('');
  });

  it('keeps the original text when the title and tokens did not change', () => {
    expect(retitle('Call #home plumber', 'Call plumber', ['#home'])).toBe('Call #home plumber');
    expect(retitle('Call #home plumber', 'Call the plumber', ['#home'])).toBe('Call the plumber #home');
    expect(retitle('Call #home plumber', 'Call plumber', [])).toBe('Call plumber');
  });

  it('expands date shortcuts', () => {
    // 2026-11-13 is a Friday.
    const t = '2026-11-13';
    expect(expandDateShortcuts('A !today', t)).toBe('A !2026-11-13');
    expect(expandDateShortcuts('A !tomorrow', t)).toBe('A !2026-11-14');
    expect(expandDateShortcuts('A !fri', t)).toBe('A !2026-11-13');
    expect(expandDateShortcuts('A !mon x', t)).toBe('A !2026-11-16 x');
    expect(expandDateShortcuts('A !Wednesday', t)).toBe('A !2026-11-18');
    expect(expandDateShortcuts('A !+3d !+2w', t)).toBe('A !2026-11-16 !2026-11-27');
    expect(expandDateShortcuts('A !+1m', '2026-01-31')).toBe('A !2026-02-28');
    expect(expandDateShortcuts('Wow!fri !important', t)).toBe('Wow!fri !important');
  });
});

describe('values, dates and estimates', () => {
  it('escapes values so they never end the comment', () => {
    const raw = 'a --> b\nnext \\ end';
    expect(encodeValue(raw)).toBe('a --\\> b\\nnext \\\\ end');
    expect(decodeValue(encodeValue(raw))).toBe(raw);
  });

  it('adds days, weeks, months and years', () => {
    expect(addToDay('2026-12-30', 3, 'd')).toBe('2027-01-02');
    expect(addToDay('2026-11-13', 1, 'w')).toBe('2026-11-20');
    expect(addToDay('2026-03-31', 1, 'm')).toBe('2026-04-30');
    expect(addToDay('2028-02-29', 1, 'y')).toBe('2029-02-28');
  });

  it('counts estimates as work time', () => {
    expect(estimateMinutes('1h30m')).toBe(90);
    expect(estimateMinutes('1d')).toBe(480);
    expect(formatMinutes(90)).toBe('1h30m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
  });

  it('reads repeat rules', () => {
    expect(parseRepeat('+1m')).toEqual({ fixed: true, n: 1, unit: 'm' });
    expect(parseRepeat('3d')).toEqual({ fixed: false, n: 3, unit: 'd' });
    expect(parseRepeat('0d')).toBeUndefined();
    expect(parseRepeat('weekly')).toBeUndefined();
    expect(describeRepeat({ fixed: true, n: 1, unit: 'm' })).toBe('every month, fixed dates');
    expect(describeRepeat({ fixed: false, n: 3, unit: 'd' })).toBe('3 days after done');
  });
});

describe('render', () => {
  it('always writes the block form: one key per line', () => {
    const base = { indentText: '  ', marker: '-', checked: false, text: 'A' };
    expect(renderTask({ ...base, data: [] })).toEqual(['  - [ ] A']);
    expect(renderTask({ ...base, data: [{ key: 'id', value: 'a' }] })).toEqual(['  - [ ] A <!--', '    id: a', '    -->']);
    expect(renderTask({ ...base, data: [{ key: 'note', value: 'two words\nnext' }] })).toEqual(['  - [ ] A <!--', '    note: two words\\nnext', '    -->']);
    expect(
      renderTask({
        ...base,
        data: [
          { key: 'id', value: 'a' },
          { key: 'b', value: '1' },
          { key: 'c', value: 'x --> y' },
        ],
      }),
    ).toEqual(['  - [ ] A <!--', '    id: a', '    b: 1', '    c: x --\\> y', '    -->']);
  });

  it('indents the data to the task text', () => {
    expect(renderTask({ indentText: '', marker: '1.', checked: true, text: 'A', data: [{ key: 'id', value: 'a' }] })).toEqual(['1. [x] A <!--', '   id: a', '   -->']);
  });

  it('round-trips the block-form tasks of the sample unchanged', () => {
    // Tasks with tokens on the line change to the comment form (next test).
    const block = parseTodo('- [ ] A <!--\n  due: 2026-11-14\n  estimate: 2h\n  tags: home\n  people: Anna\n  id: a\n  -->');
    expect(renderTask(block.tasks[0])).toEqual(block.lines);
  });

  it('writes tokens on the task line as keys of the comment', () => {
    const doc = parseTodo(SAMPLE);
    expect(renderTask(doc.tasks[0])).toEqual([
      '- [ ] Prepare project report <!--',
      '  due: 2026-11-14',
      '  estimate: 2h',
      '  tags: work',
      '  people: Anna',
      '  id: k3f9',
      '  priority: high',
      '  note: Include financial results and milestones.',
      '  -->',
    ]);
  });

  it('turns the short and below forms into the block form when it writes them', () => {
    const short = parseTodo('- [ ] A <!-- id:a -->');
    expect(renderTask(short.tasks[0])).toEqual(['- [ ] A <!--', '  id: a', '  -->']);
    const below = parseTodo('- [ ] A\n  <!--\n  id: a\n  -->');
    expect(renderTask(below.tasks[0])).toEqual(['- [ ] A <!--', '  id: a', '  -->']);
  });
});

describe('edits', () => {
  const doc = parseTodo(SAMPLE);

  it('rewrites only the lines of the changed task', () => {
    const e = updateTask(doc, 2, { text: 'Write the summary ~1h' });
    const before = SAMPLE.split('\n');
    const after = e.text.split('\n');
    // The `~1h` of the older line moves into the comment: one line more.
    expect(after.slice(0, 8)).toEqual(before.slice(0, 8));
    expect(after.slice(8, 11)).toEqual(['  - [ ] Write the summary <!--', '    estimate: 1h', '    id: x7c1']);
    expect(after.slice(11)).toEqual(before.slice(10));
  });

  it('moves a short comment to the block form when it changes', () => {
    const e = setTaskValue(doc, 1, 'proof', 'see sheet');
    expect(e.text.split('\n').slice(7, 13)).toEqual(['  - [x] Collect numbers <!--', '    id: p0a2', '    done: 2026-11-12', '    proof: see sheet', '    -->', '  - [ ] Write summary ~1h <!--']);
  });

  it('removes the comment when the last key goes', () => {
    const d = parseTodo('- [ ] A <!-- id:a -->');
    expect(setTaskValue(d, 0, 'id', undefined).text).toBe('- [ ] A');
  });

  it('has three main statuses: todo, in progress and done', () => {
    const d = parseTodo('- [ ] A\n- [ ] B <!-- status:inProgress -->\n- [x] C <!-- done:2026-11-12 -->\n- [ ] D <!-- status:waiting -->\n- [ ] E <!-- status:cancelled -->');
    expect(d.tasks.map(statusOf)).toEqual(['todo', 'inProgress', 'done', 'waiting', 'cancelled']);
    const progress = setStatus(d, 0, 'inProgress', '2026-11-13').text;
    expect(progress.split('\n')[0]).toBe('- [ ] A <!--');
    expect(parseTodo(progress).tasks.map(statusOf)[0]).toBe('inProgress');
    const done = parseTodo(setStatus(parseTodo(progress), 0, 'done', '2026-11-13').text);
    expect(statusOf(done.tasks[0])).toBe('done');
    expect(getValue(done.tasks[0], 'done')).toBe('2026-11-13');
    expect(getValue(done.tasks[0], 'status')).toBeUndefined();
    // Back to todo or in progress reopens it and drops the done date.
    const back = parseTodo(setStatus(done, 0, 'todo', '2026-11-13').text);
    expect(statusOf(back.tasks[0])).toBe('todo');
    expect(back.lines[0]).toBe('- [ ] A');
    expect(statusOf(parseTodo(setStatus(done, 0, 'inProgress', '2026-11-13').text).tasks[0])).toBe('inProgress');
    // Todo clears waiting and in progress; the same status changes nothing.
    expect(statusOf(parseTodo(setStatus(d, 3, 'todo', '2026-11-13').text).tasks[3])).toBe('todo');
    expect(setStatus(d, 1, 'inProgress', '2026-11-13').text).toBe(d.lines.join('\n'));
  });

  it('marks done with a date, and back', () => {
    const d = parseTodo('- [ ] A <!-- id:a status:inProgress -->');
    const done = setDone(d, 0, true, '2026-11-13').text;
    expect(done).toBe('- [x] A <!--\n  id: a\n  done: 2026-11-13\n  -->');
    expect(setDone(parseTodo(done), 0, false, '2026-11-13').text).toBe('- [ ] A <!--\n  id: a\n  -->');
  });

  it('moves a repeating task to its next date instead of closing it', () => {
    const fixed = parseTodo('- [ ] Pay rent !2026-11-01 <!-- repeat:+1m -->');
    expect(setDone(fixed, 0, true, '2026-11-13').text).toBe('- [ ] Pay rent <!--\n  due: 2026-12-01\n  repeat: +1m\n  last: 2026-11-13\n  -->');
    const after = parseTodo('- [ ] Water plants <!-- repeat:3d -->');
    expect(setDone(after, 0, true, '2026-11-13').text).toBe('- [ ] Water plants <!--\n  due: 2026-11-16\n  repeat: 3d\n  last: 2026-11-13\n  -->');
  });

  it('stops repeating after `until` or the last of `times`', () => {
    const until = parseTodo('- [ ] A !2026-11-13 <!-- repeat:+1w until:2026-11-15 -->');
    expect(setDone(until, 0, true, '2026-11-13').text).toBe('- [x] A <!--\n  due: 2026-11-13\n  repeat: +1w\n  until: 2026-11-15\n  done: 2026-11-13\n  -->');
    const two = parseTodo('- [ ] A <!-- repeat:1d times:2 -->');
    const once = setDone(two, 0, true, '2026-11-13').text;
    expect(once).toBe('- [ ] A <!--\n  due: 2026-11-14\n  repeat: 1d\n  times: 1\n  last: 2026-11-13\n  -->');
    expect(setDone(parseTodo(once), 0, true, '2026-11-14').text).toMatch(/^- \[x\] A <!--\n {2}due: 2026-11-14/);
  });

  it('marks a task and its open subtasks done in one edit', () => {
    const e = setDoneWithSubtasks(doc, 0, '2026-11-13');
    const d = parseTodo(e.text);
    expect(d.tasks.map((t) => t.checked)).toEqual([true, true, true, false]);
    expect(getValue(d.tasks[1], 'done')).toBe('2026-11-12');
    expect(getValue(d.tasks[2], 'done')).toBe('2026-11-13');
    expect(getValue(d.tasks[2], 'status')).toBeUndefined();
  });

  it('finds the end of a task with its subtasks', () => {
    expect(subtreeEnd(doc, 0)).toBe(12);
    expect(subtreeEnd(doc, 3)).toBe(13);
  });

  it('inserts a task after another one and its subtasks', () => {
    const e = insertTask(doc, 0, 'New');
    expect(e.focus).toBe(13);
    expect(e.text.split('\n')[13]).toBe('- [ ] New');
    const child = insertTask(doc, 1, 'Sub');
    expect(child.text.split('\n')[8]).toBe('  - [ ] Sub');
  });

  it('inserts into an empty file, and numbers ordered lists', () => {
    expect(insertTask(parseTodo(''), null, 'First')).toEqual({ text: '- [ ] First\n', focus: 0 });
    expect(insertTask(parseTodo('# List\n\n\n'), null)).toEqual({ text: '# List\n- [ ]\n', focus: 1 });
    expect(insertTask(parseTodo('1. [ ] A'), 0, 'B').text).toBe('1. [ ] A\n2. [ ] B');
  });

  it('adds a subtask after the last one, or as the first one', () => {
    const e = insertSubtask(doc, 0, 'Check');
    expect(e.focus).toBe(13);
    expect(e.text.split('\n')[13]).toBe('  - [ ] Check');
    expect(parseTodo(e.text).tasks[3]).toMatchObject({ text: 'Check', parent: 0 });
    const first = insertSubtask(doc, 3);
    expect(first.text.split('\n')[14]).toBe('  - [ ]');
    expect(parseTodo(first.text).tasks[4].parent).toBe(3);
    expect(insertSubtask(parseTodo('1. [ ] A\n   1. [ ] A1'), 0, 'A2').text).toBe('1. [ ] A\n   1. [ ] A1\n   2. [ ] A2');
  });

  it('puts tasks in board lanes and moves them between lanes', () => {
    const d = parseTodo(['- [ ] A', '- [ ] B <!-- status:inProgress -->', '- [x] C <!-- done:2026-11-12 -->', '- [ ] D <!-- status:cancelled -->', '- [ ] E <!-- status:waiting -->'].join('\n'));
    expect(d.tasks.map(laneOf)).toEqual(['todo', 'inProgress', 'done', 'done', 'todo']);
    const t = '2026-11-13';
    expect(setLane(d, 0, 'inProgress', t).text.split('\n').slice(0, 4)).toEqual(['- [ ] A <!--', '  status: inProgress', '  -->', '- [ ] B <!-- status:inProgress -->']);
    expect(setLane(d, 1, 'todo', t).text.split('\n')[1]).toBe('- [ ] B');
    expect(setLane(d, 1, 'done', t).text.split('\n').slice(1, 4)).toEqual(['- [x] B <!--', '  done: 2026-11-13', '  -->']);
    expect(setLane(d, 2, 'inProgress', t).text.split('\n').slice(2, 5)).toEqual(['- [ ] C <!--', '  status: inProgress', '  -->']);
    expect(setLane(d, 3, 'todo', t).text.split('\n')[3]).toBe('- [ ] D');
    expect(setLane(d, 4, 'todo', t).text).toBe(d.lines.join('\n'));
  });

  it('deletes a task with its subtasks', () => {
    expect(deleteTask(doc, 0).text).toBe('# Work\n\n- [ ] Pay rent !2026-12-01 <!-- id:r5t8 repeat:+1m -->\n');
  });

  it('moves a task with its subtasks up and down among its siblings', () => {
    const up = moveTask(doc, 3, -1);
    const d = parseTodo(up.text);
    expect(up.focus).toBe(2);
    expect(d.tasks.map((t) => t.text.split(' ')[0])).toEqual(['Pay', 'Prepare', 'Collect', 'Write']);
    expect(parseTodo(moveTask(doc, 2, -1).text).tasks.map((t) => t.text.split(' ')[0])).toEqual(['Prepare', 'Write', 'Collect', 'Pay']);
    expect(moveTask(doc, 1, -1).text).toBe(SAMPLE);
  });

  it('indents a task under the one above, and back', () => {
    const d = parseTodo('- [ ] A\n- [ ] B <!--\n  id: b\n  x: 1\n  y: 2\n  -->\n  - [ ] B1');
    const ind = indentTask(d, 1);
    expect(ind.text).toBe('- [ ] A\n  - [ ] B <!--\n    id: b\n    x: 1\n    y: 2\n    -->\n    - [ ] B1');
    const back = parseTodo(ind.text);
    expect(back.tasks[1].parent).toBe(0);
    expect(outdentTask(back, 1).text).toBe('- [ ] A\n- [ ] B <!--\n  id: b\n  x: 1\n  y: 2\n  -->\n  - [ ] B1');
  });

  it('outdents a middle subtask after its parent and the other subtasks', () => {
    const d = parseTodo('- [ ] A\n  - [ ] A1\n  - [ ] A2\n- [ ] B');
    const e = outdentTask(d, 1);
    expect(e.text).toBe('- [ ] A\n  - [ ] A2\n- [ ] A1\n- [ ] B');
    expect(e.focus).toBe(2);
  });

  it('drops a task before, after or into another task', () => {
    const d = parseTodo('- [ ] A\n- [ ] B\n  - [ ] B1\n- [ ] C');
    expect(moveTaskTo(d, 3, 0, 'before').text).toBe('- [ ] C\n- [ ] A\n- [ ] B\n  - [ ] B1');
    expect(moveTaskTo(d, 0, 1, 'after').text).toBe('- [ ] B\n  - [ ] B1\n- [ ] A\n- [ ] C');
    const into = moveTaskTo(d, 3, 1, 'child');
    expect(into.text).toBe('- [ ] A\n- [ ] B\n  - [ ] B1\n  - [ ] C');
    expect(into.focus).toBe(3);
    expect(moveTaskTo(d, 1, 2, 'child').text).toBe(d.lines.join('\n'));
  });

  it('links tasks and gives the target an id', () => {
    const d = parseTodo('- [ ] A\n- [ ] B <!-- id:bbbb -->');
    const e = linkTask(d, 1, 'after', 0, () => 0);
    expect(e.text).toBe('- [ ] A <!--\n  id: aaaa\n  -->\n- [ ] B <!--\n  id: bbbb\n  after: aaaa\n  -->');
    expect(e.focus).toBe(3);
    expect(unlinkTask(parseTodo(e.text), 1, 'after', 'aaaa').text).toBe('- [ ] A <!--\n  id: aaaa\n  -->\n- [ ] B <!--\n  id: bbbb\n  -->');
  });

  it('replaces the lines of one task from its text editor', () => {
    const e = replaceTaskLines(doc, 3, '- [ ] Pay rent <!--\n  repeat: +1m\n  -->\n');
    expect(e.text.split('\n').slice(13)).toEqual(['- [ ] Pay rent <!--', '  repeat: +1m', '  -->', '']);
    expect(replaceTaskLines(doc, 3, '  \n').text.split('\n').slice(12)).toEqual(['    -->', '']);
  });

  it('makes unique ids that start with a letter', () => {
    const seq = [0.99, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const id = newTaskId(new Set(['aaaa']), () => seq[i++ % seq.length]);
    expect(id).toMatch(/^[a-z][a-z0-9]{3,}$/);
    expect(id).not.toBe('aaaa');
  });

  it('summarizes done and overdue tasks', () => {
    expect(summary(doc, '2026-11-20')).toEqual({ done: 1, total: 4, overdue: 1 });
  });
});

describe('ensureTaskId', () => {
  it('adds an id to the comment of a task that has none', () => {
    const d = parseTodo('- [ ] One\n- [ ] Two');
    const r = ensureTaskId(d, 1, () => 0);
    expect(r.text).toContain('id: ' + r.id);
    const again = parseTodo(r.text);
    expect(getValue(again.tasks[1], 'id')).toBe(r.id);
    expect(getValue(again.tasks[0], 'id')).toBeUndefined();
  });

  it('keeps the id a task has', () => {
    const d = parseTodo('- [ ] One <!--\n  id: abcd\n  -->');
    const r = ensureTaskId(d, 0);
    expect(r.id).toBe('abcd');
    expect(r.text).toBe(d.lines.join('\n'));
  });
});
