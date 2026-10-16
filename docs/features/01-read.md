# Slice 1 — read the lab: the typed client, profiles, the read commands and their MCP twin

Owner, 2026-10-16: a command line for Proxmox and, from the same catalog, an MCP server; Proxmox's own schema, no third-party
code; 100 % coverage as in our other repositories. This slice reads only: nothing in it can change a guest.

## Use cases

- **UC-1 The client is generated from Proxmox's schema.** `generate(schema, version)` (`src/api/generate.ts`) writes one TypeScript
  interface `Pve`: a path's segments are properties, a `{param}` segment is `$(value)`, and each method is `$get`, `$post`, `$put` or
  `$delete`, its parameters (the path's own left out) and its answer typed from the schema, its description as a comment. A
  schema's quirks are taken as Proxmox writes them: `optional` as `1` or `"1"`, a number bound written as a string. The committed
  `src/api/pve.gen.ts` is exactly the generator's output for the vendored `schema/pve-9.2.20.json`, whose sha256 is recorded.
  Test: `test/generate.test.ts`.
- **UC-2 The typed client calls the path it names.** `api(call)` gives a `Pve` whose `nodes.$('pve').qemu.$(101).status.current.$get()`
  calls `GET /nodes/pve/qemu/101/status/current`; a segment is URL-encoded; the parameters are passed whole; nothing else is
  callable as a method, and the client is not a thenable. Test: `test/client.test.ts`.
- **UC-3 The transport speaks Proxmox's HTTPS API with a token.** It sends `Authorization: PVEAPIToken=<id>=<secret>`, the
  parameters of GET and DELETE in the query and of POST and PUT as a form, booleans as 1 and 0, trusts only the profile's CA, and
  answers the response's `data`. An error status is said with Proxmox's message and its per-parameter `errors`; a host that does
  not answer at all is said apart from one that answers slowly (URL, the connect error, the timeout). Test: `test/transport.test.ts`.
- **UC-4 Profiles.** A profile is a directory `<config>/<name>/` (config: `PROXMOX_CONFIG`, else `~/.config/cli-proxmox`): `url`,
  `ca.pem`, `token-id`, `token` and an optional `profile.json` (`tier`, `vmids`, `pool`). The name: `--profile`, else
  `PROXMOX_PROFILE`, else the file `<config>/default`, else `default`. A token file readable by group or others is refused, as is
  a profile with a file missing — by name. The tier is `read` unless the profile says more. Test: `test/profile.test.ts`.
- **UC-5 Scope.** A profile's `vmids` and `pool` fence the guests it sees and touches, beside the token's own ACL: `vm ls` lists
  only the guests in scope; `vm show` of one outside is refused by name before it is read. A profile with neither sees what the
  token sees. An operation whose tier is above the profile's is refused by name before any request. Test: `test/catalog.test.ts`.
- **UC-6 The read commands.** `vm ls`, `vm show <vmid>`, `storage ls`, `thin ls [--warn <percent>]` (data and metadata use of each
  LVM-thin pool, a pool over the threshold flagged — 80 by default), `task show <upid>` and `next-id`: a table or lines for a person
  or a model, the whole answer as JSON with `--json`. `vm show` names the QEMU state (`qmpstatus`), so a guest paused on an I/O error
  is not reported as running. Usage on an unknown command or a missing argument, exit 2; a failure, one line and exit 1.
  Test: `test/catalog.test.ts`, `test/cli.test.ts`.
- **UC-7 The MCP twin.** `proxmox mcp` serves the catalog over stdio (newline-delimited JSON-RPC 2.0): `initialize`, `tools/list`
  (one tool a command, `vm_ls` for `vm ls`; its arguments and flags as properties, `json` and `profile` beside them; `readOnlyHint`
  and `destructiveHint` from the tier) and `tools/call`, which runs the CLI with those words and answers its output (an error when
  it exits non-zero). Notifications are not answered; an unknown method is `-32601`. Test: `test/mcp.test.ts`.

## Counterparty

Proxmox VE 9.2.20 on the lab host. The fakes in the tests answer as its API does (shapes taken from the schema and from the host);
`npm run contract` (not part of the check, it needs the host) runs the read commands against the real one with a profile and
checks each answer's shape. Proven on the host when the token is set up.
