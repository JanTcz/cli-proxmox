# cli-proxmox

`proxmox` — a command line for Proxmox VE, and the same commands as an MCP server for agents.

```
proxmox vm ls                     # the guests the profile may see
proxmox vm show 101               # status (with QEMU's own state) and config
proxmox thin ls --warn 80         # LVM-thin data and metadata use, flagged over 80 %
proxmox mcp                       # the same commands as MCP tools, over stdio
```

- Built on Proxmox's own API schema (generated, typed); no third-party client, no runtime dependencies.
- Scoped: an API token with a custom role on a pool, plus the profile's own fence (`vmids`, `pool`) and tier
  (`read` by default, `write`, `destructive`).
- Profiles in `~/.config/cli-proxmox/<name>/`: `url`, `ca.pem`, `token-id`, `token` (mode 600), optional `profile.json`.

## As an MCP server

The repository is an MCP server: `.mcp.json` names `proxmox mcp`, so a client that reads it (Claude Code, opened in this
directory) has the tools at once — one a command (`vm_ls`, `vm_show`, `thin_ls`, …), read-only and destructive hints from each
command's tier, every call run through the CLI with the default profile (or `profile` in the call). Elsewhere:
`claude mcp add proxmox -- node <path>/bin/proxmox.ts mcp`.

Design: [docs/DESIGN.md](docs/DESIGN.md). Requires Node ≥ 26. MIT.
