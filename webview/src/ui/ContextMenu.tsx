import { useState, type ReactNode } from 'react';
import { PLAN_NAMES, STATUSES, isBoardNode, type PlanType } from '../../../src/shared/canvasFormat';
import { useBoard, useBoardStore } from '../useBoard';
import { planOf } from '../plans';
import type { Point } from '../geometry';
import { Codicon } from './icons';
import { STATUS_LABELS } from './statusLabels';

interface Item {
  label: string;
  icon: string;
  run(): void;
  /** Opens a list of sub items inside the same menu instead of running. */
  sub?: Item[];
}

const PLAN_ICONS: Record<PlanType, string> = { board: 'project', timeline: 'calendar' };

/** Custom right-click menu: objects, lines, and the empty board. */
export function ContextMenu({ origin, viewCenter }: { origin: { left: number; top: number }; viewCenter: () => Point }) {
  const store = useBoardStore();
  const menu = useBoard((s) => s.contextMenu);
  const mode = useBoard((s) => s.mode);
  const doc = useBoard((s) => s.doc);
  const fileReferences = useBoard((s) => s.features.fileReferences);
  // The status list is open for one menu at a time: a new menu starts closed.
  const [statusOpenFor, setStatusOpenFor] = useState<object | null>(null);
  if (!menu) return null;

  const api = () => store.getState();
  const close = () => api().setContextMenu(null);
  const paste = async () => {
    const text = await api().readClipboard();
    api().pasteText(text, viewCenter(), menu.flow);
  };
  const copy = () => {
    const text = api().copyText();
    if (text) api().writeClipboard(text);
  };

  const items: Item[] = [];
  const { target } = menu;
  const ids = api().selNodes.length > 0 ? api().selNodes : target.kind === 'node' ? [target.id] : [];

  const statusItem = (): Item => ({
    label: 'Status',
    icon: 'checklist',
    run: () => setStatusOpenFor(menu),
    sub: STATUSES.map((status) => ({ label: STATUS_LABELS[status], icon: 'circle-small-filled', run: () => api().setStatus(ids, status) })),
  });

  if (target.kind === 'node' && mode !== 'chaos') {
    const type: PlanType = mode;
    items.push({ label: 'Show in Chaos', icon: 'target', run: () => api().showInChaos(target.id) });
    if (type === 'board') items.push(statusItem());
    else items.push({ label: 'Clear date', icon: 'calendar', run: () => api().setDate(ids, undefined) });
    items.push({ label: `Remove from ${PLAN_NAMES[type]}`, icon: 'close', run: () => api().removeFromPlan(type, ids) });
  } else if (target.kind === 'node') {
    const node = doc.nodes.find((n) => isBoardNode(n) && n.id === target.id);
    items.push({ label: 'Copy', icon: 'copy', run: copy }, { label: 'Paste', icon: 'clippy', run: () => void paste() }, { label: 'Duplicate', icon: 'files', run: () => api().duplicateSelection() });
    if (node?.kind === 'file' && fileReferences) items.push({ label: 'Open in editor', icon: 'go-to-file', run: () => api().openFile(node.file) });
    if (node?.kind === 'link') {
      items.push(
        { label: 'Open link', icon: 'link', run: () => api().openUrl(node.url) },
        {
          label: 'Edit URL',
          icon: 'edit',
          run: () => void api().promptUrl(node.url).then((url) => url && api().updateNode(node.id, { url })),
        },
      );
    }
    for (const type of ['board', 'timeline'] as const) {
      const have = new Set(planOf(doc, type).items);
      const name = PLAN_NAMES[type];
      const icon = PLAN_ICONS[type];
      if (ids.some((id) => !have.has(id))) items.push({ label: `Add to ${name}`, icon, run: () => api().addToPlan(type, ids) });
      if (ids.some((id) => have.has(id))) items.push({ label: `Remove from ${name}`, icon: 'close', run: () => api().removeFromPlan(type, ids) });
    }
    items.push(statusItem());
    items.push({ label: 'Delete', icon: 'trash', run: () => api().deleteSelection() });
  } else if (target.kind === 'edge') {
    items.push({ label: 'Delete', icon: 'trash', run: () => api().deleteEdge(target.id) });
  } else {
    items.push({ label: 'Paste', icon: 'clippy', run: () => void paste() });
  }

  const row = (item: Item, nested = false): ReactNode => {
    const open = item.sub !== undefined && statusOpenFor === menu;
    return (
      <div key={item.label} className="eb-menu-group">
        <button
          type="button"
          className={`eb-menu-item${nested ? ' nested' : ''}`}
          onClick={() => {
            if (item.sub) {
              setStatusOpenFor(open ? null : menu);
              return;
            }
            close();
            item.run();
          }}
        >
          <Codicon name={item.icon} />
          {item.label}
          {item.sub && <Codicon name={open ? 'chevron-down' : 'chevron-right'} className="eb-menu-more" />}
        </button>
        {open && item.sub?.map((sub) => row(sub, true))}
      </div>
    );
  };

  return (
    <>
      <div className="eb-backdrop" onPointerDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
      <div className="eb-menu eb-ui" style={{ left: menu.screen.x - origin.left, top: menu.screen.y - origin.top }}>
        {items.map((item) => row(item))}
      </div>
    </>
  );
}
