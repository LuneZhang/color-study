import { protocolError } from './errors';

/** Incremental SSE framing: UTF-8, CR/LF/CRLF, multiple data fields and fragmented lines. */
export class SseDecoder {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private line = '';
  private data: string[] = [];
  private eventSize = 0;
  private afterCR = false;
  push(chunk: Uint8Array): string[] {
    let text: string;
    try { text = this.decoder.decode(chunk, { stream: true }); } catch { throw protocolError(); }
    return this.feed(text);
  }
  end(): string[] {
    let text: string;
    try { text = this.decoder.decode(); } catch { throw protocolError(); }
    const events = this.feed(text);
    if (this.line) this.consumeLine(events);
    if (this.data.length) events.push(this.data.join('\n'));
    this.data = [];
    return events;
  }
  private feed(text: string): string[] {
    const events: string[] = [];
    for (const character of text) {
      if (this.afterCR && character === '\n') { this.afterCR = false; continue; }
      this.afterCR = character === '\r';
      if (character === '\n' || character === '\r') this.consumeLine(events);
      else this.line += character;
      if (this.line.length + this.eventSize > 128 * 1024) throw protocolError();
    }
    return events;
  }
  private consumeLine(events: string[]) {
    if (!this.line) {
      if (this.data.length) events.push(this.data.join('\n'));
      this.data = []; this.eventSize = 0;
    } else if (this.line === 'data' || this.line.startsWith('data:')) {
      const value = this.line.slice(5).replace(/^ /, '');
      this.data.push(value); this.eventSize += value.length;
    }
    this.line = '';
  }
}
export interface CompletionDelta { text: string; status?: 'complete' | 'interrupted' }
export function completionDelta(data: string): CompletionDelta {
  if (data.trim() === '[DONE]') return { text: '', status: 'complete' };
  if (!data.trim()) return { text: '' };
  let event: Record<string, unknown>;
  try { event = JSON.parse(data); } catch { throw protocolError(); }
  if (!event || typeof event !== 'object' || event.error || !Array.isArray(event.choices)) throw protocolError();
  if (!event.choices.length) return { text: '' }; // Usage-only chunks.
  const choice = event.choices.find(choice => choice?.index === 0) ?? event.choices[0];
  if (!choice || typeof choice !== 'object') throw protocolError();
  const delta = choice.delta;
  if (delta !== undefined && (!delta || typeof delta !== 'object' || delta.tool_calls || delta.function_call)) throw protocolError();
  if (delta?.content != null && typeof delta.content !== 'string') throw protocolError();
  const text = delta?.content ?? '';
  if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') return { text, status: 'interrupted' };
  if (choice.finish_reason === 'stop') return { text, status: 'complete' };
  if (choice.finish_reason != null) throw protocolError();
  return { text };
}
