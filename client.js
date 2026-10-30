window.__ModuleLoader__.load({
  id: 'dsh-plugin-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-plugin-sync'

    const zh = {
      summary: '默认使用 Gist 名称 dsh-plugin-sync；首次推送会自动创建。',
      configTitle: 'GitHub 连接',
      configHint: '只需要 Token；Gist 名称默认 dsh-plugin-sync，也可以修改。',
      fieldGistName: 'Gist 名称',
      fieldGistNameHint: '默认 dsh-plugin-sync；同一 GitHub 账号的其他主机填写相同名称即可。',
      fieldToken: 'GitHub Token',
      fieldTokenHint: 'classic token，需要 gist 权限；已配置时留空表示不修改。',
      tokenPlaceholder: 'ghp_...',
      tokenPlaceholderConfigured: '已配置，留空不修改',
      tokenReadonly: 'Token 由环境变量或外部凭据提供，无法在页面修改。',
      tokenHelp: '如何获取 Token',
      tokenHelpHide: '收起获取说明',
      tokenHelpPermissions: '所需权限',
      tokenHelpPermissionText: '只需要 classic token 的 gist 权限；不需要 repo 权限。fine-grained token 目前对 Gist 支持有限。',
      tokenHelpSteps: '操作步骤',
      tokenHelpStep1: '打开 GitHub 的 Token 创建页面（已预填描述和 gist 权限）。',
      tokenHelpStep2: '确认当前账号，并设置合适的过期时间。',
      tokenHelpStep3: '勾选 gist；不要勾选仓库等其他权限。',
      tokenHelpStep4: '点击生成，复制以 ghp_ 开头的 token。',
      tokenHelpStep5: '粘贴到上方输入框，然后点击保存配置。',
      tokenHelpSecurity: 'Token 只保存在 DSH 凭据服务中；不要分享，也不要写进仓库。',
      tokenHelpOpen: '打开 GitHub Token 页面',
      fieldFileName: '清单文件名',
      fieldDescription: 'Gist 描述',
      fieldHostId: '主机标识',
      fieldHostIdHint: '默认使用主机名；留空则使用默认值。',
      fieldTokenEnv: 'Token 环境变量',
      fieldTokenEnvHint: '从该环境变量读取 GitHub token（classic token 需要 gist 权限）。',
      fieldTokenFile: 'Token 文件',
      fieldTokenFileHint: '也可以指向只包含 token 的文件，例如 ~/.dsh/github-token。',
      fieldMaxInstalls: '单次最多安装',
      save: '保存配置',
      saving: '保存中…',
      saved: '已保存，插件正在重新加载。',
      configUnavailable: '当前 Host 没有可用的配置编辑器，无法保存配置。',
      tokenConfigured: 'Token 已配置（{source}）',
      tokenMissing: '未配置 Token：可预览公开 Gist，但不能创建或推送。',
      gistMissing: '尚未缓存该名称的 Gist；点击拉取会按名称查找，首次推送会自动创建。',
      saveGistFirst: 'Gist 名称已修改，请先保存配置再同步。',
      gistNameLabel: 'Gist 名称：{gistName}（未缓存）',
      localInfo: '本机 {profile} 个插件，其中 {portable} 个可移植。',
      manualTitle: '手动同步',
      manualHint: '点击“拉取线上清单”后，先预览变更和冲突；只有点击“应用同步”才会安装。不会自动同步。',
      pull: '拉取线上清单',
      pulling: '正在拉取…',
      refresh: '重新拉取',
      apply: '应用同步',
      applying: '正在应用…',
      discard: '放弃预览',
      noChanges: '没有需要应用的变更。',
      conflictCount: '{count} 个冲突',
      actionableCount: '{count} 项可执行',
      previewSummary: '线上 {hosts} 台主机 / {bundles} 条插件记录；{actionable} 项可执行，{conflicts} 个冲突。',
      conflictRules: '冲突处理：只增不删；线上版本更高时默认升级；线上更低或同版本不同来源时默认保留本机；主机之间版本冲突时默认采用最高版本；本机独有默认保留，也可选择删除。',
      kindInstall: '缺失',
      kindUpgrade: '升级',
      kindDowngrade: '降级',
      kindSpec: '来源变更',
      kindEnable: '启用',
      kindCurrent: '已一致',
      kindLocalOnly: '本机独有',
      kindRemoteOff: '线上停用',
      conflictHosts: '不同主机的版本或来源不一致',
      conflictDowngrade: '线上版本低于本机',
      conflictSpec: '版本相同但来源不同',
      conflictEnable: '本机已安装但停用',
      choiceRemote: '使用线上版本',
      choiceRemoteHighest: '使用线上最高版本',
      choiceEnable: '启用',
      choiceLocal: '保留本机',
      choiceKeepDisabled: '保持停用',
      choiceSkip: '跳过',
      choiceRemove: '删除本机插件',
      removeWarn: '删除会卸载该插件包并移除它在本 profile 中的选择，重启后生效。',
      localOnlyHint: '线上清单里没有这个插件；默认保留。',
      localOnlyFixed: '这个插件不可移除（由 DSH 安装提供），只能保留。',
      applyWithRemove: '应用（{count} 项，其中删除 {remove}）',
      manualUpdateBadge: '需手动更新',
      manualUpdateHint: 'HMR 无法在运行中卸载这个插件，自动升级会破坏它的启用状态；请到插件页更新，或重启后再试。',
      reselectedNote: '已恢复该插件的启用状态（删除被拒绝）。',
      tabSync: '同步 Gist',
      tabLatest: '插件更新',
      latestTitle: '插件更新',
      latestHint: '直接向 npm / GitHub 查询真实最新版本，不依赖 Gist 里其他主机推送的版本。',
      latestCheck: '检查最新版本',
      latestChecking: '检查中…',
      latestNone: '还没有检查结果。点击「检查最新版本」开始。',
      latestSummary: '共 {entries} 项：{outdated} 项可更新，{current} 项已是最新，{unsupported} 项无法查询。',
      latestOutdated: '可更新',
      latestCurrent: '已是最新',
      latestUnsupported: '无法查询',
      latestSourceNpm: 'npm',
      latestSourceGithub: 'GitHub',
      latestUpdateAll: '更新选中项',
      latestUpdating: '更新中…',
      latestSelectAll: '选中全部',
      latestSelectNone: '清除选择',
      latestDone: '已更新 {count} 项。',
      latestTarget: '{current} → {latest}',
      latestProgress: '已处理 {done}/{total}｜{name}',
      latestStarting: '正在准备…',
      manualTitle: '手动更新步骤',
      manualIntro: '下面这些插件 HMR 无法在运行中卸载，请在关闭 DSH 后到终端执行：',
      manualNote: '命令使用的是 DSH 自带的 node 与 pnpm，复制即可直接运行。',
      manualClose: '收起',
      installMethodTitle: '安装方式',
      installMethodValue: '调用 DSH 官方插件管理器（ctx.pluginManager；底层是 pnpm，与插件页安装同一路径）',
      logTitle: '安装日志',
      logEmpty: '还没有日志。拉取或同步后会在这里显示进度。',
      logShow: '显示日志',
      logHide: '收起日志',
      logProgress: '{done}/{total}',
      localVersion: '本机 {version}',
      remoteVersion: '线上 {version}',
      notInstalled: '未安装',
      upgradeNote: '升级已安装插件时，DSH 插件管理器会拒绝“重复安装”，因此这里先卸载旧版再安装新版；失败会自动装回旧版。',
      selfBlocked: '本插件不能替换或删除自己，请在插件页操作。',
      pendingTitle: '上次升级未完成',
      pendingBody: '以下插件在升级途中中断，请检查或重新推送：',
      rollbackRestored: '已回滚到旧版本',
      rollbackFailed: '回滚失败，请手动重装',
      sourceHosts: '来源主机：{hosts}',
      sameVersion: '同一版本',
      applyOk: '同步完成：安装/启用 {applied} 项，失败 {failed} 项。',
      applyPartial: '同步完成，但有 {failed} 项失败。',
      appliedTitle: '已应用',
      removedTitle: '已删除',
      failedTitle: '失败',
      skippedTitle: '跳过',
      restartRequired: '需要重启生效',
      pushTitle: 'Gist 清单',
      pushHint: '把本机可移植的插件清单推送/创建到私有 Gist，供其他主机手动拉取。',
      push: '推送本机清单',
      pushCreating: '创建 Gist 并推送本机清单',
      pushConfirm: '推送会更新 Gist 中的清单文件，确认推送？',
      pushConfirmCreate: '当前没有 Gist ID。确认创建私有 Gist 并推送本机清单？',
      pushConfirmButton: '确认推送',
      pushCancel: '取消',
      pushing: '正在推送…',
      pushCreated: '已创建 Gist（{gistName}）。其他主机填写相同名称即可。',
      pushPushed: '已推送（{version}）',
      pushUnchanged: 'Gist 清单已是最新。',
      gistLabel: 'Gist：{gistName}',
      lastPreview: '上次拉取：{time}',
      lastApply: '上次应用：{time}',
      lastPush: '上次推送：{time}',
      never: '从未',
      loadFailed: '读取插件状态失败：{message}',
      actionFailed: '操作失败：{message}',
      loading: '正在读取…',
      close: '关闭',
      dismiss: '知道了',
      notConfigured: '未配置',
      configured: '已配置',
    }

    const en = {
      summary: 'Use the default Gist name dsh-plugin-sync; the first push creates it.',
      configTitle: 'GitHub connection',
      configHint: 'Only a token is needed. The Gist name defaults to dsh-plugin-sync and can be changed.',
      fieldGistName: 'Gist name',
      fieldGistNameHint: 'Defaults to dsh-plugin-sync. Other hosts on the same GitHub account use the same name.',
      fieldToken: 'GitHub Token',
      fieldTokenHint: 'Classic token with the gist scope. Leave blank to keep the configured token.',
      tokenPlaceholder: 'ghp_...',
      tokenPlaceholderConfigured: 'Configured; leave blank to keep it',
      tokenReadonly: 'The token comes from the environment or an external credential and cannot be changed here.',
      tokenHelp: 'How to get a token',
      tokenHelpHide: 'Hide token instructions',
      tokenHelpPermissions: 'Required permission',
      tokenHelpPermissionText: 'Only the classic token gist scope is needed; no repo scope. Fine-grained tokens have limited Gist support.',
      tokenHelpSteps: 'Steps',
      tokenHelpStep1: 'Open GitHub\'s token creation page (description and gist scope are prefilled).',
      tokenHelpStep2: 'Confirm the account and choose an expiration.',
      tokenHelpStep3: 'Check gist; do not grant repository scopes.',
      tokenHelpStep4: 'Generate and copy the token beginning with ghp_.',
      tokenHelpStep5: 'Paste it above and click Save configuration.',
      tokenHelpSecurity: 'The token is stored only in DSH credentials. Do not share it or commit it.',
      tokenHelpOpen: 'Open GitHub token page',
      fieldFileName: 'Manifest file name',
      fieldDescription: 'Gist description',
      fieldHostId: 'Host id',
      fieldHostIdHint: 'Defaults to the hostname; leave blank to use the default.',
      fieldTokenEnv: 'Token env var',
      fieldTokenEnvHint: 'Read the GitHub token from this environment variable (classic token needs the gist scope).',
      fieldTokenFile: 'Token file',
      fieldTokenFileHint: 'Or point to a file containing only the token, for example ~/.dsh/github-token.',
      fieldMaxInstalls: 'Max installs per apply',
      save: 'Save configuration',
      saving: 'Saving…',
      saved: 'Saved. The plugin is reloading.',
      configUnavailable: 'This Host has no configuration editor, so the configuration cannot be saved.',
      tokenConfigured: 'Token configured ({source})',
      tokenMissing: 'No token: public Gists can be previewed, but create/push is unavailable.',
      gistMissing: 'This Gist name is not cached yet; Pull searches by name, and the first push creates it.',
      saveGistFirst: 'The Gist name changed. Save the configuration before syncing.',
      gistNameLabel: 'Gist name: {gistName} (not cached)',
      localInfo: '{profile} local bundles, {portable} portable.',
      manualTitle: 'Manual sync',
      manualHint: 'Pull the Gist manifest, review changes and conflicts, then click Apply. Nothing installs until you apply. There is no automatic sync.',
      pull: 'Pull Gist manifest',
      pulling: 'Pulling…',
      refresh: 'Pull again',
      apply: 'Apply sync',
      applying: 'Applying…',
      discard: 'Discard preview',
      noChanges: 'There are no changes to apply.',
      conflictCount: '{count} conflict(s)',
      actionableCount: '{count} actionable',
      previewSummary: 'Gist: {hosts} host(s) / {bundles} bundle record(s); {actionable} actionable, {conflicts} conflict(s).',
      conflictRules: 'Conflict policy: only add or upgrade; a newer remote version is selected by default; an older remote version or a same-version/different-source entry keeps the local copy; host disagreements default to the highest version; local-only bundles are kept by default and can be removed.',
      kindInstall: 'Missing',
      kindUpgrade: 'Upgrade',
      kindDowngrade: 'Downgrade',
      kindSpec: 'Source change',
      kindEnable: 'Enable',
      kindCurrent: 'Current',
      kindLocalOnly: 'Local only',
      kindRemoteOff: 'Remote off',
      conflictHosts: 'Hosts disagree on version or source',
      conflictDowngrade: 'Remote version is older',
      conflictSpec: 'Same version, different source',
      conflictEnable: 'Installed but disabled locally',
      choiceRemote: 'Use remote version',
      choiceRemoteHighest: 'Use highest remote version',
      choiceEnable: 'Enable',
      choiceLocal: 'Keep local',
      choiceKeepDisabled: 'Keep disabled',
      choiceSkip: 'Skip',
      choiceRemove: 'Remove local plugin',
      removeWarn: 'Removing uninstalls the package and drops its profile selection; it takes effect after a restart.',
      localOnlyHint: 'Not present in the remote manifest; kept by default.',
      localOnlyFixed: 'This bundle cannot be removed (provided by the DSH installation); it can only be kept.',
      applyWithRemove: 'Apply ({count} change(s), {remove} remove)',
      manualUpdateBadge: 'Manual update',
      manualUpdateHint: 'HMR cannot unload this bundle while DSH runs, so an automatic upgrade would break its enabled state. Update it from the terminal with DSH closed.',
      reselectedNote: 'Its profile selection was restored after the refused removal.',
      tabSync: 'Sync Gist',
      tabLatest: 'Plugin updates',
      latestTitle: 'Plugin updates',
      latestHint: 'Asks npm / GitHub for the real newest release instead of trusting the version another host pushed to the Gist.',
      latestCheck: 'Check latest versions',
      latestChecking: 'Checking…',
      latestNone: 'No results yet. Click "Check latest versions" to start.',
      latestSummary: '{entries} bundle(s): {outdated} outdated, {current} current, {unsupported} not checkable.',
      latestOutdated: 'Outdated',
      latestCurrent: 'Current',
      latestUnsupported: 'Not checkable',
      latestSourceNpm: 'npm',
      latestSourceGithub: 'GitHub',
      latestUpdateAll: 'Update selected',
      latestUpdating: 'Updating…',
      latestSelectAll: 'Select all',
      latestSelectNone: 'Clear selection',
      latestDone: 'Updated {count} bundle(s).',
      latestTarget: '{current} → {latest}',
      latestProgress: '{done}/{total} done｜{name}',
      latestStarting: 'Preparing…',
      manualTitle: 'Manual update steps',
      manualIntro: 'HMR cannot unload these bundles while DSH runs. Close DSH, then run this in a terminal:',
      manualNote: 'The command uses the node and pnpm bundled with DSH, so it runs as pasted.',
      manualClose: 'Hide',
      installMethodTitle: 'Install method',
      installMethodValue: 'DSH plugin manager (ctx.pluginManager — pnpm underneath, the same path the plugin page uses)',
      logTitle: 'Install log',
      logEmpty: 'No log yet. Pull or sync to see progress here.',
      logShow: 'Show log',
      logHide: 'Hide log',
      logProgress: '{done}/{total}',
      localVersion: 'local {version}',
      remoteVersion: 'remote {version}',
      notInstalled: 'not installed',
      upgradeNote: 'The DSH plugin manager rejects re-adding an installed bundle, so an upgrade removes the old copy and installs the new one; a failed install restores the old version.',
      selfBlocked: 'This plugin cannot replace or remove itself; use the Plugins page.',
      pendingTitle: 'An upgrade did not finish',
      pendingBody: 'These bundles were interrupted mid-upgrade; check or push again:',
      rollbackRestored: 'restored the previous version',
      rollbackFailed: 'restore failed; reinstall manually',
      sourceHosts: 'Source hosts: {hosts}',
      sameVersion: 'same version',
      applyOk: 'Sync finished: {applied} installed/enabled, {failed} failed.',
      applyPartial: 'Sync finished with {failed} failure(s).',
      appliedTitle: 'Applied',
      removedTitle: 'Removed',
      failedTitle: 'Failed',
      skippedTitle: 'Skipped',
      restartRequired: 'Restart required',
      pushTitle: 'Gist manifest',
      pushHint: 'Publish this host\'s portable inventory to a secret Gist so other hosts can pull it.',
      push: 'Push local inventory',
      pushCreating: 'Create Gist and push local inventory',
      pushConfirm: 'This updates the manifest file in the Gist. Push now?',
      pushConfirmCreate: 'No Gist ID is configured. Create a secret Gist and push this host\'s inventory?',
      pushConfirmButton: 'Confirm push',
      pushCancel: 'Cancel',
      pushing: 'Pushing…',
      pushCreated: 'Created Gist ({gistName}). Other hosts use the same name.',
      pushPushed: 'Pushed ({version})',
      pushUnchanged: 'The Gist manifest is already up to date.',
      gistLabel: 'Gist: {gistName}',
      lastPreview: 'Last pull: {time}',
      lastApply: 'Last apply: {time}',
      lastPush: 'Last push: {time}',
      never: 'never',
      loadFailed: 'Could not read plugin status: {message}',
      actionFailed: 'Action failed: {message}',
      loading: 'Loading…',
      close: 'Close',
      dismiss: 'Dismiss',
      notConfigured: 'not configured',
      configured: 'configured',
    }

    const CSS = `
.dsh-ps{box-sizing:border-box;width:100%;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary)}
.dsh-ps *{box-sizing:border-box}
.dsh-ps a{color:var(--dsw-alias-brand-primary);text-decoration:none;overflow-wrap:anywhere}
.dsh-ps-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:16px;display:flex;flex-direction:column;gap:12px}
.dsh-ps-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dsh-ps-title{margin:0;font-size:15px;line-height:22px;font-weight:600}
.dsh-ps-desc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dsh-ps-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsh-ps-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-input{height:32px;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:13px}
.dsh-ps-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ps-input:disabled{opacity:.55}
.dsh-ps-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-help-wrap{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.dsh-ps-help{width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:12px;display:flex;flex-direction:column;gap:10px}
.dsh-ps-help-title{margin:0;font-size:13px;line-height:20px;font-weight:600}
.dsh-ps-help p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-help ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-help a.dsh-ps-btn{display:inline-flex;align-items:center;justify-content:center;width:max-content;text-decoration:none}
.dsh-ps-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsh-ps-btn{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.dsh-ps-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-ps-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ps-btn:disabled{opacity:.45;cursor:default}
.dsh-ps-btn.primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-ps-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-ps-summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsh-ps-badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}
.dsh-ps-badge.ok{color:var(--dsw-alias-state-success-primary)}
.dsh-ps-badge.warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-ps-badge.error{color:var(--dsw-alias-state-error-primary)}
.dsh-ps-alert{border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);font-size:13px;line-height:20px}
.dsh-ps-alert.error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-ps-ok{color:var(--dsw-alias-state-success-primary);font-size:13px;line-height:20px}
.dsh-ps-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
.dsh-ps-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-ps-entry{display:flex;flex-direction:column;gap:6px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-ps-entry-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.dsh-ps-name{font-size:13px;line-height:20px;font-weight:500;overflow-wrap:anywhere}
.dsh-ps-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsh-ps-conflict{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}
.dsh-ps-variants{display:flex;flex-wrap:wrap;gap:6px}
.dsh-ps-variant{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:1px 6px;overflow-wrap:anywhere}
.dsh-ps-select{height:30px;min-width:132px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 8px}
.dsh-ps-select:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ps-confirm{border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-2)}
.dsh-ps-result{display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:20px}
.dsh-ps-muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ps-log{max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);padding:8px 10px;display:flex;flex-direction:column;gap:2px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px}
.dsh-ps-logline{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-ps-logline.warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-ps-logline.error{color:var(--dsw-alias-state-error-primary)}
.dsh-ps-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:12px}
.dsh-ps-tab{appearance:none;background:none;border:none;border-bottom:2px solid transparent;padding:8px 12px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;margin-bottom:-1px}
.dsh-ps-tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-ps-tab.active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary);font-weight:500}
.dsh-ps-steps{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.dsh-ps-step{display:flex;flex-direction:column;gap:4px}
.dsh-ps-step-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-ps-cmd{display:block;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;user-select:all}
.dsh-ps-progress{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.dsh-ps-progress-track{height:6px;border-radius:3px;background:var(--dsw-alias-border-l1);overflow:hidden}
.dsh-ps-progress-bar{height:100%;border-radius:3px;background:var(--dsw-alias-state-business-primary);transition:width .25s ease}
@media(max-width:640px){.dsh-ps-grid{grid-template-columns:minmax(0,1fr)}.dsh-ps-entry-head{flex-direction:column;align-items:stretch}.dsh-ps-select{width:100%}}
`

    const FIELDS = [
      { key: 'gistName', label: 'fieldGistName', hint: 'fieldGistNameHint', placeholder: 'dsh-plugin-sync' },
    ]
    const TOKEN_FIELD = { key: 'token', label: 'fieldToken', hint: 'fieldTokenHint', placeholder: 'Gist token', type: 'password' }
    const TOKEN_URL = 'https://github.com/settings/tokens/new?description=DSH%20Plugin%20Sync&scopes=gist'

    function endpoint(name) {
      return new URL(`dsh-plugin-sync/api/v2/${name}`, document.baseURI).pathname
    }

    async function call(name, { method = 'GET', body } = {}) {
      const response = await fetch(endpoint(name), {
        method,
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) {
        const message = typeof data?.error?.message === 'string'
          ? data.error.message
          : typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`
        const error = new Error(message)
        error.code = data?.error?.code
        throw error
      }
      return data
    }

    function kindLabel(kind, t) {
      if (kind === 'install') return t('kindInstall')
      if (kind === 'upgrade') return t('kindUpgrade')
      if (kind === 'downgrade') return t('kindDowngrade')
      if (kind === 'spec-change') return t('kindSpec')
      if (kind === 'enable') return t('kindEnable')
      if (kind === 'current') return t('kindCurrent')
      if (kind === 'local-only') return t('kindLocalOnly')
      if (kind === 'remote-disabled') return t('kindRemoteOff')
      return kind
    }

    function choiceLabel(entry, choice, t) {
      if (choice === 'remote') {
        if (entry.kind === 'enable') return t('choiceEnable')
        if (entry.conflict?.type === 'host-disagreement') return t('choiceRemoteHighest')
        return t('choiceRemote')
      }
      if (choice === 'local') return entry.kind === 'enable' ? t('choiceKeepDisabled') : t('choiceLocal')
      if (choice === 'remove') return t('choiceRemove')
      return t('choiceSkip')
    }

    function conflictLabel(conflict, t) {
      if (conflict.type === 'host-disagreement') return t('conflictHosts')
      if (conflict.type === 'downgrade') return t('conflictDowngrade')
      if (conflict.type === 'spec-change') return t('conflictSpec')
      if (conflict.type === 'enable-state') return t('conflictEnable')
      return conflict.type
    }

    function versionLine(entry, t) {
      const local = entry.local?.version ? t('localVersion', { version: entry.local.version }) : t('notInstalled')
      const remote = entry.remote?.version ? t('remoteVersion', { version: entry.remote.version }) : ''
      return remote === '' ? local : `${local} · ${remote}`
    }

    function ConfigField({ field, value, onChange, t, disabled, hintOverride }) {
      const hint = hintOverride ?? (field.hint === null ? null : t(field.hint))
      return h('label', { className: 'dsh-ps-field' },
        h('span', { className: 'dsh-ps-label' }, t(field.label)),
        h('input', {
          className: 'dsh-ps-input',
          type: field.type ?? (field.key === 'maxInstallsPerRun' ? 'number' : 'text'),
          min: field.key === 'maxInstallsPerRun' ? 1 : undefined,
          max: field.key === 'maxInstallsPerRun' ? 50 : undefined,
          value: value ?? '',
          placeholder: field.placeholder,
          disabled,
          autoComplete: field.type === 'password' ? 'off' : undefined,
          onChange: (event) => onChange(field.key, event.target.value),
        }),
        hint === null ? null : h('span', { className: 'dsh-ps-hint' }, hint),
      )
    }

    function ConfigPage({ t, view }) {
      const [status, setStatus] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [tokenDraft, setTokenDraft] = React.useState('')
      const [showTokenHelp, setShowTokenHelp] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [selections, setSelections] = React.useState({})
      const [previewing, setPreviewing] = React.useState(false)
      const [applying, setApplying] = React.useState(false)
      const [applyResult, setApplyResult] = React.useState(null)
      const [confirmPush, setConfirmPush] = React.useState(false)
      const [pushing, setPushing] = React.useState(false)
      const [pushResult, setPushResult] = React.useState(null)
      const [job, setJob] = React.useState(null)
      const [showLog, setShowLog] = React.useState(false)
      const [confirmRemove, setConfirmRemove] = React.useState(null)
      const [tab, setTab] = React.useState('sync')
      const [latest, setLatest] = React.useState(null)
      const [latestPicked, setLatestPicked] = React.useState({})
      const [checking, setChecking] = React.useState(false)
      const [latestUpdating, setLatestUpdating] = React.useState(false)
      const [latestMessage, setLatestMessage] = React.useState(null)
      const [latestApplied, setLatestApplied] = React.useState(null)
      const [manualOpen, setManualOpen] = React.useState(true)

      const pollJob = React.useCallback(async () => {
        try {
          const data = await call('jobs')
          setJob(data.latest ?? null)
        } catch {
          // A log read must never break the page.
        }
      }, [])

      React.useEffect(() => {
        void pollJob()
      }, [pollJob])

      React.useEffect(() => {
        if (!applying && !previewing && !pushing && !checking && !latestUpdating) return undefined
        const timer = setInterval(() => { void pollJob() }, 600)
        return () => clearInterval(timer)
      }, [applying, previewing, pushing, checking, latestUpdating, pollJob])

      const loadStatus = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const data = await call('status')
          setStatus(data)
          setDraft(data.configSnapshot?.values ?? {})
          if (typeof data.configError === 'string' && data.configError !== '') {
            setError(data.configError)
          }
        } catch (failure) {
          setError(t('loadFailed', { message: failure.message }))
        } finally {
          setLoading(false)
        }
      }, [t])

      React.useEffect(() => {
        void loadStatus()
        void pollJob()
      }, [loadStatus, pollJob])

      // Restore the last version check so returning to the page shows the real
      // state instead of an empty tab or a spurious error.
      const restoredRef = React.useRef(false)
      React.useEffect(() => {
        if (restoredRef.current || status === null) return
        if (status.latestCheckedAt === null || status.latestCheckedAt === undefined) return
        restoredRef.current = true
        void (async () => {
          try {
            const data = await call('latest?cached=1')
            if (data.cached !== true) return
            setLatest(data)
            const picked = {}
            for (const entry of data.entries) {
              if (entry.outdated === true) picked[entry.name] = true
            }
            setLatestPicked(picked)
          } catch {
            // A restore failure must not surface as an operation error.
          }
        })()
      }, [status, call])

      // A page mounted while the Host is still working must resume the running
      // job instead of reporting an idle state or firing a conflicting request.
      React.useEffect(() => {
        if (status?.busy !== true) return
        setShowLog(true)
        if (job?.status === 'running' && job.kind === 'apply-latest') setLatestUpdating(true)
        if (job?.status === 'running' && job.kind === 'check') setChecking(true)
      }, [status?.busy, job?.status, job?.kind])

      // While the Host is busy the buttons must stay disabled: pressing one would
      // only produce a "another operation is already running" error that
      // contradicts the progress the user is watching.
      const hostBusy = status?.busy === true

      if (view === 'summary') return h('span', { className: 'dsh-ps-muted' }, t('summary'))

      const configSnapshot = status?.configSnapshot
      const values = draft ?? configSnapshot?.values ?? {}
      const editable = configSnapshot?.editable === true
      const draftGistName = typeof values.gistName === 'string' ? values.gistName : ''
      const savedGistName = typeof configSnapshot?.values?.gistName === 'string' ? configSnapshot.values.gistName : ''
      const effectiveGistName = draftGistName || status?.gistName || 'dsh-plugin-sync'
      const gistConfigured = typeof status?.gistId === 'string' && status.gistId !== ''
      const gistDirty = draftGistName !== savedGistName
      const canOperate = !gistDirty
      const gistUri = status?.gistUrl ?? null
      const token = status?.token
      const state = status?.state
      const lastPreview = state?.lastPreviewAt
      const lastApply = state?.lastApplyAt
      const lastPush = state?.lastPushAt
      const pendingUpgrades = Array.isArray(state?.pendingUpgrades) ? state.pendingUpgrades : []

      const updateField = (key, value) => {
        setDraft((current) => ({ ...(current ?? values), [key]: value }))
      }

      const saveConfig = async () => {
        if (!editable) return
        setSaving(true)
        setError(null)
        setMessage(null)
        try {
          await call('config', {
            method: 'POST',
            body: {
              values: { gistName: (draft ?? values).gistName ?? '' },
              ...(tokenDraft.trim() === '' ? {} : { token: tokenDraft.trim() }),
            },
          })
          setTokenDraft('')
          setMessage(t('saved'))
          setTimeout(() => { void loadStatus() }, 1200)
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
        } finally {
          setSaving(false)
        }
      }

      const pullPreview = async () => {
        setPreviewing(true)
        setError(null)
        setMessage(null)
        setApplyResult(null)
        setShowLog(true)
        try {
          const data = await call('preview', { method: 'POST', body: {} })
          const next = {}
          for (const entry of data.entries) next[entry.id] = entry.defaultChoice
          setPreview(data)
          setSelections(next)
          void loadStatus()
          void pollJob()
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
          void pollJob()
        } finally {
          setPreviewing(false)
        }
      }

      const checkLatest = async () => {
        setChecking(true)
        setError(null)
        setLatestMessage(null)
        setShowLog(true)
        void pollJob()
        try {
          const data = await call('latest')
          setLatest(data)
          const picked = {}
          for (const entry of data.entries) {
            if (entry.outdated === true) picked[entry.name] = true
          }
          setLatestPicked(picked)
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
        } finally {
          setChecking(false)
          void pollJob()
          void loadStatus()
        }
      }

      const updateLatest = async () => {
        const names = Object.keys(latestPicked).filter((name) => latestPicked[name] === true)
        if (names.length === 0) return
        setLatestUpdating(true)
        setError(null)
        setLatestMessage(null)
        setShowLog(true)
        void pollJob()
        try {
          const data = await call('latest', { method: 'POST', body: { names } })
          setLatestMessage(data.ok
            ? t('latestDone', { count: data.totalApplied })
            : t('applyPartial', { failed: data.failed.length }))
          setLatestApplied(data)
          setLatest(null)
          setLatestPicked({})
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
        } finally {
          setLatestUpdating(false)
          void pollJob()
          void loadStatus()
        }
      }

      const applyPreview = async () => {
        if (preview === null) return
        setApplying(true)
        setError(null)
        setMessage(null)
        setShowLog(true)
        try {
          const data = await call('apply', {
            method: 'POST',
            body: { previewId: preview.previewId, selections },
          })
          setApplyResult(data)
          setPreview(null)
          setMessage(data.ok
            ? t('applyOk', { applied: data.totalApplied, failed: 0 })
            : t('applyPartial', { failed: data.failed.length }))
          void loadStatus()
          void pollJob()
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
          void pollJob()
        } finally {
          setApplying(false)
        }
      }

      const pushNow = async () => {        setPushing(true)
        setError(null)
        setMessage(null)
        setShowLog(true)
        try {
          const data = await call('push', { method: 'POST', body: { confirm: true } })
          setPushResult(data)
          if (typeof data.gistName === 'string' && data.gistName !== '') {
            setDraft((current) => ({ ...(current ?? values), gistName: data.gistName }))
          }
          setMessage(data.created === true
            ? t('pushCreated', { gistName: data.gistName ?? effectiveGistName })
            : data.status === 'pushed'
              ? t('pushPushed', { version: (data.version ?? '').slice(0, 12) })
              : t('pushUnchanged'))
          setConfirmPush(false)
          void loadStatus()
          void pollJob()
          setTimeout(() => { void loadStatus() }, 1200)
        } catch (failure) {
          setError(t('actionFailed', { message: failure.message }))
          void pollJob()
        } finally {
          setPushing(false)
        }
      }

      const visibleEntries = preview === null ? [] : preview.entries.filter((entry) => (
        entry.defaultChoice === 'remote'
        || entry.choices.includes('remove')
        || entry.conflict !== null
        || ['install', 'upgrade', 'downgrade', 'spec-change', 'enable'].includes(entry.kind)
      ))
      const selectedCount = visibleEntries.filter((entry) => (
        selections[entry.id] === 'remote' || selections[entry.id] === 'remove'
      )).length
      const removeCount = visibleEntries.filter((entry) => selections[entry.id] === 'remove').length
      const manualItems = applyResult === null || !Array.isArray(applyResult.failed)
        ? []
        : applyResult.failed.filter((item) => item.manual !== undefined && Array.isArray(item.manual.steps))

      if (loading && status === null) {
        return h('div', { className: 'dsh-ps' },
          h('style', null, CSS),
          h('div', { className: 'dsh-ps-card' }, h('p', { className: 'dsh-ps-desc' }, t('loading'))),
        )
      }

      return h('div', { className: 'dsh-ps' },
        h('style', null, CSS),

        h('section', { className: 'dsh-ps-card' },
          h('div', { className: 'dsh-ps-head' },
            h('div', null,
              h('h3', { className: 'dsh-ps-title' }, t('configTitle')),
              h('p', { className: 'dsh-ps-desc' }, t('configHint')),
            ),
            h('span', { className: `dsh-ps-badge ${token?.configured ? 'ok' : 'warn'}` },
              token?.configured ? t('tokenConfigured', { source: token.source ?? '' }) : t('tokenMissing')),
          ),
          error === null ? null : h('div', { className: 'dsh-ps-alert error' }, error),
          message === null ? null : h('div', { className: 'dsh-ps-ok' }, message),
          configSnapshot?.editable === false
            ? h('div', { className: 'dsh-ps-alert' }, t('configUnavailable'))
            : null,
          h('div', { className: 'dsh-ps-grid' },
            FIELDS.map((field) => h(ConfigField, {
              key: field.key,
              field,
              t,
              value: values[field.key],
              disabled: !editable || saving,
              onChange: updateField,
            })),
            h(ConfigField, {
              key: 'token',
              field: {
                ...TOKEN_FIELD,
                placeholder: token?.configured ? t('tokenPlaceholderConfigured') : t('tokenPlaceholder'),
                hint: null,
              },
              t,
              value: tokenDraft,
              disabled: !editable || saving || token?.writable === false,
              hintOverride: token?.writable === false ? t('tokenReadonly') : t('fieldTokenHint'),
              onChange: (_key, value) => { setTokenDraft(value) },
            }),
          ),
          token?.configured === true ? null : h('div', { className: 'dsh-ps-help-wrap' },
            h('button', {
              type: 'button',
              className: 'dsh-ps-btn',
              'aria-expanded': showTokenHelp,
              'aria-controls': 'dsh-ps-token-help',
              onClick: () => { setShowTokenHelp((current) => !current) },
            }, showTokenHelp ? t('tokenHelpHide') : t('tokenHelp')),
            showTokenHelp ? h('div', { className: 'dsh-ps-help', id: 'dsh-ps-token-help', role: 'region' },
              h('div', null,
                h('p', { className: 'dsh-ps-help-title' }, t('tokenHelpPermissions')),
                h('p', null, t('tokenHelpPermissionText')),
              ),
              h('div', null,
                h('p', { className: 'dsh-ps-help-title' }, t('tokenHelpSteps')),
                h('ol', null,
                  [1, 2, 3, 4, 5].map((step) => h('li', { key: step }, t(`tokenHelpStep${step}`))),
                ),
              ),
              h('p', { className: 'dsh-ps-hint' }, t('tokenHelpSecurity')),
              h('a', {
                className: 'dsh-ps-btn primary',
                href: TOKEN_URL,
                target: '_blank',
                rel: 'noreferrer',
              }, t('tokenHelpOpen')),
            ) : null,
          ),
          h('div', { className: 'dsh-ps-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-ps-btn primary',
              disabled: !editable || saving,
              onClick: () => { void saveConfig() },
            }, saving ? t('saving') : t('save')),
            status?.local === null || status?.local === undefined
              ? null
              : h('span', { className: 'dsh-ps-muted' }, t('localInfo', {
                  profile: status.local.profileBundles ?? 0,
                  portable: status.local.portableBundles ?? 0,
                })),
          ),
        ),

        h('div', { className: 'dsh-ps-tabs' },
          h('button', {
            type: 'button',
            className: `dsh-ps-tab ${tab === 'sync' ? 'active' : ''}`,
            onClick: () => { setTab('sync') },
          }, t('tabSync')),
          h('button', {
            type: 'button',
            className: `dsh-ps-tab ${tab === 'latest' ? 'active' : ''}`,
            onClick: () => { setTab('latest') },
          }, t('tabLatest')),
        ),

        tab !== 'latest' ? null : h('section', { className: 'dsh-ps-card' },
          h('div', { className: 'dsh-ps-head' },
            h('div', null,
              h('h3', { className: 'dsh-ps-title' }, t('latestTitle')),
              h('p', { className: 'dsh-ps-desc' }, t('latestHint')),
            ),
          ),
          h('div', { className: 'dsh-ps-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-ps-btn primary',
              disabled: checking || latestUpdating || hostBusy,
              onClick: () => { void checkLatest() },
            }, checking ? t('latestChecking') : t('latestCheck')),
            latest === null || latest.entries.length === 0 ? null : h(React.Fragment, null,
              h('button', {
                type: 'button',
                className: 'dsh-ps-btn',
                disabled: checking || latestUpdating,
                onClick: () => {
                  const picked = {}
                  for (const entry of latest.entries) if (entry.outdated === true) picked[entry.name] = true
                  setLatestPicked(picked)
                },
              }, t('latestSelectAll')),
              h('button', {
                type: 'button',
                className: 'dsh-ps-btn',
                disabled: checking || latestUpdating,
                onClick: () => { setLatestPicked({}) },
              }, t('latestSelectNone')),
            ),
          ),
          latestMessage === null ? null : h('div', { className: 'dsh-ps-ok' }, latestMessage),
          latest === null
            ? h('p', { className: 'dsh-ps-desc' }, t('latestNone'))
            : h(React.Fragment, null,
                h('div', { className: 'dsh-ps-summary' },
                  h('span', { className: `dsh-ps-badge ${latest.counts.outdated > 0 ? 'warn' : 'ok'}` },
                    t('latestSummary', {
                      entries: latest.counts.entries,
                      outdated: latest.counts.outdated,
                      current: latest.counts.current,
                      unsupported: latest.counts.unsupported,
                    })),
                ),
                h('div', { className: 'dsh-ps-list' },
                  latest.entries.map((entry) => h('div', { className: 'dsh-ps-entry', key: `l-${entry.name}` },
                    h('div', { className: 'dsh-ps-entry-head' },
                      h('div', null,
                        h('div', { className: 'dsh-ps-name' }, entry.name),
                        h('div', { className: 'dsh-ps-meta' },
                          entry.outdated === true
                            ? t('latestTarget', { current: entry.local.version || '?', latest: entry.latest })
                            : entry.error === undefined
                              ? `${t('latestCurrent')} · ${entry.local.version || '?'}`
                              : `${t('latestUnsupported')} · ${entry.error}`),
                        h('div', { className: 'dsh-ps-meta' },
                          entry.source === 'github' ? t('latestSourceGithub') : t('latestSourceNpm')),
                      ),
                      entry.outdated === true
                        ? h('input', {
                            type: 'checkbox',
                            checked: latestPicked[entry.name] === true,
                            disabled: latestUpdating,
                            onChange: (event) => {
                              const value = event.target.checked
                              setLatestPicked((current) => ({ ...current, [entry.name]: value }))
                            },
                          })
                        : h('span', { className: `dsh-ps-badge ${entry.error === undefined ? 'ok' : 'warn'}` },
                            entry.error === undefined ? t('latestCurrent') : t('latestUnsupported')),
                    ),
                  )),
                ),
                h('div', { className: 'dsh-ps-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dsh-ps-btn primary',
                    disabled: latestUpdating || hostBusy || Object.keys(latestPicked).filter((n) => latestPicked[n]).length === 0,
                    onClick: () => { void updateLatest() },
                  }, latestUpdating ? t('latestUpdating') : t('latestUpdateAll')),
                ),
                latestUpdating || checking ? h('div', { className: 'dsh-ps-progress' },
                  h('div', { className: 'dsh-ps-progress-track' },
                    h('div', {
                      className: 'dsh-ps-progress-bar',
                      style: {
                        width: job?.progress?.total > 0
                          ? `${Math.round((job.progress.done / job.progress.total) * 100)}%`
                          : '0%',
                      },
                    }),
                  ),
                  h('span', { className: 'dsh-ps-muted' },
                    job?.progress?.total > 0
                      ? t('latestProgress', {
                          done: job.progress.done,
                          total: job.progress.total,
                          name: job.lines[job.lines.length - 1]?.message ?? '',
                        })
                      : t('latestStarting')),
                ) : null,
              ),
          latestApplied === null ? null : h('div', { className: 'dsh-ps-result' },
            latestApplied.updatedList?.length
              ? latestApplied.updatedList.map((item) => h('div', { className: 'dsh-ps-meta', key: `u-${item.name}` },
                  `${item.name}: ${item.replaced ?? ''} → ${item.version ?? item.latest ?? ''}`))
              : null,
            latestApplied.failed?.length
              ? latestApplied.failed.map((item) => h('div', { className: 'dsh-ps-error', key: `uf-${item.name}` },
                  `${item.name}: ${item.error ?? ''}`))
              : null,
          ),
        ),

        tab !== 'sync' ? null : h('section', { className: 'dsh-ps-card' },
          h('div', { className: 'dsh-ps-head' },
            h('div', null,
              h('h3', { className: 'dsh-ps-title' }, t('manualTitle')),
              h('p', { className: 'dsh-ps-desc' }, t('manualHint')),
            ),
          ),
          h('div', { className: 'dsh-ps-summary' },
            h('span', { className: `dsh-ps-badge ${gistConfigured ? 'ok' : 'warn'}` },
              gistConfigured
                ? t('gistLabel', { gistName: effectiveGistName })
                : t('gistNameLabel', { gistName: effectiveGistName })),
            gistUri === null || gistDirty ? null : h('a', {
              className: 'dsh-ps-muted',
              href: gistUri,
              target: '_blank',
              rel: 'noreferrer',
            }, gistUri),
            h('span', { className: 'dsh-ps-muted' }, t('lastPreview', { time: lastPreview ?? t('never') })),
            h('span', { className: 'dsh-ps-muted' }, t('lastApply', { time: lastApply ?? t('never') })),
          ),
          h('div', { className: 'dsh-ps-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-ps-btn primary',
              disabled: previewing || !canOperate,
              onClick: () => { void pullPreview() },
            }, previewing ? t('pulling') : (preview === null ? t('pull') : t('refresh'))),
            preview === null ? null : h('button', {
              type: 'button',
              className: 'dsh-ps-btn',
              disabled: previewing || applying,
              onClick: () => { setPreview(null); setApplyResult(null) },
            }, t('discard')),
          ),
          gistDirty
            ? h('div', { className: 'dsh-ps-alert' }, t('saveGistFirst'))
            : !gistConfigured ? h('div', { className: 'dsh-ps-alert' }, t('gistMissing')) : null,
          preview === null ? null : h(React.Fragment, null,
            h('div', { className: 'dsh-ps-summary' },
              h('span', { className: 'dsh-ps-badge' }, t('previewSummary', {
                hosts: preview.remote?.hostCount ?? 0,
                bundles: preview.remote?.bundleCount ?? 0,
                actionable: preview.counts?.actionable ?? 0,
                conflicts: preview.counts?.conflicts ?? 0,
              })),
              h('span', { className: `dsh-ps-badge ${preview.counts?.conflicts ? 'warn' : 'ok'}` },
                t('conflictCount', { count: preview.counts?.conflicts ?? 0 })),
              h('span', { className: 'dsh-ps-badge' },
                t('actionableCount', { count: selectedCount })),
            ),
            h('p', { className: 'dsh-ps-hint' }, t('conflictRules')),
            visibleEntries.length === 0
              ? h('p', { className: 'dsh-ps-desc' }, t('noChanges'))
              : h('div', { className: 'dsh-ps-list' },
                  visibleEntries.map((entry) => h('div', { className: 'dsh-ps-entry', key: entry.id },
                    h('div', { className: 'dsh-ps-entry-head' },
                      h('div', null,
                        h('div', { className: 'dsh-ps-name' }, entry.name),
                        h('div', { className: 'dsh-ps-meta' }, versionLine(entry, t)),
                        entry.remote?.hosts?.length
                          ? h('div', { className: 'dsh-ps-meta' }, t('sourceHosts', { hosts: entry.remote.hosts.join(', ') }))
                          : null,
                      ),
                      h('select', {
                        className: 'dsh-ps-select',
                        value: selections[entry.id] ?? entry.defaultChoice,
                        disabled: applying,
                        onChange: (event) => {
                          const value = event.target.value
                          setSelections((current) => ({ ...current, [entry.id]: value }))
                        },
                      }, entry.choices.map((choice) => h('option', { key: choice, value: choice }, choiceLabel(entry, choice, t)))),
                    ),
                    entry.conflict === null ? null : h('div', { className: 'dsh-ps-conflict' }, conflictLabel(entry.conflict, t)),
                    entry.kind === 'local-only'
                      ? h('div', { className: 'dsh-ps-meta' }, t('localOnlyHint'))
                      : null,
                    entry.kind === 'local-only' && !entry.local?.removable
                      ? h('div', { className: 'dsh-ps-conflict' }, t('localOnlyFixed'))
                      : null,
                    entry.manualUpdate === true
                      ? h('div', { className: 'dsh-ps-conflict' },
                          h('span', { className: 'dsh-ps-badge warn' }, t('manualUpdateBadge')),
                          ` ${t('manualUpdateHint')}`)
                      : null,
                    entry.conflict?.type === 'host-disagreement' && entry.remote?.variants?.length
                      ? h('div', { className: 'dsh-ps-variants' },
                          entry.remote.variants.map((variant) => h('span', {
                            className: 'dsh-ps-variant',
                            key: `${variant.hostId}:${variant.spec}`,
                          }, `${variant.hostId}: ${variant.version || variant.spec}`)))
                      : null,
                  )),
                ),
            removeCount > 0 ? h('div', { className: 'dsh-ps-alert' }, t('removeWarn')) : null,
            h('div', { className: 'dsh-ps-actions' },
              h('button', {
                type: 'button',
                className: removeCount > 0 ? 'dsh-ps-btn danger' : 'dsh-ps-btn primary',
                disabled: applying || selectedCount === 0,
                onClick: () => {
                  if (removeCount > 0 && confirmRemove !== preview.previewId) {
                    setConfirmRemove(preview.previewId)
                    return
                  }
                  setConfirmRemove(null)
                  void applyPreview()
                },
              }, applying
                ? t('applying')
                : removeCount > 0 && confirmRemove !== preview.previewId
                  ? t('applyWithRemove', { count: selectedCount, remove: removeCount })
                  : t('apply')),
              h('span', { className: 'dsh-ps-muted' }, `${selectedCount} / ${visibleEntries.length}`),
            ),
          ),
          applyResult === null ? null : h('div', { className: 'dsh-ps-result' },
            h('div', { className: applyResult.ok ? 'dsh-ps-ok' : 'dsh-ps-error' },
              applyResult.ok
                ? t('applyOk', { applied: applyResult.totalApplied, failed: 0 })
                : t('applyPartial', { failed: applyResult.failed.length })),
            applyResult.applied.length
              ? h('div', null,
                  h('div', { className: 'dsh-ps-label' }, t('appliedTitle')),
                  applyResult.applied.map((item) => h('div', { className: 'dsh-ps-meta', key: `a-${item.name}` },
                    `${item.name}`
                    + `${item.upgraded === true && item.replaced ? ` (${item.replaced} → ${item.version ?? ''})` : ''}`
                    + `${item.rollback === 'restored' ? ` — ${t('rollbackRestored')}` : ''}`
                    + `${item.restartRequired ? ` — ${t('restartRequired')}` : ''}`)),
                )
              : null,
            applyResult.removed?.length
              ? h('div', null,
                  h('div', { className: 'dsh-ps-label' }, t('removedTitle')),
                  applyResult.removed.map((item) => h('div', { className: 'dsh-ps-meta', key: `r-${item.name}` },
                    `${item.name}${item.restartRequired ? ` — ${t('restartRequired')}` : ''}`)),
                )
              : null,
            applyResult.failed.length
              ? h('div', null,
                  h('div', { className: 'dsh-ps-label' }, t('failedTitle')),
                  applyResult.failed.map((item) => h('div', { className: 'dsh-ps-error', key: `f-${item.name}` },
                    `${item.name}: ${item.error ?? item.message ?? ''}`)),
                )
              : null,
            manualItems.length > 0
              ? h('div', { className: 'dsh-ps-confirm' },
                  h('div', { className: 'dsh-ps-step-title' }, t('manualIntro')),
                  manualItems.map((item) => h('div', { className: 'dsh-ps-steps', key: `m-${item.name}` },
                    h('div', { className: 'dsh-ps-step' },
                      h('div', { className: 'dsh-ps-step-title' }, item.name)),
                    (item.manual?.steps ?? []).map((step, index) => h('div', { className: 'dsh-ps-step', key: `${item.name}-s${index}` },
                      h('div', { className: 'dsh-ps-step-title' }, `${index + 1}. ${step.title}`),
                      h('div', { className: 'dsh-ps-meta' }, step.detail),
                      step.command === undefined || step.command === ''
                        ? null
                        : h('code', { className: 'dsh-ps-cmd' }, step.command),
                    )),
                  )),
                  h('p', { className: 'dsh-ps-hint' }, t('manualNote')),
                )
              : null,
            applyResult.skipped.length
              ? h('div', null,
                  h('div', { className: 'dsh-ps-label' }, t('skippedTitle')),
                  applyResult.skipped.map((item) => h('div', { className: 'dsh-ps-meta', key: `s-${item.name}` },
                    `${item.name}: ${item.reason}`)),
                )
              : null,
          ),
        ),

        h('section', { className: 'dsh-ps-card' },
          h('div', { className: 'dsh-ps-head' },
            h('div', null,
              h('h3', { className: 'dsh-ps-title' }, t('pushTitle')),
              h('p', { className: 'dsh-ps-desc' }, t('pushHint')),
            ),
            h('span', { className: 'dsh-ps-muted' }, t('lastPush', { time: lastPush ?? t('never') })),
          ),
          pushResult === null ? null : h('div', { className: 'dsh-ps-ok' },
            pushResult.created === true
              ? t('pushCreated', { gistName: pushResult.gistName ?? effectiveGistName })
              : pushResult.status === 'pushed'
                ? t('pushPushed', { version: (pushResult.version ?? '').slice(0, 12) })
                : t('pushUnchanged')),
          confirmPush
            ? h('div', { className: 'dsh-ps-confirm' },
                h('span', { className: 'dsh-ps-desc' }, gistConfigured ? t('pushConfirm') : t('pushConfirmCreate')),
                h('div', { className: 'dsh-ps-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dsh-ps-btn danger',
                    disabled: pushing,
                    onClick: () => { void pushNow() },
                  }, pushing ? t('pushing') : t('pushConfirmButton')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-ps-btn',
                    disabled: pushing,
                    onClick: () => { setConfirmPush(false) },
                  }, t('pushCancel')),
                ),
              )
            : h('div', { className: 'dsh-ps-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-ps-btn',
                  disabled: pushing || token?.configured !== true || gistDirty,
                  onClick: () => { setConfirmPush(true) },
                }, pushing ? t('pushing') : (gistConfigured ? t('push') : t('pushCreating'))),
              ),
        ),

        h('section', { className: 'dsh-ps-card' },
          h('div', { className: 'dsh-ps-head' },
            h('div', null,
              h('h3', { className: 'dsh-ps-title' }, t('logTitle')),
              h('p', { className: 'dsh-ps-desc' }, t('installMethodTitle')),
            ),
            h('button', {
              type: 'button',
              className: 'dsh-ps-btn',
              onClick: () => { setShowLog((current) => !current) },
            }, showLog ? t('logHide') : t('logShow')),
          ),
          h('p', { className: 'dsh-ps-hint' }, t('installMethodValue')),
          h('p', { className: 'dsh-ps-hint' }, t('upgradeNote')),
          pendingUpgrades.length > 0
            ? h('div', { className: 'dsh-ps-alert' },
                h('div', null, t('pendingTitle')),
                h('div', { className: 'dsh-ps-meta' }, t('pendingBody')),
                pendingUpgrades.map((item) => h('div', { className: 'dsh-ps-meta', key: `p-${item.name}` },
                  `${item.name}: ${item.fromVersion || item.fromSpec} -> ${item.toSpec}`)),
              )
            : null,
          h('div', { className: 'dsh-ps-summary' },
            h('span', { className: `dsh-ps-badge ${job?.status === 'failed' ? 'error' : job?.status === 'done' ? 'ok' : ''}` },
              job === null ? t('logEmpty') : `${job.kind} · ${job.status}`),
            job?.progress?.total > 0
              ? h('span', { className: 'dsh-ps-badge' },
                  t('logProgress', { done: job.progress.done, total: job.progress.total }))
              : null,
          ),
          showLog
            ? h('div', { className: 'dsh-ps-log' },
                job === null || job.lines.length === 0
                  ? h('p', { className: 'dsh-ps-muted' }, t('logEmpty'))
                  : job.lines.map((line, index) => h('div', {
                      className: `dsh-ps-logline ${line.level === 'error' ? 'error' : line.level === 'warn' ? 'warn' : ''}`,
                      key: `${index}-${line.at}`,
                    }, `${line.at.slice(11, 19)}  ${line.message}`)),
              )
            : null,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-sync: dictionaries')
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-plugin-sync',
          locale: NS,
          inject: () => ({ t }),
        }, ConfigPage))
      },
    }
  },
})
