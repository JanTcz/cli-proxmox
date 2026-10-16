# The cli-proxmox plugin

One folder for every coding agent: the `proxmox` MCP server (`.mcp.json`: `npx -y cli-proxmox@0 mcp`) and the `proxmox` skill
(`skills/proxmox/SKILL.md`, Agent Skills standard) that tells the agent how to use it.

| Agent | Manifest | Install |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` | `/plugin marketplace add JanTcz/marketplace`, then `/plugin install cli-proxmox@jantcz` |
| Codex | `.codex-plugin/plugin.json` | `codex plugin marketplace add JanTcz/marketplace`, then enable `cli-proxmox@jantcz` |
| Others | none | `npx -y cli-proxmox@0 mcp` as a stdio MCP server, and `skills/proxmox/` into the agent's skills folder |

The tools need a profile on the machine (`~/.config/cli-proxmox/<name>/`, see the skill). The marketplace that lists it is
[JanTcz/marketplace](https://github.com/JanTcz/marketplace).
