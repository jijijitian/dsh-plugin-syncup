<div align="center">

# <img src="icon.svg" alt="dsh-plugin-syncup" width="72" height="72"><br>dsh-plugin-syncup

**Sync DSH plugin inventories across machines through a private GitHub Gist, and update every plugin to its newest release.**

[中文](README.md) · [English](README.en.md)

</div>

---

## Overview

Manual plugin-inventory sync for DeepSeek Harness (DSH) through a private **GitHub Gist**. Configure it inside the plugin page, pull the Gist, review changes and conflicts, then install only what you select.

> Version 2.2.0 uses a secret Gist instead of a GitHub repository. Version 2.4.0 looks up by **Gist name** (default `dsh-plugin-syncup`) and creates it on first push when missing. Version 2.0.0 is manual only: no startup sync, interval sync, or plugin-change sync.

## DSH compatibility

Targets DSH `0.2.1-rc.3` and registers `plugins.bundle.config`, which places the form on the plugin bundle's own page. The Host half has no npm runtime dependencies.

> **Restart DSH once when upgrading from 1.x or enabling the page for the first time.** DSH's client-modules caches package metadata per Loader entry until the process restarts. After that, normal updates only need a page refresh.

## Install

Install from npm (the published, prebuilt package) — recommended:

```text
plugin_manager action=install_bundle target=dsh-plugin-syncup
```

Pin a version with `target=dsh-plugin-syncup@<version>`.

The GitHub repository remains available as an alternative:

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-syncup
```

Both install the same plugin; only the source differs:

| Method | Source | Difference |
| --- | --- | --- |
| `dsh-plugin-syncup` (npm, recommended) | The package published on the npm registry | Installs the prebuilt artifact shipped at publish time (including `lib/`), so nothing is built during installation and no build-script approval is requested; the version is whatever npm publishes |
| `github:jijijitian/dsh-plugin-syncup` | The default-branch source of the GitHub repository | Installs straight from the repository source, so the version follows the repository rather than the npm release and commits not yet published are included |

## Use

1. **Token**: enter a classic GitHub token with the `gist` scope in the plugin page. It is stored in DSH's credential service, not in the plugin configuration. On the first fill, click **How to get a token** to see the required permission and steps, then open the prefilled GitHub token page. An existing `GITHUB_TOKEN` environment token is detected and can be left unchanged.
2. **First host**: keep the default **Gist name** `dsh-plugin-sync` and click **Create Gist and push local inventory**. The plugin creates a secret Gist, writes `dsh-plugins.json`, stores the name and ID locally.
3. **Other hosts**: use the same Gist name. The plugin searches the current account by name; no repository or new Gist is needed. If it does not exist, the first push creates it.
4. **Pull**: click **Pull Gist manifest**. This only reads the Gist and stores a 10-minute preview.
5. **Resolve conflicts** per row:
   - missing remote bundle → use remote or skip;
   - newer remote version → upgrade or keep local;
   - older remote version → keep local by default (no silent downgrade);
   - same version but different source → keep local by default;
   - installed but disabled locally → keep disabled or enable;
   - hosts disagree on version/source → use the highest version, keep local, or skip;
   - local only (missing from the Gist) → **keep by default**, or remove the local bundle.
6. **Apply**: only rows set to **use remote** or **remove** are executed. Installs and removals both go through the DSH plugin manager.
7. **Push**: **Push local inventory** first reads the Gist and computes a remote-versus-local diff **without writing anything**; the manifest is updated only after you confirm.

| Case | Default | Choices |
| --- | --- | --- |
| In both places at different versions/sources | **Keep the newer version** (a tie keeps the local source) | keep newer / keep local / keep remote |
| Remote only | **Kept in the manifest** | keep / remove from manifest |
| Local only | **Pushed directly**, no question | — |

Identical rows are folded away. "Remove from manifest" deletes the bundle from **every** host record, so other hosts lose it too — use it deliberately. The Gist is re-read before writing, so a concurrent push is merged against fresh content (up to three attempts); a push only replaces this host's own `hosts.<hostId>` record.

Unchanged content creates no update. GitHub rejects conditional headers such as `If-Match` on this endpoint with `400 Bad Request`, so concurrency relies on read-compare-retry rather than ETag preconditions.

## Install method and log

Every install or removal calls the **DSH plugin manager** (`ctx.pluginManager`), the same path the Plugins page uses: DSH's bundled pnpm runs in the profile directory and updates `package.json` / `pnpm-lock.yaml`. The plugin never invokes pnpm itself and never copies packages.

The page also shows an **install log** card:

- The current job kind (preview / apply / push), its status, and `done/total` progress.
- One line per action, such as `installing dsh-context@0.77.0`, `dsh-context: installed`, `dsh-orphan: removed`, `dsh-extra: already installed; replacing 1.0.0 with 2.0.0`.
- Failures and warnings are colour-coded so the failing item is obvious.
- The panel refreshes while a job runs and keeps the last result afterwards.

The same log is available through the `plugin_sync` tool's `log` action. Removal is irreversible: it uninstalls the package and drops the profile selection, effective after a restart, so the apply button requires a second confirmation once a removal is selected. Bundles provided by the DSH installation and marked non-removable only offer "keep".

## Upgrading an installed bundle

While an `hmr` service is live, dsh 0.2.1's plugin manager answers `installBundle` with `already-installed` whenever the package is already a profile dependency, so there is no in-place upgrade. The Plugins page and dshmarket both remove first and install again. This plugin does the same, but `removeBundle()` deselects the bundle *before* it can fail with `bundle-in-use`, which would leave it installed yet dropped from `dsh.profile.bundles` (silently disabled, and it does not come back after a restart). Three layers prevent that:

**① Probe before removing.** Call `setBundleEnabled(name, false)` and read the bundle back. A `restart-required` answer or a still-enabled row means HMR cannot unload it, so the removal is **not attempted at all**.

**② Reselect after any failed removal.** If `removeBundle()` still refuses, `setBundleEnabled(name, true)` puts the bundle back, so a failure never strands it.

**③ Remember what needs a manual update.** A bundle that failed the probe is written to `state.manualUpdates`: the preview row shows a **Manual update** badge explaining why, and later syncs skip it instead of repeatedly trying to unload it.

Full sequence:

1. Install normally. On `already-installed`, record the installed version.
2. Skip immediately when the bundle is already in `manualUpdates`.
3. Probe with `setBundleEnabled(false)` and verify it was really unloaded.
4. Probe failed → reselect, record in `manualUpdates`, report why.
5. Probe passed → write `pendingUpgrades` → `removeBundle()` → `installBundle()`.
6. Removal failed → reselect (and record `manualUpdates` when the code is `bundle-in-use`).
7. New install failed → reinstall the recorded old spec and report "restored the previous version".
8. Clear `pendingUpgrades` after success or rollback; clear `manualUpdates` on success.

If the process stops during step 5, the page shows **An upgrade did not finish** with the bundle names and versions.

Two exceptions: the plugin never upgrades or removes **itself** (unloading the running code), and bundles marked `removable: false` only offer "keep".

Plugin-manager refusals usually carry a `code` but no `message`; every failure is now translated into a readable sentence (for example `not-bundle` becomes "The package does not provide a bundle patch"), so `[object Object]` no longer appears.

## Plugin updates (second tab)

The Gist only knows what some host last pushed, so it can lag the real release: the manifest may say `dshmarket@1.70.2` while npm already serves `1.73.3`.

**Plugin updates** bypasses the manifest and asks the package source directly:

| Source | Lookup |
| --- | --- |
| npm (`name` or `name@ver`) | `dist-tags.latest` from `registry.npmjs.org/<name>`; falls back to the highest listed version |
| GitHub (`github:owner/repo#ref`) | `GET /repos/.../releases`, taking the newest **stable release**; tags are only used when the repo has never published one |
| npm package + GitHub repo (automatic) | reads `repository` from the full npm metadata, asks GitHub by the rule above, then compares with the npm version |

### Four GitHub rules

1. **Releases, not tags.** Maintainers push a tag and publish the matching release later — or never. Installing from the newest tag can fail with `ERR_PNPM_NO_MATCHING_VERSION`. Releases decide whenever they exist; the tag fallback runs only when the release list was **read successfully** and is genuinely empty, and the page marks that case as "GitHub tag (no release)".
   - A failed release request (rate limit, network, auth) is **not** treated as "no releases". It reports an error instead of quietly switching to tags — otherwise one API rate limit would silently reintroduce tag-based updates.
2. **Newest by publish date, not by version number.** A repo can publish a high-numbered build early and later continue a lower line, so the highest semver is not the newest code. The default is the release with the latest `published_at`; the version comparison is used only when timestamps are unavailable (a tag list carries none).
3. **Stable releases only, platform builds filtered.** `draft` is skipped, `prerelease: true` is skipped, a version carrying a prerelease suffix (`5.20.0-beta.1`, `0.5.0-alpha4`) is skipped, and so is a build with `+` metadata (`v2.0.0+win`, `1.0.0+linux-x64`) — semver treats those as the base version, and they are per-platform builds rather than the project's newest release.
4. **A tie goes to npm.** GitHub wins only when its version is **strictly newer**; when both sides carry the same version npm is used, because it installs more reliably (prebuilt output, no missing `lib/`).

Only npm specs get the automatic GitHub comparison, through the `repository` field; without one, or when it is not a GitHub URL, npm alone is used. That field exists only in the full npm document, not in the compact `install-v1` one, so lookups request `Accept: application/json`.

> Example 1: `dsh-connect-workbuddy` publishes npm 5.17.0; the repo carries a `v5.18.0` tag but **no matching release** (the newest release is v5.17.0). The old tag-based check reported an update to 5.18.0; the current rule reports 5.17.0 and, being a tie, uses npm.
>
> Example 2: `dsh-ops` publishes `v0.5.0-alpha4` as its newest release (flagged prerelease); the newest stable release is `v0.4.4`. It now reports 0.4.4 instead of an alpha.
>
> Example 3: `dsh-whale-widget` shipped `v2.0.0+win` on 2026-09-20 and `v0.4.2` on 2026-10-11. Version ordering picks `2.0.0`; publish-date ordering with the platform filter picks **0.4.2**.

### Choosing a channel per bundle

The automatic rule is a default suggestion. Every outdated row carries a channel selector:

| Option | Meaning |
| --- | --- |
| Auto ({version}) | Use the automatic resolution described above |
| npm ({version}) | Install that version from the registry |
| GitHub ({version}) | Install that release from the repository |
| Do not update | Skip this row |

When a channel has no usable version the option is disabled and shows "n/a". The checkbox follows the selector: choosing "Do not update" unticks the row.

1. **Check latest versions** writes one log line per bundle as each lookup resolves, and the progress bar advances with it.
2. Tick the bundles to update and pick a channel per row if needed (with **Select all** / **Clear selection** for bulk changes).
3. **Update selected** re-checks **only the selected bundles** and installs them; the progress bar and log describe exactly those rows, and the install goes through the same probe → remove → install → rollback protection.

On scope: an update is a targeted action, so it neither reuses a profile-wide result nor rescans the whole profile. The log starts with `checking N selected bundle(s)`, where `N` is the number of selected rows.

`file:`, `link:`, and `https://...tgz` sources cannot be looked up; they are reported as "not checkable" instead of guessing a version.

### Progress and state consistency

- **Live log**: both checking and updating append one line per bundle instead of dumping everything at the end.
- **Progress bar**: shows `done/total` plus the bundle currently being worked on, driven by the Host's job progress.
- **Leaving and returning**: a remounted page reads the Host's `busy` flag, the live job, and the last check result (`?cached=1`) to restore the real state. Buttons stay disabled while the Host is busy, so a stray click cannot produce a contradictory "another operation is already running" error.

## Manual update steps

For a bundle HMR will not unload, the page prints a copy-pasteable terminal sequence:

```
1. Quit DSH completely
2. cd "%USERPROFILE%\.dsh\profiles\desktop"
3. "<dsh home>\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" ^
   "<dsh home>\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" ^
   add dsh-mnemon@0.5.36
4. Start DSH again
```

The command uses the node and pnpm **bundled with DSH**, so it does not depend on PATH, and `pnpm add` rewrites the dependency in one step — with DSH closed there is no HMR to compete with. The profile directory is derived from `DSH_HOME` + `DSH_PROFILE` (override with `DSH_PROFILE_DIR`). Failed entries carry a `manual` field, and the `plugin_sync` tool prints the same commands.

## Configuration

The page only asks for two inputs:

| Field | Default | Meaning |
| --- | --- | --- |
| Gist name | `dsh-plugin-sync` | Default name; editable. Other hosts on the same account use the same name, and the first push creates it if missing |
| GitHub Token | — | Stored in DSH credentials; leave blank to keep the configured token |

The remaining values use fixed defaults: `dsh-plugins.json`, a fixed Gist description, the hostname as host id, 20 installs per apply, and `https://api.github.com`. Hidden values retained from older configurations are preserved but no longer shown.

## Migration from the 2.1 repository configuration

`repo`, `branch`, and `path` are no longer read and are removed when the configuration is saved. Update the plugin, restart DSH, then keep the default Gist name or enter an existing name.

## Security

The Gist is secret but still reachable by URL; do not publish its ID together with the token. The remote manifest is trusted input because it selects packages that run with your permissions. The plugin rejects local filesystem specs, stores the page token in DSH credentials rather than the plugin config, never returns the token to the browser, never writes it into the manifest/Gist, and never auto-removes or auto-downgrades plugins.

## Development

```bash
node --test
```

Tests cover Gist read/create/update, ETag conflicts, truncated content, manifest merging, conflict-aware preview, config read/write and token hiding, selective apply, push/unchanged behavior, invalid remote JSON, and tool rendering.

See [README.md](README.md) for the full Chinese documentation and conflict table.
