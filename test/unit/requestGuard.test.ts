import { describe, expect, it } from 'vitest';
import { checkRequest, type RequestInfo } from '../../web/server/requestGuard';

const URL_ = '/__konekton/board?name=sample.canvas';
const base = (patch: Partial<RequestInfo> & { headers?: RequestInfo['headers'] } = {}): RequestInfo => ({
  method: 'GET',
  url: URL_,
  ...patch,
  headers: { host: 'localhost:5173', ...patch.headers },
});
const put = (headers: RequestInfo['headers'] = {}) => base({ method: 'PUT', headers: { 'content-type': 'application/json', ...headers } });

describe('checkRequest', () => {
  it('1. ignores other paths', () => {
    expect(checkRequest({ method: 'DELETE', url: '/src/main.tsx', headers: { host: 'evil.example' } })).toBeNull();
    expect(checkRequest(base())).toBeNull();
  });

  it('2. needs a localhost Host', () => {
    for (const host of ['localhost', 'localhost:5173', '127.0.0.1:5174', '[::1]:5173']) expect(checkRequest(base({ headers: { host } }))).toBeNull();
    for (const host of ['evil.example', 'evil.example:5173', 'localhost.evil.example', '192.168.1.2:5173', undefined]) {
      expect(checkRequest(base({ headers: { host } }))?.status).toBe(403);
    }
  });

  it('3. allows only same-origin Sec-Fetch-Site, or none', () => {
    expect(checkRequest(base({ headers: { 'sec-fetch-site': 'same-origin' } }))).toBeNull();
    expect(checkRequest(base())).toBeNull();
    for (const site of ['same-site', 'cross-site', 'none']) expect(checkRequest(base({ headers: { 'sec-fetch-site': site } }))?.status).toBe(403);
  });

  it('4. allows only this server as Origin', () => {
    expect(checkRequest(put({ origin: 'http://localhost:5173' }))).toBeNull();
    expect(checkRequest(put({ origin: 'http://localhost:3000' }))?.status).toBe(403);
    expect(checkRequest(put({ origin: 'null' }))?.status).toBe(403);
  });

  it('5. refuses preflights', () => {
    expect(checkRequest(base({ method: 'OPTIONS' }))?.status).toBe(403);
  });

  it('6. allows only GET and PUT', () => {
    expect(checkRequest(base({ method: 'GET' }))).toBeNull();
    expect(checkRequest(base({ method: 'DELETE' }))?.status).toBe(405);
    expect(checkRequest(base({ method: 'POST' }))?.status).toBe(405);
  });

  it('7. needs JSON for PUT', () => {
    expect(checkRequest(put({ 'content-type': 'application/json; charset=utf-8' }))).toBeNull();
    expect(checkRequest(put({ 'content-type': 'text/plain' }))?.status).toBe(415);
    expect(checkRequest(base({ method: 'PUT' }))?.status).toBe(415);
  });

  it('8. refuses a declared body over 5 MB', () => {
    expect(checkRequest(put({ 'content-length': '100' }))).toBeNull();
    expect(checkRequest(put({ 'content-length': String(5 * 1024 * 1024 + 1) }))?.status).toBe(413);
  });
});
