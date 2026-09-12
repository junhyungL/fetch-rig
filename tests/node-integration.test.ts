import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fr } from '../src/index';

/**
 * 지금까지의 테스트는 전부 MSW로 fetch()를 가로챈 목 서버 대상이었다 — 이건 실제 TCP 소켓을
 * 여는 진짜 `node:http` 서버를 세워서, MSW 인터셉션 레이어를 완전히 건너뛰고 fetch-rig이
 * Node의 네이티브 fetch(undici) 위에서 실제로 동작하는지 검증한다. 개발 중 MSW의 mock
 * stream이 `reader.cancel()`을 전파하지 않는다는 걸 발견했는데, 여기서는 그 반대 — 진짜 취소가
 * 진짜 커넥션을 실제로 끊는지까지 증명한다(MSW로는 증명할 수 없었던 부분).
 */
let server: Server;
let baseUrl: string;
let abortedEarly = false;

function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pong: true }));
    return;
  }

  if (req.url === '/sse') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let i = 0;
    const timer = setInterval(() => {
      i++;
      res.write(`data: event-${i}\n\n`);
    }, 5);
    req.on('close', () => clearInterval(timer));
    return;
  }

  if (req.url === '/slow') {
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      res.writeHead(200);
      res.end('done');
    }, 3000);
    req.on('aborted', () => {
      if (!finished) {
        abortedEarly = true;
        clearTimeout(timer);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
}

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('real Node HTTP integration (no mocking library involved)', () => {
  it('performs a real request/response round trip over an actual socket', async () => {
    const res = await fr.get(`${baseUrl}/ping`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pong: true });
  });

  it('streams real SSE events over an actual TCP connection', async () => {
    const res = await fr.get(`${baseUrl}/sse`);
    const events: string[] = [];
    for await (const event of res.streamAsSse()) {
      events.push(event.data);
      if (events.length === 3) break;
    }
    expect(events).toEqual(['event-1', 'event-2', 'event-3']);
  });

  it('aborting a real in-flight request actually closes the underlying TCP connection', async () => {
    abortedEarly = false;
    const controller = new AbortController();
    const pending = fr.get(`${baseUrl}/slow`, { signal: controller.signal });

    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort('stop');

    await expect(pending).rejects.toMatchObject({ reason: 'stop' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(abortedEarly).toBe(true);
  });

  it('works against a real server without depending on any browser-only global', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    const res = await fr.get(`${baseUrl}/ping`);
    expect(res.ok).toBe(true);
  });
});
