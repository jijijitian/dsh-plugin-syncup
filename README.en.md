# dsh-plugin-sync

Manual plugin-inventory sync for DeepSeek Harness (DSH) through a private **GitHub Gist**. Configure it inside the plugin page, pull the Gist, review changes and conflicts, then install only what you select.

> Version 2.2.0 uses a secret Gist instead of a GitHub repository. Version 2.4.0 looks up by **Gist name** (default `dsh-plugin-sync`) and creates it on first push when missing. Version 2.0.0 is manual only: no startup sync, interval sync, or plugin-change sync.

## DSH compatibility

Targets DSH `0.2.1-rc.3` and registers `plugins.bundle.config`, which places the form on the plugin bundle's own page. The Host half has no npm runtime dependencies.

> **Restart DSH once when upgrading from 1.x or enabling the page for the first time.** DSH's client-modules caches package metadata per Loader entry until the process restarts. After that, normal updates only need a page refresh.

## Install

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-sync
```

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
7. **Push**: **Push local inventory** updates the Gist after a confirmation. Unchanged content creates no update. Concurrency uses the Gist version: read, compare before writing, and re-merge on change (up to three attempts). GitHub rejects conditional headers such as `If-Match` on this endpoint with `400 Bad Request`, so ETag preconditions cannot be used.

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

## Update to latest (second tab)

The Gist only knows what some host last pushed, so it can lag the real release: the manifest may say `dshmarket@1.70.2` while npm already serves `1.73.3`.

**Update to latest** bypasses the manifest and asks the package source directly:

| Source | Lookup |
| --- | --- |
| npm (`name` or `name@ver`) | `dist-tags.latest` from `registry.npmjs.org/<name>`; falls back to the highest listed version |
| GitHub (`github:owner/repo#ref`) | the highest version tag under `/repos/.../tags`; falls back to the default-branch HEAD sha when a repo has no tags |

1. **Check latest versions** lists "current → latest" with outdated / current / not-checkable per row.
2. Tick the bundles to update (all outdated rows are ticked by default).
3. **Update selected** installs the looked-up version through the same probe → remove → install → rollback protection.

`file:`, `link:`, and `https://...tgz` sources cannot be looked up; they are reported as "not checkable" instead of guessing a version.

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
