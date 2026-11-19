import {
  describeRepeat,
  descendants,
  estimateMinutes,
  formatMinutes,
  getValue,
  idList,
  isCancelled,
  isOverdue,
  parseRepeat,
  taskById,
  taskMeta,
  type TodoDoc,
} from '../../../../src/shared/todoFormat';
import { shortDate } from '../../layout/dates';
import { Codicon } from '../../ui/icons';

/** The chips after a task title: tags, people, due date, estimate, and icons for repeat, reminder, waits for, today. */
export function TaskChips({ doc, index, today }: { doc: TodoDoc; index: number; today: string }) {
  const t = doc.tasks[index];
  const tokens = taskMeta(t);
  const repeat = parseRepeat(getValue(t, 'repeat'));
  const remind = getValue(t, 'remind');
  const pick = getValue(t, 'today');
  const waitsFor = idList(getValue(t, 'after'))
    .map((id) => taskById(doc, id))
    .filter((i) => i >= 0 && !doc.tasks[i].checked && !isCancelled(doc.tasks[i]));
  const subEstimate = descendants(doc, index)
    .map((d) => doc.tasks[d])
    .filter((d) => !d.checked && !isCancelled(d))
    .reduce((sum, d) => sum + estimateMinutes(taskMeta(d).estimate ?? ''), 0);
  const due = tokens.due;
  const dueLabel = due !== undefined ? `${shortDate(due.slice(0, 10))}${due.length > 10 ? ` ${due.slice(11)}` : ''}` : undefined;

  return (
    <>
      {/* Index in the key: a tag may be typed twice. */}
      {tokens.tags.map((tag, i) => (
        <span key={`#${tag}:${i}`} className="eb-todo-chip tag">
          #{tag}
        </span>
      ))}
      {tokens.people.map((who, i) => (
        <span key={`@${who}:${i}`} className="eb-todo-chip person">
          @{who}
        </span>
      ))}
      {dueLabel && <span className={`eb-todo-chip due${isOverdue(t, today) ? ' overdue' : due?.slice(0, 10) === today ? ' today' : ''}`}>{dueLabel}</span>}
      {(tokens.estimate !== undefined || subEstimate > 0) && (
        <span className="eb-todo-chip est" title={subEstimate > 0 ? `Open subtasks: ${formatMinutes(subEstimate)}` : undefined}>
          {tokens.estimate ?? ''}
          {tokens.estimate !== undefined && subEstimate > 0 ? ' · ' : ''}
          {subEstimate > 0 ? `Σ${formatMinutes(subEstimate)}` : ''}
        </span>
      )}
      {repeat && (
        <span className="eb-todo-icon" title={`Repeats: ${describeRepeat(repeat)}`}>
          <Codicon name="sync" />
        </span>
      )}
      {remind !== undefined && (
        <span className="eb-todo-icon" title={`Reminder: ${remind.replace('T', ' ')}`}>
          <Codicon name="bell" />
        </span>
      )}
      {waitsFor.length > 0 && (
        <span className="eb-todo-icon" title={`Waits for: ${waitsFor.map((i) => taskMeta(doc.tasks[i]).title).join(', ')}`}>
          <Codicon name="lock" />
          {waitsFor.length}
        </span>
      )}
      {pick !== undefined && (
        <span className={`eb-todo-icon${pick < today ? ' overdue' : ''}`} title={pick < today ? `Left over from Today (${pick})` : 'Picked for Today'}>
          <Codicon name="star-full" />
        </span>
      )}
    </>
  );
}
