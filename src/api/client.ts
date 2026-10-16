// The typed client (UC-2): a `Pve` whose property chain is the path it calls — `$(value)` a URL-encoded segment, the last `$get`,
// `$post`, `$put` or `$delete` the call, with its parameters as given. It is not a thenable: awaiting a path calls nothing.
import type { Pve } from './pve.gen.ts';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
// One call of Proxmox's API: the method, the path under /api2/json, the parameters; the answer's `data`.
export type Call = (method: Method, path: string, params: Record<string, unknown>) => Promise<unknown>;
export type { Pve };

const METHODS: Readonly<Record<string, Method>> = { $get: 'GET', $post: 'POST', $put: 'PUT', $delete: 'DELETE' };

function at(call: Call, path: string): object {
  return new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string' || key === 'then') return;
      if (key === '$') return (value: string | number) => at(call, `${path}/${encodeURIComponent(String(value))}`);
      const method = METHODS[key];
      if (method) return (params: Record<string, unknown> = {}) => call(method, path, params);
      return at(call, `${path}/${key}`);
    },
  });
}

export const api = (call: Call): Pve => at(call, '') as Pve;
