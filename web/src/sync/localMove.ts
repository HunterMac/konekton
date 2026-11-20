import { webCopyName } from '../../shared/boardNames';
import { fileCopyName } from './copyNames';
import type { LocalStore } from './localStore';

/**
 * Sign-in: move the signed-out entries into the account's space as unsynced. A path the account already has:
 * the signed-out version goes to a copy name (unless the text is equal). Returns notes for the person.
 */
export async function moveEntries(from: LocalStore, to: LocalStore): Promise<string[]> {
  const notes: string[] = [];
  for (const e of await from.list()) {
    let path = e.path;
    const taken = await to.get(path);
    if (taken && taken.text === e.text) {
      await from.remove(e.path);
      continue;
    }
    if (taken) {
      for (let n = 1; n < 1000; n++) {
        path = e.kind === 'board' ? webCopyName(e.path, n) : fileCopyName(e.path, n);
        if (!(await to.get(path))) break;
      }
      notes.push(`Saved your signed-out version of ${e.path} as ${path}.`);
    }
    await to.put(path, e.kind, e.text, { synced: false, changedAt: e.changedAt });
    await from.remove(e.path);
  }
  return notes;
}
