// A Proxmox VE 9.2.20 that answers as the lab host does: each answer below is the host's own (`pvesh get … --output-format json`,
// 2026-10-16), trimmed to the fields the commands read. Calls are recorded; a path it does not know is Proxmox's 501, and an answer that is
// an Error is that failure.
import type { Call, Method } from '../src/api/client.ts';

export const NODE = 'pc';
export const RESOURCES = [
  { cpu: 0, id: 'qemu/100', maxcpu: 8, maxmem: 12_884_901_888, mem: 0, name: 'debian', node: NODE, status: 'stopped', template: 0, type: 'qemu', uptime: 0, vmid: 100 },
  { cpu: 0.012, id: 'qemu/101', maxcpu: 4, maxmem: 9_663_676_416, mem: 4_294_967_296, name: 'devserv-master', node: NODE, pool: 'codiak', status: 'running', tags: 'devserv', template: 0, type: 'qemu', uptime: 3600, vmid: 101 },
  { cpu: 0, id: 'qemu/102', maxcpu: 16, maxmem: 13_958_643_712, mem: 0, name: 'devserv-node-1', node: NODE, pool: 'codiak', status: 'stopped', template: 0, type: 'qemu', uptime: 0, vmid: 102 },
  { cpu: 0, id: 'qemu/200', maxcpu: 8, maxmem: 27_917_287_424, mem: 0, name: 'win11', node: NODE, status: 'stopped', template: 0, type: 'qemu', uptime: 0, vmid: 200 },
];
export const CURRENT_101 = { agent: 1, cpu: 0.012, cpus: 4, maxmem: 9_663_676_416, mem: 4_294_967_296, name: 'devserv-master', qmpstatus: 'io-error', status: 'running', tags: 'devserv', uptime: 3600, vmid: 101 };
export const CONFIG_101 = { cores: 4, memory: '9216', name: 'devserv-master', net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr0', ipconfig0: 'ip=192.168.0.41/24,gw=192.168.0.1', onboot: 1 };
export const LVMTHIN = [{ ctime: '1790526527', lv: 'data', lv_size: 379_961_999_360, lv_state: 'a', lv_type: 't', metadata_size: 3_699_376_128, metadata_used: 76_577_085, used: 179_000_097_898, vg: 'pve' }];
export const STORAGE = [
  { active: 1, avail: 79_559_262_208, content: 'iso', enabled: 1, shared: 0, storage: 'local', total: 100_861_726_720, type: 'dir', used: 16_131_727_360, used_fraction: 0.159_939_036_189_445 },
  { active: 1, avail: 200_961_901_462, content: 'rootdir,images', enabled: 1, shared: 0, storage: 'local-lvm', total: 379_961_999_360, type: 'lvmthin', used: 179_000_097_898, used_fraction: 0.471_1 },
];
export const NODES = [{ cpu: 0.0035, id: `node/${NODE}`, maxcpu: 32, maxmem: 33_559_851_008, mem: 11_019_251_712, node: NODE, status: 'online', type: 'node', uptime: 18_157 }];
export const UPID = `UPID:${NODE}:0000D805:001A7C95:6AD26EB6:qmstart:115:root@pam:`;
export const TASK = { exitstatus: 'OK', id: '115', node: NODE, pid: 55_301, starttime: 1_792_175_798, status: 'stopped', type: 'qmstart', upid: UPID, user: 'root@pam' };

export type Seen = { method: Method; path: string; params: Record<string, unknown> };

export function fakePve(overrides: Record<string, unknown> = {}): { call: Call; seen: Seen[] } {
  const seen: Seen[] = [];
  const answers: Record<string, unknown> = {
    'GET /cluster/resources': RESOURCES,
    [`GET /nodes/${NODE}/qemu/101/status/current`]: CURRENT_101,
    [`GET /nodes/${NODE}/qemu/101/config`]: CONFIG_101,
    'GET /nodes': NODES,
    [`GET /nodes/${NODE}/disks/lvmthin`]: LVMTHIN,
    [`GET /nodes/${NODE}/storage`]: STORAGE,
    [`GET /nodes/${NODE}/tasks/${encodeURIComponent(UPID)}/status`]: TASK,
    'GET /cluster/nextid': '105',
    ...overrides,
  };
  const call: Call = (method, path, params) => {
    seen.push({ method, path, params });
    const key = `${method} ${path}`;
    if (!(key in answers)) return Promise.reject(new Error(`PVE 501: Method '${key}' not implemented`));
    const answer = answers[key];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { call, seen };
}
