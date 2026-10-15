# Windows and WSL

Jasper supports two Windows configurations.

## Windows without WSL — Client IDE only

Connect to a GemStone server running on a remote host (or in a VM). No WSL installation is required.

1. Create a login with the remote host, stone name, and NetLDI, and pick the stone's version from **GemStone Version**. Every supported version is listed. One marked _(not yet downloaded)_ shows a **Download files** button under the dropdown.
2. Download them there, or log in and accept the offer. This fetches the **Windows client distribution** for that version (about 26–33 MB): the native GCI DLLs, nothing of the server.
3. After the download, Jasper auto-detects the library and connects.

You can also download them ahead of time with **Download Client Libraries…** in the Versions section of the **Databases & Versions** panel, or the **Download Files** action on a version row.

Without WSL, the Databases & Versions panel remains usable (its Versions list hosts these downloads), and the Databases section stays visible but shows a message explaining that server management requires WSL2, since it needs a Linux environment.

On a machine without WSL, Jasper never opens WSL's "Press any key to install" window. Windows keeps a `wsl.exe` launcher in System32 even when WSL is missing, and most commands sent to it open that window, so the only one Jasper runs before it knows WSL is there is `wsl --status`, which doesn't. On Windows 10 builds older than Windows 11, where `--status` may not exist, Jasper looks for the WSL engine's files instead. If you install WSL and a distribution later, press Refresh in the Databases & Versions panel and Jasper picks them up. You don't need to reload.

## Windows with WSL — Full server management

With WSL installed and a Linux distribution configured, Jasper can manage GemStone servers running inside WSL while the VS Code extension runs natively on Windows. The GemStone server distribution is downloaded and extracted inside WSL, while the Windows client distribution provides the native DLL for VS Code to communicate with the server.

### Reaching WSL from Windows

The Windows extension connects to GemStone services (NetLDI) that run inside WSL, so a GemStone login needs a host and a port that Windows can route to. There are three paths, presented in the **Configure OS** view under **WSL networking**:

1. **Mirrored networking (recommended, Windows 11 22H2 + WSL core 2.0+)** — `localhost` on Windows reaches services bound inside WSL with no further setup. Jasper detects the state and, when NAT is active, offers a one-click **Enable mirrored networking** action that writes `networkingMode=mirrored` to `%USERPROFILE%\.wslconfig` and prompts to restart WSL.
2. **Stable name via hosts file (Windows 10 fallback)** — Jasper can write `<wsl-ip> wsl-linux` to `C:\Windows\System32\drivers\etc\hosts`. Logins then use `wsl-linux` instead of a raw IP. Because WSL2 assigns a new IP after `wsl --shutdown` or reboot, the action is idempotent and meant to be re-run after any WSL restart. The script self-elevates via UAC.
3. **Copy the IP** — running NetLDI items expose a **Copy Host** context action. Under mirrored networking this copies `localhost`; otherwise it copies the current WSL IP (shown in the item's tooltip). Paste into the login's Host field.

### NetLDI port naming (`gs64ldi`)

Jasper also detects whether `gs64ldi 50377/tcp` is present in `/etc/services` on both sides. With the entry in place, `startnetldi` binds to the conventional port 50377 (instead of picking a random one) and logins can name the port as `gs64ldi`. The **Services** row under Configure OS offers separate write actions for the Windows and WSL sides — the Windows write needs admin (UAC), the WSL write needs `sudo`.
