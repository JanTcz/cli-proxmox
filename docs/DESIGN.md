# cli-proxmox — design (draft for the owner, 2026-10-16)

A command line for Proxmox VE and, from the same catalog, its MCP twin: every CLI command is one MCP tool, and every tool call
runs through the CLI itself — the pattern of codiak's CLI (`codiak mcp`, KAN-910). Built on Proxmox's own API and its published
schema only; no third-party client, no third-party MCP library.

## Why

The codiak lab runs on Proxmox (host .35; VMs 101–104 codiak, 111–115 webai). Today it is driven by hand over SSH (`qm …`), which
cost us on 2026-10-15: a full clone of a running VM filled the LVM-thin pool and paused VM 101 (io-error), and a clone booted as
its original (same IP, onboot). Operators — people and agents — need a safe, scoped, auditable way to see and act on the lab.

## What exists (surveyed 2026-10-16) and what we take

No official Proxmox MCP and no official JS/TS SDK exist. Proxmox publishes the REST API and its machine-readable schema
(`apidoc.js`, the API viewer's source); its own Rust types (`pve-api-types`) are generated from that schema. We do the same.

From the community servers (canvrno/ProxmoxMCP, RekklesNA/ProxmoxMCP-Plus, bsahane/mcp-proxmox, NANDI-Services/proxmox-mcp,
Bldg-7/proxmox-mcp) we take the ideas, not the code:

| Idea | From | Here |
|---|---|---|
| Access tiers, read-only by default | NANDI, Bldg-7 | `read` / `write` / `destructive`, a profile opts into more |
| `confirm` on destructive calls, `dry_run` on writes | bsahane, NANDI | `--yes` / `confirm: true`; `--dry-run` / `dry_run: true` says the request it would send |
| Wait on the task (UPID) of every write | bsahane, Plus | every write waits by default (`--no-wait` to return the UPID), says exitstatus and the log tail on failure |
| Audit log of writes | Plus | append-only JSONL: who, profile, operation, args, UPID, outcome |
| Least-privilege token, scoped by pool | all docs | the real boundary: a PVE token with a custom role on `/pool/<pool>` |
| Config-parameter whitelist | bsahane | `vm set` takes only named options (netN link_down, ipconfigN, onboot, name, description) |
| Compact text for an LLM, JSON on request | Plus | tables like codiak's CLI; `--json` / `json: true` |

From the community Node.js client `proxmox-api` (UrielCh, npm, GPL-3.0 — ideas only, no code: this repository is MIT) we take
the client's shape: the whole API typed from Proxmox's schema, a path's segments as properties and each `{param}` as `.$(value)`,
the HTTP method last (`proxmox.nodes.$(node).qemu.$(vmid).status.start.$post()`), with the schema's own documentation in the
typings. Our generator writes that tree for the endpoints the catalog uses (all of them, if it costs nothing more), and it
normalizes the schema's known quirks it reported (numeric minimums written as strings) with a test for each.

Missing everywhere, ours: a **VMID/pool allowlist** in the profile (a second fence beside the token), a **safe clone** recipe
(stopped source or linked clone, new IP, link down, onboot 0 before the first boot), **thin-pool usage** with a threshold, and
tests at 100 % coverage with a contract against a real PVE.

Never: guest-agent or SSH exec, console, user/ACL/permission tools, a free `execute` or raw API call, password auth, TLS off,
an unauthenticated HTTP transport (stdio only), secrets in the repository.

## Shape

- Node ≥ 26, TypeScript run by Node's type stripping, **no runtime dependencies**. Dev: `typescript`, `oxlint`, `@types/node`.
- `npm run check` = `oxlint --deny-warnings` + strict `tsc` + `node --test` with **100 %** line, branch and function coverage of
  `src` (the composition root `src/main.ts` aside, proven by the contract). A pre-commit hook runs it; GitHub Actions runs it on push.
- Every slice: agreed here first, then a RED contract (use cases UC-1..n, `UC-n:` test titles) committed before the code.

```
src/catalog.ts      the operations: name, words, args/flags, tier, summary, the API call (method, path, params) — one source
src/api/schema/     Proxmox's apidoc.js, vendored and pinned to a PVE version (8.x), with its checksum
src/api/types.gen.ts  generated from the schema by scripts/gen-types.ts (ours, tested): the endpoints the catalog uses
src/client.ts       fetch to https://<host>:8006/api2/json with `Authorization: PVEAPIToken=<id>=<secret>`, the profile's CA
                    pinned, timeouts; task waiting (GET /nodes/{n}/tasks/{upid}/status until stopped, exitstatus OK)
src/policy.ts       tier vs the profile, the VMID/pool allowlist, confirm and dry-run — refusals by name, before any request
src/audit.ts        the JSONL audit of writes
src/cli.ts          argv → operation → text or JSON; exit codes
src/mcp.ts          newline-delimited JSON-RPC 2.0 over stdio, by hand (as codiak's): tools from the catalog, annotations
                    readOnlyHint/destructiveHint from the tier, each call run through cli.ts
src/main.ts         composition root: `proxmox <words…>`, `proxmox mcp`
```

Profiles: `~/.config/cli-proxmox/<name>/` — `url`, `ca.pem`, `token-id`, `token` (0600), `profile.json` (`tier`, `pool`,
`vmids`, `audit`); `--profile <name>` / `PROXMOX_PROFILE`, a default one. The secret is read from its file only, never from argv.

## Operations, first cut

| Command | Tier | API |
|---|---|---|
| `vm ls` | read | `GET /cluster/resources?type=vm` (filtered to the allowlist) |
| `vm show <id>` | read | `GET /nodes/{n}/qemu/{id}/status/current`, `/config` |
| `vm start|shutdown|stop|resume <id>` | write (stop: destructive) | `POST …/status/{op}` (shutdown: `timeout`, `forceStop`) |
| `vm set <id> --net0-link-down … --ipconfig0 … --onboot …` | write | `PUT …/config`, whitelisted options only |
| `vm clone <id> --new <id> --name … --ipconfig0 … [--full]` | write | safe clone: refuses a full clone of a running source; sets link down, new ipconfig, onboot 0 before any start |
| `snapshot ls|create <id> <name>` | read / write | `GET|POST …/snapshot` |
| `snapshot rollback|rm <id> <name>` | destructive | `POST …/snapshot/{name}/rollback`, `DELETE …/snapshot/{name}` |
| `storage ls` | read | `GET /nodes/{n}/storage` |
| `thin ls [--warn 80]` | read | `GET /nodes/{n}/disks/lvmthin`: data % and metadata %, flagged over the threshold |
| `task show|log|wait <upid>` | read | `GET /nodes/{n}/tasks/{upid}/status|log` |
| `next-id` | read | `GET /cluster/nextid` |

The token: privilege separation on, an expiry, a custom role `CliProxmox` = VM.Audit, VM.PowerMgmt, VM.Snapshot,
VM.Snapshot.Rollback, VM.Clone, VM.Config.Network, VM.Config.Cloudinit, VM.Config.Options, Datastore.Audit,
Datastore.AllocateSpace, SDN.Use on `/pool/codiak` (+ VM.Allocate on that pool for clones), Sys.Audit on `/nodes/<node>` for
tasks and thin pools. Per-endpoint privileges checked against the API schema (2026-10-16).

## Later

- codiak composites: `node retire <name>` = drain the codiak runner, wait for no runs, then shutdown (KAN-1495, the drain rule).
- The onboarding of KAN-1488 (`node add`) cloning a node VM through this.
- LXC, backups, metrics (RRD) — only when a use asks for them.

## Open for the owner

1. ~~The command name~~ — decided (owner, 2026-10-16): `proxmox`, so that it is clear what it drives.
2. The first slice: read-only (`vm ls/show`, `storage ls`, `thin ls`, `task show`, `next-id`) + the MCP twin + profiles and the
   token setup on .35 — then power and snapshots — then the safe clone.
3. Tickets in KAN (label `cli-proxmox`) or in the repo's GitHub issues.
