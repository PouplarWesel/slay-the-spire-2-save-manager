# Spirekeeper

A Windows desktop app for keeping separate Slay the Spire 2 multiplayer campaigns for different parties.

## Run

Double-click `Launch Spirekeeper.cmd` or the portable executable in `dist/Spirekeeper-1.0.0.exe`. The executable needs no Node installation.

For development, install Node 22 or newer, then run `npm install` and `npm start`. Run `npm test` for file-operation tests and `npm run build` to produce the Windows portable app.

## Using the app

1. Close Slay the Spire 2. The app detects vanilla and modded profiles under `%APPDATA%\SlayTheSpire2\steam`, choosing the only profile with an active multiplayer save when possible. Select the host’s **Game save folder** at the top to change profiles.
2. **Save current run** creates a named snapshot. **Save & load out** also parks the current run, freeing the multiplayer slot for another party.
3. Select a saved run and click **Load in**. The displaced run is preserved under **Automatic backups**.
4. Start the game and host with the original players. After playing, close the game and use **Update from game** or save a new snapshot. Snapshots do not update automatically.
5. Import a raw multiplayer `.save` or a `.spire` export. Export packages include the companion backup and checksums. Sharing preserves player IDs; loading under another host is not guaranteed by the game.

Player rosters show Steam display names alongside characters. Names are resolved through Steam on startup and when you click Refresh, and cached for offline use. Keep Steam running for fresh name lookups; unresolved players fall back to their character name. Save payloads remain byte-for-byte unchanged, and 64-bit Steam IDs are preserved without JavaScript number rounding.

Load in/out and restore operations update the selected profile’s local multiplayer files and, when enabled, their Steam Cloud counterparts through the game’s Steam API. Keep Steam running and signed into the same account, with the game closed. The app checks the account and App ID, backs up both copies, verifies the result, and rolls back on failure. It does not change Steam Cloud settings or manually edit Steam’s caches. Custom folders outside the standard `SlayTheSpire2/steam/<SteamID>/[modded/]profileN/saves` layout are managed locally.

## Data and recovery

Only `current_run_mp.save` and `current_run_mp.save.backup` are changed, locally and under the matching Steam profile key. Solo saves, profile progression, unlocks and history are never touched. Multiplayer files are backed up before any replacement or removal; stale companion backups are removed when a snapshot does not include one.

Library: `%APPDATA%\Spirekeeper`. Slots and recovery points have SHA-256 checksums. Cloud-enabled recovery points also contain `steam-cloud.json`, preserving the cloud payload independently from local files. A failed swap rolls back both copies; an interrupted or uncertain swap leaves a recovery journal and blocks further changes until recovery. Removed or superseded slots are retained in `trash/`. Backups are retained without automatic pruning. Back up the whole library folder to move it or protect it against disk failure.

Save JSON is validated as a multiplayer run, but game version, mods and roster compatibility remain the game’s responsibility. The app refuses swaps while `sts2.exe` or `SlayTheSpire2.exe` is running and rejects linked/junction save paths. Keep the game closed during swaps.

## Implementation

Electron with an isolated, sandboxed renderer and a narrow IPC interface; plain HTML/CSS/JavaScript UI. No app accounts, analytics or remote UI resources. A scoped PowerShell/C# helper uses the installed game’s `steam_api64.dll` for Steam Cloud operations; no game DLLs are redistributed. The helper is unpacked alongside the packaged app for execution. Profile layouts and multiplayer filename were checked against the local installation and these source references:

- https://github.com/jadistanbelly/sts2-multiplayer-save-slots
- https://github.com/wakaka6/SlaySP2Manger/blob/main/docs/save-file-reference.md
- https://partner.steamgames.com/doc/api/ISteamRemoteStorage

For isolated UI testing, set `SPIREKEEPER_DATA_DIR` and `SPIREKEEPER_SAVE_ROOT` to disposable directories before launching.
