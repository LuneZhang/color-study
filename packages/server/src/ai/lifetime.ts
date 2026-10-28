import { AiError } from './errors';

export const AI_TIMEOUTS = { idle: 30_000, total: 180_000 };
export class RequestLifetime {
  readonly controller = new AbortController();
  private idle?: ReturnType<typeof setTimeout>;
  private total: ReturnType<typeof setTimeout>;
  constructor() {
    this.total = setTimeout(() => this.timeout(), AI_TIMEOUTS.total);
    this.total.unref?.();
  }
  get signal() { return this.controller.signal; }
  private timeout() { this.controller.abort(new AiError(504, 'AI_TIMEOUT', 'AI 请求超时（首字节/空闲 30 秒，总时长 180 秒），请检查网络后手动重试。')); }
  touch() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.timeout(), AI_TIMEOUTS.idle);
    this.idle.unref?.();
  }
  cancel() { this.controller.abort(new AiError(499, 'AI_CANCELLED', '请求已取消，已接收的回答保留为中断状态。')); }
  async wait<T>(promise: Promise<T>): Promise<T> {
    // Attach handlers even when already aborted, so a late injected transport rejection is consumed.
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => this.signal.removeEventListener('abort', abort));
      if (this.signal.aborted) { this.signal.removeEventListener('abort', abort); abort(); }
    });
  }
  dispose() { clearTimeout(this.total); clearTimeout(this.idle); }
}
