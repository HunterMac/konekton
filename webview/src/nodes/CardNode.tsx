import type { Node, NodeProps } from '@xyflow/react';
import { resolveColor, type BoardNode } from '../../../src/shared/canvasFormat';
import { basename } from '../../../src/shared/paths';
import { shortDate } from '../layout/dates';
import { statusOf } from '../plans';
import { STATUS_LABELS } from '../ui/statusLabels';
import { Codicon } from '../ui/icons';

export type CardRFNode = Node<{ model: BoardNode; showDate: boolean }, 'card'>;

function summary(node: BoardNode): { icon?: string; text: string; bold?: boolean } {
  switch (node.kind) {
    case 'sticky':
      return { text: node.text };
    case 'rectangle':
      return node.title !== '' ? { text: node.title, bold: true } : { text: node.text };
    case 'file':
      return { icon: 'file', text: basename(node.file) };
    case 'link':
      return { icon: 'link', text: node.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') };
  }
}

/** One compact card for every object kind, used in Board and Timeline. No handles, no resizing, no editing. */
export function CardNode({ data }: NodeProps<CardRFNode>) {
  const node = data.model;
  const colors = node.kind === 'sticky' || node.kind === 'rectangle' ? resolveColor(node.color) : undefined;
  const { icon, text, bold } = summary(node);
  const status = statusOf(node);
  return (
    <div
      className="eb-node eb-card"
      style={{ background: colors?.fill ?? '#fff', borderColor: colors?.border ?? '#c4c4c4' }}
      title={text}
    >
      <div className="eb-card-body" style={bold ? { fontWeight: 700 } : undefined}>
        {icon !== undefined && <Codicon name={icon} className="eb-card-icon" />}
        {text}
      </div>
      <div className="eb-card-foot">
        <span className={`eb-status-dot ${status}`} title={STATUS_LABELS[status]} />
        {data.showDate && node.date !== undefined && <span className="eb-card-date">{shortDate(node.date)}</span>}
      </div>
    </div>
  );
}
