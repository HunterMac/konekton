import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { isTextFilePath, type FileNode as FileModel } from '../../../src/shared/canvasFormat';
import { basename, dirname } from '../../../src/shared/paths';
import { useBoard, useBoardStore } from '../useBoard';
import { Codicon } from '../ui/icons';
import { keepNativeUndo } from '../ui/textKeys';
import { TextToolbar } from '../ui/TextToolbar';
import { ConnectionBalls } from './ConnectionBalls';
import { PlanBadges, isDone, type ObjectData } from './PlanBadges';
import { ResizeCorner } from './ResizeCorner';

export type FileRFNode = Node<ObjectData<FileModel>, 'file'>;

function jsonError(path: string, text: string | undefined): string | undefined {
  if (text === undefined || !path.toLowerCase().endsWith('.json')) return undefined;
  try {
    JSON.parse(text);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function FileNode({ id, data }: NodeProps<FileRFNode>) {
  const node = data.model;
  const store = useBoardStore();
  const file = useBoard((s) => s.files[node.file]);
  const edit = useBoard((s) => s.fileEdits[id]);
  const editing = useBoard((s) => s.editing?.nodeId === id);
  const fileReferences = useBoard((s) => s.features.fileReferences);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && edit) {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
    // Focus once when edit mode starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const status = file?.status;
  const text = edit ? edit.draft : file?.text;
  const missing = status === 'missing';
  const warning = status === 'ok' || edit ? jsonError(node.file, text) : undefined;
  const dir = dirname(node.file);
  const textStyle = { fontSize: node.fontSize, textAlign: node.align, fontWeight: node.bold ? 700 : 400 } as const;

  const onKeyDown = (e: KeyboardEvent) => {
    keepNativeUndo(e);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      store.getState().endFileEdit(id);
    }
  };

  let body;
  if (!fileReferences) {
    // The host cannot read files: show the path only.
    body = null;
  } else if (missing) {
    body = <div className="eb-file-note">Missing file: {node.file}</div>;
  } else if (status === 'tooLarge') {
    body = <div className="eb-file-note">File too large to preview</div>;
  } else if (status === 'binary' || (status === 'ok' && !isTextFilePath(node.file))) {
    body = <div className="eb-file-note">No preview</div>;
  } else if (status === undefined) {
    body = <div className="eb-file-note">Loading…</div>;
  } else if (editing && edit) {
    body = (
      <textarea
        ref={areaRef}
        className="eb-file-text eb-text-edit nodrag nowheel nopan"
        style={textStyle}
        value={edit.draft}
        spellCheck={false}
        onChange={(e) => store.getState().setFileDraft(id, e.target.value)}
        onKeyDown={onKeyDown}
      />
    );
  } else {
    body = (
      <div className="eb-file-text" style={textStyle} onDoubleClick={() => store.getState().beginFileEdit(id)}>
        {text}
      </div>
    );
  }

  return (
    <>
      <TextToolbar node={node} />
      <div className={`eb-node eb-file${missing ? ' missing' : ''}${isDone(node) ? ' eb-done' : ''}`}>
        <div className="eb-file-header" title={node.file}>
          <Codicon name="file" className="eb-file-icon" />
          <span className="eb-path">
            {dir !== '' && <span className="eb-path-dir">{dir}/</span>}
            <span className="eb-path-base">{basename(node.file)}</span>
          </span>
          {warning !== undefined && (
            <span className="eb-warning" title={`Invalid JSON: ${warning}`}>
              <Codicon name="warning" />
            </span>
          )}
          {!missing && fileReferences && (
            <button type="button" className="eb-btn eb-open nodrag" title="Open in editor" onClick={() => store.getState().openFile(node.file)}>
              <Codicon name="go-to-file" />
            </button>
          )}
        </div>
        {edit?.conflict && (
          <div className="eb-banner nodrag">
            <span>File changed on disk</span>
            <button type="button" onClick={() => store.getState().reloadFile(id)}>
              Reload
            </button>
            <button type="button" onClick={() => store.getState().overwriteFile(id)}>
              Overwrite
            </button>
          </div>
        )}
        {body !== null && <div className="eb-file-body">{body}</div>}
      </div>
      <PlanBadges node={node} plans={data.plans} />
      <ConnectionBalls />
      <ResizeCorner id={id} />
    </>
  );
}
