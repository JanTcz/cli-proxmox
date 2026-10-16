// Proxmox's HTTPS API with an API token (UC-3): `Authorization: PVEAPIToken=<id>=<secret>`, GET and DELETE parameters in the query,
// POST and PUT as a form, booleans as 1 and 0; only the profile's CA is trusted. The answer is the response's `data`; an error status
// is said with Proxmox's message and its per-parameter `errors`; a host that does not answer is said apart from a slow one.
import { request } from 'node:https';
import type { Call } from './api/client.ts';

export type Endpoint = { url: string; ca: string; tokenId: string; secret: string; timeoutMs: number };

// Raised by the request's own timeout, so that it is told apart from a connection that failed.
class NoAnswer extends Error {}

export function form(params: Record<string, unknown>): string {
  const pairs = Object.entries(params).filter(([, value]) => value !== undefined)
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((one): [string, string] => [key, typeof one === 'boolean' ? (one ? '1' : '0') : String(one)]));
  return new URLSearchParams(pairs).toString();
}

function answerOf(status: number, message: string, text: string): unknown {
  let json: { data?: unknown; errors?: Record<string, string> };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    if (status >= 400) throw new Error(`PVE ${status} ${message}`);
    throw new Error(`PVE ${status}: the answer is not JSON: ${text.slice(0, 200)}`);
  }
  if (status >= 400) {
    const errors = Object.entries(json.errors ?? {}).map(([key, said]) => `${key}: ${said.trim()}`).join('; ');
    throw new Error(`PVE ${status} ${message}${errors ? `: ${errors}` : ''}`);
  }
  return json.data;
}

export function transport({ url, ca, tokenId, secret, timeoutMs }: Endpoint): Call {
  return (method, path, params) => new Promise((resolve, reject) => {
    const encoded = form(params);
    const inQuery = method === 'GET' || method === 'DELETE';
    const body = inQuery ? undefined : encoded;
    const target = new URL(`/api2/json${path}${inQuery && encoded ? `?${encoded}` : ''}`, url);
    const headers = { authorization: `PVEAPIToken=${tokenId}=${secret}`,
      ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }) };
    const req = request(target, { method, ca, headers, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; }).on('end', () => {
        try {
          resolve(answerOf(res.statusCode!, res.statusMessage!, text));
        } catch (error) {
          reject(error as Error);
        }
      });
    });
    req.on('timeout', () => { req.destroy(new NoAnswer(`${url} gave no answer in ${timeoutMs} ms`)); });
    req.on('error', (error: NodeJS.ErrnoException) => { reject(error instanceof NoAnswer ? error : new Error(`cannot reach ${url}: ${error.code}`)); });
    req.end(body);
  });
}
