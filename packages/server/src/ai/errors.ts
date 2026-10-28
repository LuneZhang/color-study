import { AppError } from '../errors';

/** Only locally authored messages are safe to expose; never forward provider/keyring errors. */
export class AiError extends AppError {}
export function publicAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof AppError && error.code === 'UNSAFE_URL') return new AiError(400, 'UNSAFE_URL', 'AI 地址不允许访问内网或保留地址，请检查服务配置。');
  return new AiError(502, 'AI_CONNECTION_FAILED', 'AI 请求失败，请检查网络和服务配置；不会自动重试。');
}
export function upstreamError(status: number, images: boolean): AiError {
  if (status === 401 || status === 403) return new AiError(401, 'AI_AUTH_FAILED', 'API Key 无效或无权使用该服务，请在设置中检查凭据。');
  if (status === 429) return new AiError(429, 'AI_RATE_LIMITED', '服务额度不足或请求过于频繁，请检查额度后手动重试。');
  if (status >= 300 && status < 400) return new AiError(502, 'AI_REDIRECT_BLOCKED', 'AI 服务返回重定向，已阻止转发凭据；请填写最终 API 前缀。');
  if (status === 413) return new AiError(413, 'AI_CONTEXT_TOO_LONG', '服务商拒绝了上下文大小，请移除资料或另开会话。');
  if (status === 404) return new AiError(400, 'AI_MODEL_UNSUPPORTED', '模型或接口不存在，请检查模型 ID 和 API 前缀。');
  if ((status === 400 || status === 422) && images) return new AiError(400, 'AI_IMAGE_UNSUPPORTED', '服务拒绝了图片请求，请检查模型图片能力或移除附件。');
  return new AiError(502, 'AI_PROTOCOL_UNSUPPORTED', '服务不兼容当前 Chat Completions 请求，请检查模型、输出限额参数及接口配置。');
}
export const protocolError = () => new AiError(502, 'AI_PROTOCOL_UNSUPPORTED', '服务返回了不支持或不完整的 Chat Completions 响应。');
