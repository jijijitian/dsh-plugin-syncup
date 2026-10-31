# dsh-plugin-sync

通过一个私有 **GitHub Gist** 在不同主机之间同步 DeepSeek Harness（DSH）的插件清单：

- 在 DSH 的 **插件页** 直接修改本插件配置；
- 第一次点击 **创建 Gist 并推送**，插件自动创建私有 Gist；
- 其他主机只需填写同一个 **Gist 名称**，不需要再建仓库；
- 点击 **拉取线上清单**，预览冲突和变更，再由你选择是否应用；
- 需要上传本机清单时，手动点击 **推送本机清单**。

> 2.0.0 起只做手动同步，不再启动自动同步、定时同步或插件变化自动同步。2.2.0 起清单存储从 GitHub 仓库改为私有 Gist。2.4.0 起按 **Gist 名称** 查找，默认名称 `dsh-plugin-sync`，不存在时首次推送自动创建。

## 当前版本与 DSH 兼容性

本版本面向 DSH `0.2.1-rc.3` 的插件页配置槽位：

- `plugins.bundle.config` — 在插件包详情页内嵌本插件的配置和同步面板。

插件本身没有 npm 运行时依赖。DSH 从 `0.2.1-rc.2` 升到 `0.2.1-rc.3` 后，旧版的 Host 工具和同步逻辑仍然可用，但旧版没有配置页面；2.x 补上了新页面的配置/预览/冲突处理。

## 安装

```text
plugin_manager action=install_bundle target=github:jijijitian/dsh-plugin-sync
```

安装后打开 **插件 → 已安装插件 → dsh-plugin-sync**，即可看到配置与手动同步面板。每台主机都需要先安装一次本插件；它不会自动安装自己。

> **从 1.x 升级或首次启用页面时请重启 DSH。** DSH 的 client-modules 会按 Loader 条目缓存包元数据直到进程重启；如果先安装过没有 `dsh.client` 的 1.0，再安装 2.x，页面不会立即出现配置面板，重启一次后才会扫描到新的客户端半。之后普通刷新页面即可。

## GitHub Token

Gist 需要 GitHub token：

- 经典 token 需要 **`gist`** scope；
- 当前 fine-grained token 对 Gist 的支持有限，建议使用 classic token；
- 在插件页的 **GitHub Token** 输入框填写即可，token 会保存到 DSH 的凭据服务，不写入插件配置文件；
- 首次填写时点击 **如何获取 Token**，会先显示所需权限和操作步骤，再提供 **打开 GitHub Token 页面** 的链接；链接已预填描述和 `gist` 权限；
- 如果已有环境变量 `GITHUB_TOKEN`，页面会显示“已配置”，可以留空不修改。

没有 token 时可以读取可访问的 Gist 并预览，但不能创建或推送。

## 使用

### 1. 第一台主机：创建 Gist

在插件页填写 **GitHub Token**，保持 **Gist 名称** 为默认的 `dsh-plugin-sync`，点击 **创建 Gist 并推送本机清单**。

插件会：

1. 创建一个 **secret Gist**（不是 public gist）；
2. 写入默认文件名 `dsh-plugins.json`；
3. 把本机可移植的 profile bundle 清单写入 `hosts.<hostId>`；
4. 把 Gist 名称和 ID 写入本机状态；
5. 在页面上显示 Gist 名称、ID 和 URL。

把 Gist 名称告诉其他主机即可（同一 GitHub 账号下会按名称查找）。

### 2. 其他主机：填写 Gist 名称

在 **Gist 名称** 中填写同一个名称（默认 `dsh-plugin-sync`），保存配置，然后点击 **拉取线上清单**。插件会用当前 token 搜索该账号下同名 Gist；找不到时，首次推送会自动创建。

不需要创建仓库，也不需要创建新的 Gist。

### 插件更新（第二个选项卡）

Gist 清单只知道“某台主机上次推送的版本”，会落后于真实发布版：例如清单里写 `dshmarket@1.70.2`，npm 上其实已经是 `1.73.3`。

**插件更新** 选项卡绕过清单，直接问包源：

| 来源 | 查询方式 |
| --- | --- |
| npm 包（`name` 或 `name@ver`） | `GET registry.npmjs.org/<name>` 的 `dist-tags.latest`；缺失时取 `versions` 里最大的版本号 |
| GitHub 源码（`github:owner/repo#ref`） | `GET api.github.com/repos/.../tags`，取最大的版本 tag；没有 tag 时退回默认分支 HEAD 的 commit SHA |

流程：

1. 点 **检查最新版本**：日志逐条实时输出，每查完一个插件立刻写一行，进度条同步前进；
2. 勾选要更新的插件（默认勾选全部可更新项），可用 **选中全部** / **清除选择**；
3. 点 **更新选中项**：按真实最新版本安装，走与同步相同的「探测 → 卸载 → 安装 → 回滚」保护。

`file:`、`link:`、`https://...tgz` 这类本地或打包来源无法查询，会标记为「无法查询」而不是猜一个版本。

> 实测：`dshmarket` 当前 1.70.2，清单给的是 1.71.1，本选项卡查到的真实最新是 **1.73.3**。

#### 进度与状态一致性

- **实时日志**：检查与更新都按「每个插件一行」写入，不再等全部结束才一次性输出；
- **进度条**：显示 `已处理 N/总数` 与当前插件名，进度由 Host 的 job 真实进度驱动；
- **离开页面再回来**：页面重新挂载时会读取 Host 的 `busy` 状态、当前 job 与上一次检查结果（`?cached=1`），恢复成实际状态；Host 仍在运行时会禁用按钮，不会因为误点而弹出「已有操作在运行」的报错。

### 手动更新步骤

HMR 无法卸载的插件（见上一节）不会自动升级，而是直接给出一段可复制的终端命令：

```
1. Quit DSH completely
2. cd "%USERPROFILE%\.dsh\profiles\desktop"
3. "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" ^
   "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" ^
   add dsh-mnemon@0.5.36
4. Start DSH again
```

要点：

- 命令里用的是 **DSH 自带的 node 与 pnpm**，不依赖系统 PATH，复制即可运行；
- 用 `pnpm add` 一步完成，不需要先 remove —— DSH 关闭后没有 HMR 竞争；
- profile 目录由 `DSH_HOME` + `DSH_PROFILE` 推导，也可用 `DSH_PROFILE_DIR` 覆盖；
- 失败项里带 `manual` 字段，`plugin_sync` 工具的 `apply` 结果也会把这些命令打印出来。

### 3. 预览、冲突与确认

点击 **拉取线上清单** 只读取 Gist，不安装任何东西。页面会显示：

- 线上主机数、插件记录数；
- 缺失、升级、降级、来源变更、启用、本机独有；
- 冲突数量、来源主机和每个条目的推荐选择。

默认冲突规则：

| 情况 | 默认处理 | 可选 |
| --- | --- | --- |
| 本机缺失，线上启用 | 安装线上版本 | 使用线上 / 跳过 |
| 本机版本较低 | 升级到线上版本 | 使用线上 / 保留本机 |
| 本机版本较高 | **保留本机**（不降级） | 保留本机 / 使用线上 / 跳过 |
| 版本相同但来源不同 | **保留本机**（避免来源突换） | 保留本机 / 使用线上 / 跳过 |
| 本机已安装但停用，线上启用 | **保持停用** | 启用 / 保持停用 |
| 多台线上主机版本或来源不一致 | 使用**最高版本** | 使用最高版本 / 保留本机 / 跳过 |
| 只有本机有 | **保留**（默认） | 保留本机 / **删除本机插件** |
| 线上已停用 | 不自动停用本机 | — |

只有选择 **使用线上版本** 或 **删除本机插件** 的条目会在点击 **应用同步** 时执行。预览快照保留 10 分钟，过期后重新拉取。

删除是不可逆操作：会调用官方 `ctx.pluginManager.removeBundle()` 卸载包并移除 profile 中的选择，重启后生效。因此选中删除后，应用按钮会变成危险色并要求二次确认。由 DSH 安装提供、不可移除的插件只显示“保留”。

### 4. 应用同步

点击 **应用同步** 后，Host 会：

- 对安装/升级/来源变更条目调用官方 `ctx.pluginManager.installBundle()`；
- 对启用条目调用 `ctx.pluginManager.setBundleEnabled()`；
- 对选择删除的本机独有条目调用官方 `ctx.pluginManager.removeBundle()`；
- 不自动禁用或删除你没选择的插件；
- 最多处理 `maxInstallsPerRun` 项。

可能出现 `restart-required`，按 DSH 提示重启宿主。

### 升级已安装插件（重要）

dsh 0.2.1 的插件管理器在存在 `hmr` 服务时，只要包已经在 profile 的 `dependencies` 里，`installBundle` 就一律返回 `already-installed`（源码守卫在 `dsh-plugin-manager` 内部）。也就是说**没有原地升级**这条路，插件页和 dshmarket 都是用「先卸载、再安装」绕过去的。

本插件采用同样的两步，但加了三层保护（`bundle-in-use` 的教训在这里）：

**① 先探测，不盲目删除。** `removeBundle()` 的执行顺序是「先取消选择写盘 → 再尝试热重挂 → 最后检查是否仍在运行」，所以它一旦以 `bundle-in-use` 失败，插件就已经被从 `dsh.profile.bundles` 里移除了 —— 表现为**装了但不生效**，重启也回不来。因此升级前先调用 `setBundleEnabled(name,false)` 探测：

- 若管理器返回 `restart-required`，或插件仍是 `enabled` 状态 → 判定 HMR 无法卸载，**直接放弃，不执行删除**；
- 只有确认已卸载，才继续走删除。

**② 任何删除失败都立刻恢复选中。** 删除被拒后调用 `setBundleEnabled(name,true)` 把插件放回 profile，保证失败不会留下“装但停用”的状态。

**③ 记住哪些插件只能手动更新。** 探测失败的插件写入 `state.manualUpdates`，之后：

- 预览里该行显示 **需手动更新** 徽标与原因；
- 再次同步时直接跳过，不再尝试删除（不会重复折腾）。

完整流程：

1. 先照常安装；若返回 `already-installed`，记录当前已装版本；
2. 若在 `manualUpdates` 里 → 直接跳过；
3. 探测：`setBundleEnabled(false)`，并回读确认是否真的卸下；
4. 探测失败 → 恢复选中 + 记入 `manualUpdates`，本次判失败并给出原因；
5. 探测成功 → 写 `pendingUpgrades` → `removeBundle()` → `installBundle()`；
6. 删除失败 → 恢复选中（`bundle-in-use` 同时记入 `manualUpdates`）；
7. 新版装不上 → 用旧 spec 装回，日志提示“已回滚到旧版本”；
8. 成功或回滚后清除 `pendingUpgrades`；成功时清除 `manualUpdates`。

如果进程在第 5 步中途被中断，页面顶部会显示 **上次升级未完成**，列出插件名与涉及版本。

两个例外：

- **本插件不会升级或删除自己**（删除会卸载正在运行的代码）。遇到自己的升级项会直接标记失败并提示去插件页更新。
- 由 DSH 安装提供、`removable: false` 的插件只显示「保留」。

> 实测：`dsh-mnemon` 在这台机器上就属于“HMR 无法卸载”的类型。现在的表现是探测阶段即停手，插件**保持启用**，状态文件记入 `manualUpdates`，再次同步直接跳过 —— 不会再出现被静默停用的情况。

### 错误信息

插件管理器的拒绝大多只带 `code`、没有 `message`。现在所有失败都会翻译成可读句子，例如：

| code | 页面显示 |
| --- | --- |
| `already-installed` | 该包已在此 profile 中；升级需要先卸载再安装 |
| `incompatible-version` | 该包要求的 DSH 版本与当前宿主不同 |
| `not-bundle` | 该包没有 bundle patch，无法启用 |
| `management-required` | 该 bundle 由 DSH 安装管理，无法从 profile 修改 |
| `bundle-in-use` | HMR 无法在运行中卸载该插件；已保持其启用状态 |

不会再出现 `[object Object]`。

### 安装方式与日志

同步时的安装/删除都走 **DSH 官方插件管理器**（`ctx.pluginManager`），底层与插件页安装完全相同：由 DSH 自带的 pnpm 在 profile 目录执行，并写入 `package.json` / `pnpm-lock.yaml`。本插件不自己调用 pnpm，也不复制包。

页面底部新增 **安装日志** 面板：

- 显示当前任务类型（preview / apply / push）、状态与进度（`已完成/总数`）；
- 逐条记录每个插件的动作与结果，例如 `installing dsh-context@0.77.0`、`dsh-context: installed`、`dsh-orphan: removed`、`dsh-extra: already installed; replacing 1.0.0 with 2.0.0`；
- 失败与告警用不同颜色标出，便于定位是哪一项出错；
- 任务运行期间自动刷新，结束后保留最后一次结果。

同一份日志也可以通过 `plugin_sync` 工具的 `log` 动作读取。

### 5. 推送本机清单

点击 **推送本机清单** 后，插件会先读取 Gist、算出「线上 vs 线下」的差异，**这一步不写任何东西**；确认后才更新清单文件。

差异分三类，默认规则如下：

| 情况 | 默认处理 | 可选 |
| --- | --- | --- |
| **线上、线下都有**（版本或来源不同） | **保留最新版本**（比较版本号，平手时保留本机来源） | 取较新版本 / 保留本机 / 保留线上 |
| **线上有、线下没有** | **保留在清单中** | 保留在清单 / 从清单移除 |
| **线下有、线上没有** | **直接推送**，不需选择 | — |

- 完全一致的条目会折叠，不占篇幅；
- 选择「从清单移除」会把该插件从**所有**主机的记录里删掉，其他主机的同一插件也随之消失，请谨慎；
- 推送前后都会重新读取 Gist，若期间有别的机器推过，会基于最新内容重新生成差异再写入（最多重试 3 次）；
- 同一主机重新推送只覆盖自己的 `hosts.<hostId>` 记录。

内容没有变化时不会更新 Gist。GitHub 的 Gist 更新接口不接受 `If-Match` 等条件请求头，发送它会返回 `400 Bad Request`，所以并发保护靠「读版本 → 比较 → 重新合并重试」。

## 配置项

插件页只保留两个输入：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `Gist 名称` | `dsh-plugin-sync` | 默认读取该名称；可自行修改。首次推送找不到时自动创建。同一 GitHub 账号的其他主机填写相同名称 |
| `GitHub Token` | — | 仅写入 DSH 凭据服务；已配置时可留空 |

其余参数使用固定默认值，不再要求填写：

- 文件名：`dsh-plugins.json`
- 描述：`DSH plugin inventory`
- 主机标识：主机名
- 单次最多安装：20
- GitHub API：`https://api.github.com`

如果从旧版本保留了隐藏字段（文件名、主机标识等），保存配置时会继续保留；页面不再展示。

## 清单格式

仍然是原来的主机清单，只是存储在 Gist 文件里：

```json
{
  "schemaVersion": 1,
  "generatedBy": "dsh-plugin-sync",
  "updatedAt": "2026-10-26T00:00:00.000Z",
  "lastWriter": "work-pc",
  "hosts": {
    "work-pc": {
      "hostId": "work-pc",
      "updatedAt": "2026-10-26T00:00:00.000Z",
      "dshVersion": "0.2.1-rc.3",
      "profile": "desktop",
      "platform": "win32",
      "bundles": [
        {
          "name": "dsh-context",
          "spec": "dsh-context@0.74.0",
          "version": "0.74.0",
          "enabled": true
        }
      ]
    }
  }
}
```

## 从 2.1 的仓库配置迁移

2.2.0 不再读取 `repo` / `branch` / `path`。已有配置里的这些字段在保存配置时会被移除，界面改为 Gist。迁移步骤：

1. 更新插件并重启 DSH；
2. 在插件页填写 token 来源；
3. 保持默认名称 `dsh-plugin-sync`，或填写已有 Gist 的名称，点击 **创建 Gist 并推送**；
4. 其他主机填写同一个 Gist 名称。

## 安全边界

- Gist 是 **secret**，但仍然是通过 URL 可访问的；不要把 Gist URL 和 token 一起公开。
- 远端清单是可信输入：它决定安装哪些 npm/GitHub 包，等同于执行第三方代码。请保护 Gist 和 token。
- 只接受可移植 spec，拒绝本机路径、`file:`、`link:`、`workspace:`、盘符路径和包含 `..` 的路径。
- Token 不写入清单、Gist 或插件配置文件；页面输入会写入 DSH 凭据服务。
- 配置 API 只允许修改 Gist 名称，以及把 Token 写入凭据服务；不允许通过页面改 `apiBaseUrl`/token 本体。
- 只安装用户选择的条目；不自动卸载、禁用或降级本机已有插件。
- 不执行自动同步：没有启动同步、定时器或插件变化监听。

## 开发与验证

```bash
node --test
```

测试覆盖：

- Gist 读取、创建、更新、ETag 冲突、缺失 Gist、截断内容回退；
- 清单规范化、主机合并、版本选择、主机冲突变体；
- 安装/升级/降级/来源变更/启用/本机独有的预览分类；
- 配置读取、保存、token 隐藏、Gist 名称规范化；
- 预览后按选择安装、默认选择安装、无 token 只读同步；
- 推送、内容不变跳过、非法远端 JSON 不覆盖；
- 本机独有插件的删除流程、不可移除插件的选项收敛；
- 任务日志的进度、逐条消息与终态；
- 已安装插件的卸载后重装升级、失败回滚、self-update 拦截；
- HMR 无法卸载时的探测中止、选中恢复、手动更新记录与重复跳过；
- 只有 code 没有 message 的拒绝被翻译成可读文本；
- 工具结果渲染和客户端注册。

## 已知边界

- 只同步 bundle 的安装清单，不迁移插件配置、模型或凭据。
- 只处理有 bundle patch 的插件；纯依赖不会成为清单条目。
- 预览快照只保存在 Host 内存中，插件重载或 10 分钟后失效。
- Gist API 没有仓库 Contents API 的强原子更新；本插件用 ETag/版本检查降低并发覆盖窗口，但仍建议各主机避免同时推送。
- 安装依赖 DSH 的 pnpm 路径；缺失时结果会给出 `pnpm-missing`。
- 删除同样依赖 DSH 的 pnpm 路径；失败会记录在日志与结果里，插件保持原状。
- 日志只保存在 Host 内存（最近 10 个任务、每个最多 400 行），插件重载后清空。
- 只有本机有、且标记为可移除的插件才会出现“删除”选项。
