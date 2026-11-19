import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  describeRepeat,
  getValue,
  idList,
  isEstimate,
  isValidDay,
  linkTask,
  parseRepeat,
  setMeta,
  setStatus,
  setTaskValue,
  statusOf,
  taskById,
  taskMeta,
  unlinkTask,
  type MainStatus,
  type TodoDoc,
  type TodoEdit,
} from '../../../../src/shared/todoFormat';
import { shortDate } from '../../layout/dates';

type FieldKey = 'due' | 'estimate' | 'priority' | 'start' | 'repeat' | 'until' | 'times' | 'remind' | 'snooze' | 'after' | 'rel' | 'today' | 'proof';

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'due', label: 'Due' },
  { key: 'estimate', label: 'Estimate' },
  { key: 'priority', label: 'Priority' },
  { key: 'start', label: 'Start' },
  { key: 'repeat', label: 'Repeat' },
  { key: 'until', label: 'Repeat until' },
  { key: 'times', label: 'Repeat times' },
  { key: 'remind', label: 'Reminder' },
  { key: 'snooze', label: 'Snooze until' },
  { key: 'after', label: 'Waits for' },
  { key: 'rel', label: 'Related' },
  { key: 'today', label: 'Today' },
  { key: 'proof', label: 'Proof' },
];

/**
 * Keys with their own control or shown in the meta line, or shown as chips (`tags`, `people`). Other keys are listed
 * under "Other". Due and estimate are hidden keys too (they used to be visible tokens on the task line).
 */
const KNOWN_KEYS = new Set<string>(['note', 'id', 'created', 'done', 'last', 'tags', 'people', 'status', ...FIELDS.map((f) => f.key)]);

const PRIORITIES = ['low', 'medium', 'high'] as const;
/** The three main statuses, always shown. */
const STATUSES: { value: MainStatus; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];
const OTHER_STATUS_LABELS = { waiting: 'Waiting', cancelled: 'Cancelled' } as const;

const isDateTime = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && isValidDay(v.slice(0, 10));

/** Text input that saves on Enter or blur. `valid` rejects a value (red border, not saved). */
function TextField({ value, placeholder, valid, onCommit, multiline }: { value: string; placeholder?: string; valid?: (v: string) => boolean; onCommit(v: string): void; multiline?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  /** Set by Escape: the blur that follows must not save the draft (its `draft` is still the typed one). */
  const cancelled = useRef(false);
  const ok = draft.trim() === '' || !valid || valid(draft.trim());
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft !== value && ok) onCommit(multiline ? draft.replace(/\s+$/, '') : draft.trim());
    else if (!ok) setDraft(value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelled.current = true;
      setDraft(value);
      e.currentTarget.blur();
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };
  if (multiline) {
    return (
      <textarea
        className="eb-todo-input eb-todo-note-input"
        value={draft}
        placeholder={placeholder}
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <input
      className={`eb-todo-input${ok ? '' : ' invalid'}`}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}

function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string | undefined; onChange(v: string | undefined): void }) {
  return (
    <span className="eb-todo-seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'active' : ''} onClick={() => onChange(value === o.value ? undefined : o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="eb-todo-field">
      <span className="eb-todo-label">{label}</span>
      <span className="eb-todo-control">{children}</span>
    </div>
  );
}

const Clear = ({ onClick }: { onClick(): void }) => (
  <button type="button" className="eb-todo-x" title="Remove" onClick={onClick}>
    ×
  </button>
);

const titleOf = (doc: TodoDoc, i: number) => taskMeta(doc.tasks[i]).title || '(no title)';

interface Props {
  doc: TodoDoc;
  index: number;
  today: string;
  apply(edit: TodoEdit): void;
  onRawEdit(): void;
  /** Unset: no "+ Add subtask" (Board mode shows no subtasks to type in). */
  onAddSubtask?(): void;
}

/** The open block: description (the `note` key), the fields that have a value, "+ Add field", and the meta line. */
export function TodoDetails({ doc, index, today, apply, onRawEdit, onAddSubtask }: Props) {
  const task = doc.tasks[index];
  const tokens = taskMeta(task);
  const [added, setAdded] = useState<Set<FieldKey>>(new Set());
  const value = (key: string) => getValue(task, key);
  const setKey = (key: string, v: string | undefined) => apply(setTaskValue(doc, index, key, v === '' ? undefined : v));

  const has = (key: FieldKey) => (key === 'due' ? tokens.due !== undefined : key === 'estimate' ? tokens.estimate !== undefined : value(key) !== undefined);
  const shown = FIELDS.filter((f) => has(f.key) || added.has(f.key));
  const missing = FIELDS.filter((f) => !shown.includes(f));

  const addField = (key: FieldKey) => {
    if (key === 'today') setKey('today', today);
    else setAdded(new Set([...added, key]));
  };

  const links = (key: 'after' | 'rel') => {
    const ids = idList(value(key));
    const options = doc.tasks.map((_t, i) => i).filter((i) => i !== index && !ids.includes(getValue(doc.tasks[i], 'id') ?? '\0'));
    return (
      <span className="eb-todo-links">
        {ids.map((id) => {
          const i = taskById(doc, id);
          return (
            <span key={id} className={`eb-todo-chip link${i >= 0 && doc.tasks[i].checked ? ' done' : ''}`} title={i < 0 ? `No task with id ${id} in this file` : undefined}>
              {i >= 0 ? titleOf(doc, i) : id}
              <Clear onClick={() => apply(unlinkTask(doc, index, key, id))} />
            </span>
          );
        })}
        {options.length > 0 && (
          <select className="eb-todo-select" value="" onChange={(e) => e.target.value !== '' && apply(linkTask(doc, index, key, Number(e.target.value)))}>
            <option value="">+ Task…</option>
            {options.map((i) => (
              <option key={i} value={i}>
                {'  '.repeat(doc.tasks[i].depth)}
                {titleOf(doc, i)}
              </option>
            ))}
          </select>
        )}
      </span>
    );
  };

  const control = (key: FieldKey): ReactNode => {
    switch (key) {
      case 'due': {
        const due = tokens.due;
        return (
          <>
            <input
              type="date"
              className="eb-todo-input"
              value={due?.slice(0, 10) ?? ''}
              onChange={(e) => {
                const day = e.target.value;
                apply(setMeta(doc, index, 'due', day === '' ? undefined : `${day}${due && due.length > 10 ? due.slice(10) : ''}`));
              }}
            />
            {due !== undefined && <Clear onClick={() => apply(setMeta(doc, index, 'due', undefined))} />}
          </>
        );
      }
      case 'estimate':
        return <TextField value={tokens.estimate ?? ''} placeholder="2h, 30m, 1d" valid={(v) => isEstimate(v.replace(/^~/, ''))} onCommit={(v) => apply(setMeta(doc, index, 'estimate', v === '' ? undefined : v.replace(/^~/, '')))} />;
      case 'priority':
        return <Segmented options={PRIORITIES.map((p) => ({ value: p, label: p }))} value={value('priority')} onChange={(v) => setKey('priority', v)} />;
      case 'start':
      case 'until':
        return (
          <>
            <input type="date" className="eb-todo-input" value={value(key) ?? ''} onChange={(e) => setKey(key, e.target.value)} />
            {value(key) !== undefined && <Clear onClick={() => setKey(key, undefined)} />}
          </>
        );
      case 'remind':
      case 'snooze':
        return (
          <>
            <input type="datetime-local" className="eb-todo-input" value={value(key) && isDateTime(value(key)!) ? value(key) : ''} onChange={(e) => setKey(key, e.target.value)} />
            {value(key) !== undefined && <Clear onClick={() => setKey(key, undefined)} />}
          </>
        );
      case 'repeat': {
        const rule = parseRepeat(value('repeat'));
        return (
          <>
            <TextField value={value('repeat') ?? ''} placeholder="3d after done, +1m fixed" valid={(v) => parseRepeat(v) !== undefined} onCommit={(v) => setKey('repeat', v)} />
            {rule && <span className="eb-todo-hint">{describeRepeat(rule)}</span>}
          </>
        );
      }
      case 'times':
        return <TextField value={value('times') ?? ''} placeholder="12" valid={(v) => /^\d+$/.test(v)} onCommit={(v) => setKey('times', v)} />;
      case 'after':
      case 'rel':
        return links(key);
      case 'today': {
        const day = value('today');
        if (day === undefined) return null;
        if (day < today) {
          return (
            <>
              <span className="eb-todo-hint overdue">Left over from {isValidDay(day) ? shortDate(day) : day}</span>
              <button type="button" className="eb-todo-small" onClick={() => setKey('today', today)}>
                Keep for today
              </button>
              <button type="button" className="eb-todo-small" onClick={() => setKey('today', undefined)}>
                Send back
              </button>
            </>
          );
        }
        return (
          <>
            <span className="eb-todo-hint">{day === today ? 'Picked for today' : `Picked for ${isValidDay(day) ? shortDate(day) : day}`}</span>
            <Clear onClick={() => setKey('today', undefined)} />
          </>
        );
      }
      case 'proof':
        return <TextField value={value('proof') ?? ''} placeholder="Note or link" onCommit={(v) => setKey('proof', v)} />;
    }
  };

  const status = statusOf(task);
  // An older `waiting` or `cancelled` shows as a fourth choice while it is set.
  const statusOptions: { value: string; label: string }[] = status === 'waiting' || status === 'cancelled' ? [...STATUSES, { value: status, label: OTHER_STATUS_LABELS[status] }] : STATUSES;
  const other = task.data.filter((e) => e.key !== '' && !KNOWN_KEYS.has(e.key));
  const rawLines = task.data.filter((e) => e.key === '');
  const meta: [string, string][] = [];
  for (const [label, key] of [
    ['id', 'id'],
    ['created', 'created'],
    ['done', 'done'],
    ['last done', 'last'],
  ] as const) {
    const v = value(key);
    if (v !== undefined) meta.push([label, v]);
  }

  return (
    <div className="eb-todo-details">
      <Row label="Status">
        <Segmented
          options={statusOptions}
          value={status}
          // A click on the active status does nothing: a task always has one.
          onChange={(v) => v !== undefined && v !== status && (v === 'todo' || v === 'inProgress' || v === 'done') && apply(setStatus(doc, index, v, today))}
        />
      </Row>
      <TextField multiline value={value('note') ?? ''} placeholder="Description" onCommit={(v) => setKey('note', v)} />
      {shown.map((f) => (
        <Row key={f.key} label={f.label}>
          {control(f.key)}
        </Row>
      ))}
      {other.map((e, i) => (
        <Row key={`${e.key}:${i}`} label={e.key}>
          <TextField value={e.value} onCommit={(v) => setKey(e.key, v)} />
        </Row>
      ))}
      {rawLines.length > 0 && (
        <div className="eb-todo-raw-lines" title="These lines are not key: value. Fix them with Text.">
          {rawLines.map((e, i) => (
            <div key={i}>{e.value}</div>
          ))}
        </div>
      )}
      <div className="eb-todo-actions">
        {missing.length > 0 && (
          <select className="eb-todo-select" value="" onChange={(e) => e.target.value !== '' && addField(e.target.value as FieldKey)}>
            <option value="">+ Add field</option>
            {missing.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        )}
        {onAddSubtask && (
          <button type="button" className="eb-todo-add-sub" title="Add a subtask at the end of this task's subtasks" onClick={onAddSubtask}>
            + Add subtask
          </button>
        )}
        {meta.length > 0 && (
          <span className="eb-todo-meta">
            {meta.map(([k, v]) => (
              <span key={k}>
                {k} {k !== 'id' && isValidDay(v) ? shortDate(v) : v}
              </span>
            ))}
          </span>
        )}
        <button type="button" className="eb-todo-small" title="Edit the Markdown of this task" onClick={onRawEdit}>
          Text
        </button>
      </div>
    </div>
  );
}
