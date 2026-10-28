import { HTTPException } from 'hono/http-exception';
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function invariant(value: unknown, message: string, status = 400): asserts value {
  if (!value) throw new AppError(status, 'INVALID_INPUT', message);
}
export function notFound<T>(value: T | undefined | null): T {
  if (value == null) throw new AppError(404, 'NOT_FOUND', '未找到这条资料');
  return value;
}
export { HTTPException };
