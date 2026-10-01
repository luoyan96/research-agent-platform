import { routes, ErrorResponse, contractVersion } from '@research-agent-platform/contracts';
import type { RouteName, RequestFor, ResponseFor } from '@research-agent-platform/contracts';

export class ApiError extends Error {
  constructor(public code: string, message: string, public requestId = '') { super(message); }
}

/** A retained intent is immutable, so an ambiguous failure can only replay its original payload. */
export class Intent<K extends RouteName> {
  readonly key: string;
  readonly body: RequestFor<K>['body'];
  readonly params: RequestFor<K>['params'];
  constructor(readonly route: K, body: RequestFor<K>['body'], params: RequestFor<K>['params'], key = crypto.randomUUID()) {
    this.key = key;
    this.body = structuredClone(body);
    this.params = structuredClone(params);
  }
}

export class ApiClient {
  csrfToken = '';
  constructor(private transport: typeof fetch = (input, init) => fetch(input, init)) {}
  async call<K extends RouteName>(name: K, input: RequestFor<K>, signal?: AbortSignal): Promise<ResponseFor<K>> {
    const endpoint = routes[name];
    const parsed = endpoint.request.safeParse(input);
    if (!parsed.success) throw new ApiError('VALIDATION_ERROR', '请检查必填内容、日期和长度。');
    let path = endpoint.path;
    for (const [key, value] of Object.entries(input.params)) path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query)) if (value !== undefined) query.set(key, String(value));
    let response: Response;
    try {
      response = await this.transport(path + (query.size ? '?' + query : ''), {
        method: endpoint.method, credentials: 'same-origin', cache: 'no-store', signal,
        headers: { ...(endpoint.method !== 'GET' ? {'Content-Type': 'application/json', 'X-CSRF-Token': this.csrfToken} : {}), ...input.headers },
        ...(endpoint.method !== 'GET' ? { body: JSON.stringify(input.body) } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError('NETWORK_ERROR', '服务连接失败，请求结果可能尚未返回。内容已保留，请重试同一请求。');
    }
    if(name === 'content' && response.ok) {
      if(response.headers.get('X-Contract-Version') !== contractVersion) throw new ApiError('CONTRACT_MISMATCH','服务与页面契约版本不一致。');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if(signal?.aborted) throw new DOMException('Read cancelled','AbortError');
      return bytes as ResponseFor<K>;
    }
    let json: unknown;
    try { json = await response.json(); } catch {
      if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError');
      if (!response.ok) throw new ApiError('SERVICE_UNAVAILABLE', `服务暂不可用（${response.status}）。`);
      throw new ApiError('INVALID_RESPONSE', '服务响应无法读取，请刷新或重试原请求。');
    }
    // A read can finish parsing after navigation or an offline event cancelled it.
    // Never let that late response repopulate a cleared view.
    if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError');
    if (!response.ok) {
      const error = ErrorResponse.safeParse(json);
      if (error.success) throw new ApiError(error.data.error.code, error.data.error.message, error.data.error.requestId);
      throw new ApiError('SERVICE_UNAVAILABLE', `服务暂不可用（${response.status}）。`);
    }
    if (response.headers.get('X-Contract-Version') !== contractVersion) throw new ApiError('CONTRACT_MISMATCH', '服务与页面契约版本不一致，请联系维护者。');
    const result = endpoint.response.safeParse(json);
    if (!result.success) throw new ApiError('INVALID_RESPONSE', '服务响应不符合共享契约，未更新页面状态。');
    return result.data as ResponseFor<K>;
  }
  read<K extends RouteName>(name: K, params = {}, query = {}, signal?: AbortSignal) {
    return this.call(name, {params, query, headers: {}, body: null} as RequestFor<K>, signal);
  }
  send<K extends RouteName>(intent: Intent<K>) {
    return this.call(intent.route, {params: intent.params, query: {}, headers: routes[intent.route].idempotent ? {'Idempotency-Key': intent.key} : {}, body: intent.body} as RequestFor<K>);
  }
}

/** Double clicks share an in-flight promise; failures retain the exact intent for explicit retry. */
export class CommandSlot {
  intent?: Intent<RouteName>;
  private active?: Promise<unknown>;
  async run<K extends RouteName>(client: ApiClient, intent: Intent<K>): Promise<ResponseFor<K>> {
    if (this.active) return this.active as Promise<ResponseFor<K>>;
    if (this.intent && this.intent !== intent) throw new ApiError('PENDING_INTENT', '请先重试原请求，或明确放弃后重新确认。');
    this.intent = intent;
    this.active = client.send(intent);
    try { const result = await this.active; this.intent = undefined; return result as ResponseFor<K>; }
    finally { this.active = undefined; }
  }
  discard() { if (!this.active) this.intent = undefined; }
}
