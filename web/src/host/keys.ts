import type { WebDocument } from './WebDocument';

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Keys VS Code handles for the extension: undo/redo and save. Also asks before the tab closes with unsaved changes.
 * `afterSave` runs after Ctrl/Cmd+S has saved (Drive mode: sync at once).
 * Returns a function that removes the listeners.
 */
export function installKeys(doc: WebDocument, afterSave?: () => void): () => void {
  // Bubble phase: text fields stop Ctrl/Cmd+Z/Y themselves (keepNativeUndo) and keep their own text undo.
  const onUndoKeys = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isTextTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      doc.undo();
    } else if ((key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey)) {
      e.preventDefault();
      doc.redo();
    }
  };
  // Capture phase: text fields may stop the event. Never let the browser open its "Save page" box.
  const onSave = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void doc.saveNow().then(afterSave);
    }
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!doc.isDirty()) return;
    e.preventDefault();
    // Older browsers ask only when returnValue is set.
    e.returnValue = '';
  };
  window.addEventListener('keydown', onUndoKeys);
  window.addEventListener('keydown', onSave, true);
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => {
    window.removeEventListener('keydown', onUndoKeys);
    window.removeEventListener('keydown', onSave, true);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
