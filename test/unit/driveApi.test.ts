import { describe, expect, it } from 'vitest';
import { HttpDriveApi } from '../../web/src/sync/driveApi';

/** A Drive file whose own `version` Drive bumps by itself after an upload; its head revision stays. */
function fakeDrive() {
  const file = { id: 'f1', name: 'main.canvas', mimeType: 'text/plain', parents: ['root1'], version: '7', headRevisionId: 'R1', modifiedTime: 't', createdTime: 't', trashed: false };
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (init?.method === 'PATCH') {
      file.version = String(Number(file.version) + 1);
      file.headRevisionId = 'R2';
      return json({ id: file.id, version: file.version, headRevisionId: file.headRevisionId, modifiedTime: 't2' });
    }
    if (url.includes('/files?')) return json({ files: [file] });
    return json(file);
  }) as typeof fetch;
  const drive = new HttpDriveApi({ token: () => 'T', rejected: () => undefined }, fetchFn);
  return { file, urls, drive };
}

describe('HttpDriveApi versions', () => {
  it('gives the head revision as the version everywhere, not Drive\'s own counter', async () => {
    const t = fakeDrive();
    expect((await t.drive.listAll())[0].version).toBe('R1');
    expect(await t.drive.version('f1')).toBe('R1');
    expect((await t.drive.update('f1', '{}', 'application/json')).version).toBe('R2');
    expect(t.urls.every((u) => !u.includes('fields=') || decodeURIComponent(u).includes('headRevisionId'))).toBe(true);
  });

  it('a change Drive makes by itself (version only) does not change the version the app sees', async () => {
    const t = fakeDrive();
    const written = await t.drive.update('f1', '{}', 'application/json');
    t.file.version = String(Number(t.file.version) + 3);
    expect(await t.drive.version('f1')).toBe(written.version);
  });
});
