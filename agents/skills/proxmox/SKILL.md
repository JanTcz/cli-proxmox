---
name: proxmox
description: Look at a Proxmox VE host through the proxmox MCP tools (or the `proxmox` CLI) instead of SSH and `qm`. Use when asked about VMs, their state, storage or thin-pool space, or Proxmox tasks — and before any action on a VM, to see what is there.
---

# proxmox

The tools are the `proxmox` CLI's commands, one each: `vm_ls`, `vm_show`, `storage_ls`, `thin_ls`, `task_show`, `next_id`.
Every call takes `json: true` for the whole answer and `profile` to choose a profile other than the default.

- **Prefer these tools to SSH.** They go through an API token scoped to a pool, so they cannot touch a guest outside it, and
  a profile is read-only unless it says more. Never fall back to `ssh root@… qm …` for something a tool does.
- **Trust QEMU's state over the status.** `vm_show` names `qmpstatus`: a guest paused on an I/O error reads `running, QEMU
  io-error` — that is not running. Check `thin_ls` then: a full LVM-thin pool pauses every guest on it.
- **Space before a clone or a big write.** `thin_ls` gives data and metadata use per pool, flagged over `warn` (80 by default).
- **A refusal is an answer.** `VM 200 is outside the profile …` and `the profile … allows read` are the fences working; say so,
  do not look for a way around them.

## Inside a guest: not this tool

These tools act on a VM as a whole — never inside it: no guest-agent or SSH exec, by design (`qm guest exec` through the
host's root is root over every guest). For work inside a guest take the narrowest way that does it:
1. the service's own API in the guest (its git over HTTPS, its HTTP API, its CLI with its own token);
2. SSH to the guest as its own user, with a key;
3. only when the guest cannot be reached (its network down, it hangs): root on the Proxmox host and `qm guest exec` — and say why
   1 and 2 cannot.

Setting up a profile (once, by a person): `~/.config/cli-proxmox/<name>/` with `url`, `ca.pem` (the host's
`/etc/pve/pve-root-ca.pem`), `token-id`, `token` (mode 600) and an optional `profile.json` (`{"tier": "read", "pool": "lab"}`).
See https://github.com/JanTcz/cli-proxmox.
