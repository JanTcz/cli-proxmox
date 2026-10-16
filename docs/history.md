# What we did on the lab's Proxmox by hand — the source of the next slices' use cases and regression tests

Surveyed 2026-10-16 from the Claude Code transcripts (456 Proxmox commands in 8 sessions, 2026-09-27 … 2026-10-16) and the
deploy scripts (`devserv/deploy/pve/provision.sh`, `destroy.sh`). Host 192.168.0.35, node `pc`, PVE 9.2.20.

## Operations, by how often (approx.) — and the slice that covers them

| Hand command | Times | Slice |
|---|---|---|
| `qm list`, `qm status <id> --verbose`, `qm config <id>`, `pvesh get /cluster/resources --type vm` | ~170 | 1 (`vm ls`, `vm show`) |
| `lvs … data_percent`, `vgs`, `pvesm status` | ~30 | 1 (`thin ls`, `storage ls`) |
| `qm start`, `qm shutdown <id> --timeout N` (often several at once), `qm stop`, `qm reboot`, `qm resume` | ~150 | 2 power |
| `qm set <id> --memory --balloon --cores --onboot`; `--net0 …,link_down=1 --ipconfig0 … --onboot 0` | ~40 | 2/3 `vm set` (whitelist) |
| `qm clone <src> <new> --name <n> --full 1` | 7 | 3 safe clone |
| `qm snapshot`/`listsnapshot`, `pvesh create /cluster/backup …`, `qmrestore`, `qm destroy --purge` | ~6 | 4 snapshot/backup (destroy: destructive, later) |
| `qm guest exec <id> …` (fstrim, docker compose, config edits) | ~100 | never (no exec into guests by design); `fstrim` → see below |
| GPU passthrough, `lvcreate`/`lvremove`, `mkfs`, host reboot, WoL | — | out of scope |

## Incidents → regression tests

1. **A full clone of a running VM filled the thin pool** (2026-10-15 16:40–16:59): `qm clone 101 111 --full 1` with 101 running; pool
   data 69.63 % → the next clone failed `mirror-scsi0: No space left on device`, kernel `switching pool to out-of-data-space`.
   → slice 3: `vm clone` refuses a full clone of a running source; checks the pool's free space against the source disk before it
   starts (`thin ls` data); after a clone, suggests `fstrim` in the guest (it brought the pool from ~100 % back to 42.32 %).
2. **`qm list` said running while QEMU was paused on an I/O error** (`qmpstatus: io-error status: running`). → slice 1 holds it
   (`vm show` names the QEMU state, test `vm show … io-error`); slice 2: `vm ls` flags a guest whose qmpstatus differs from its
   status (needs the status per guest — measure the cost).
3. **`qm shutdown` timed out because the guest agent did not answer** (`guest-ping failed - got timeout … exited with code 255`).
   → slice 2: `vm shutdown` waits for its task and says the task's exit status and log tail; offers `--force-stop` after the timeout
   (API `forceStop`), never silently.
4. **A clone boots as its original** (same MAC/ipconfig0, onboot 1 — 2026-10-06 and 10-15). → slice 3: the safe clone sets
   `link_down=1`, a new `ipconfig0` and `onboot 0` before any start, and refuses to start a clone whose ipconfig0 equals its source's.
5. **Hibernate lost a node's runs** (`qm suspend 104 --todisk 1`, 3 min away, the master marks runs lost after 15 s) and a GUI hibernate
   of a VFIO guest left `lock: suspending`. → `suspend` is not offered; a lock is shown by `vm show` (`lock` in status).
6. **Parallel shutdowns** (`for v in …; do qm shutdown $v & done; wait`). → slice 2: `vm shutdown <id>…` takes several ids and waits
   on their tasks together.

## Seen elsewhere

- A plaintext root password appears in a transcript command (2026-09-27, `curl … password=`): one more reason for tokens only.
- The backup job `codiak-master` was created with `keep-daily=3,keep-weekly=2`; the memory note says 7d/4w/3m — to check with a
  later `backup ls` (slice 4).
