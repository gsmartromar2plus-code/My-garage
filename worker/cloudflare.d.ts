interface D1Result<T = unknown> { results: T[]; success: boolean; meta: { changes: number; [key: string]: unknown } }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
interface D1Database { prepare(query: string): D1PreparedStatement }
interface R2ObjectBody { body: ReadableStream; httpMetadata?: { contentType?: string }; text(): Promise<string> }
interface R2Bucket { put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: unknown): Promise<unknown>; get(key: string): Promise<R2ObjectBody | null> }
interface Fetcher { fetch(request: Request): Promise<Response> }
