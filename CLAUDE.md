# cli-proxmox — how to work here

Read `docs/DESIGN.md` first. `proxmox` is a command line for Proxmox VE and, from the same catalog (`src/catalog.ts`), its MCP twin
(`proxmox mcp`): every command is one tool, and every tool call runs through the CLI.

- **Proxmox's own API only.** The client is generated from Proxmox's schema (`schema/pve-<version>.json`, `npm run generate`);
  no third-party Proxmox client or MCP library, no runtime dependency at all.
- **Never:** guest-agent or SSH exec, console, user/ACL tools, a raw API call, password auth, TLS off, an HTTP transport, a
  secret in the repository or on a command line.
- **The contract comes first:** each slice is agreed with the owner (`docs/DESIGN.md`), then `docs/features/<nn>-<slice>.md` with
  its use cases UC-1..n and a RED test (`UC-n:` titles) committed before the code (`--no-verify`, red only in that slice's tests).
- **`npm run check` is green before every commit** (the pre-commit hook in `hooks/`, `npm run hooks` installs it): pedantic
  `oxlint`, strict `tsc`, and `node --test` with **100 %** line, branch and function coverage of `src` (`src/main.ts`, the
  composition root, and the generated `src/api/pve.gen.ts` aside). A line the tests cannot reach is removed, not excused.
- One test file: `node --test test/<file>.test.ts`. The fakes answer as the real Proxmox does (`test/fake-pve.ts`: the lab host's
  own answers); `npm run contract` proves them against the host.
- Silence is never a success: empty, skipped and unmeasured say so.
