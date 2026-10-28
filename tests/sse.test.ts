import { expect, test } from 'vitest';
import { readSse } from '../packages/web/src/lib/sse';
function stream(chunks: (string | Uint8Array)[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    controller.close();
  } });
}
test('parses events split across chunks, CRLF, multiline data and UTF-8 boundaries', async () => {
  const bytes = new TextEncoder().encode('event: delta\ndata: {"text":"中文回答"}\n\n');
  const cut = bytes.indexOf(0xe6) + 1;
  const events: { event: string; data: string }[] = [];
  for await (const event of readSse(stream(['event: start\r\ndata: {"ok":1}\r\n\r\n', bytes.slice(0, cut), bytes.slice(cut), 'event: delta\ndata: 第一行\ndata: 第二行\n\n']))) events.push(event);
  expect(events).toEqual([
    { event: 'start', data: '{"ok":1}' },
    { event: 'delta', data: '{"text":"中文回答"}' },
    { event: 'delta', data: '第一行\n第二行' },
  ]);
});
test('ignores comments and blank blocks and releases the stream', async () => {
  const body = stream([': keep-alive\n\n', 'event: done\ndata: {"status":"complete"}\n\n']);
  const events = []; for await (const event of readSse(body)) events.push(event);
  expect(events).toEqual([{ event: 'done', data: '{"status":"complete"}' }]);
  expect(body.locked).toBe(false);
});
