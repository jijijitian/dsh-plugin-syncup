# 发布流程（npm + GitHub Release 双渠道）

本文件是**唯一**的发布依据。发布前从头到尾读一遍，逐项打勾，不要凭记忆。

---

## 铁律

> **每次发布，npm 和 GitHub Release 必须同时做，两处版本号必须完全一致（`4.4.0` ↔ `v4.4.0`）。**

只有一处的发布**不算发布**，而且会造成实际故障：

- 只有 tag 没有 Release：其他主机按「Release 优先」规则检测更新时，看不到新版本，会**一直提示已是最新**。v4.0.0～v4.4.0 就这样漏了 5 个 Release（2026-11-10 补齐）。
- 只有 Release 没有 npm：从 npm 安装的机器永远拿不到修复，只有源码安装的能拿到。
- 两处版本号不一致：检测逻辑要拿 npm 与 GitHub 两个版本比较，会出现「永远差一个版本」的假更新提示。

`v` 前缀只属于 git tag / Release 名，npm 版本号不带 `v`。

---

## 完整检查清单

按顺序执行，前一步不通过就不要进入下一步。

### 1. 改版本号

```bash
cd <repo checkout>   # the directory holding this package.json
# 编辑 package.json 的 "version"
node -e "console.log(require('./package.json').version)"
```

- 先确认这个版本号在 npm 上**还没有被占用**（见「坑 2」）：

```bash
node "$PNPM" view dsh-plugin-syncup versions --json
```

- 版本号必须比 registry 上现有的所有版本都大（semver 不允许重发同号）。

### 2. 跑测试

```bash
export PATH="<dsh home>/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
node --test
```

要求 **fail 0**。当前基线：v4.4.0 为 130 个用例。用例数只增不减；如果比上一个 tag 少了，先查清楚是不是测试被误删。

### 3. commit + tag + push

```bash
git add -A
git commit -m "chore: release X.Y.Z"
git tag -a vX.Y.Z -m "dsh-plugin-syncup X.Y.Z"
git push origin main
git push origin vX.Y.Z
```

- tag 必须是**附注 tag**（`-a`），与历史一致；
- 先推 `main` 再推 tag，避免 tag 指向还没上线的提交；
- `git tag` 一旦推上去就不要移动或删除 —— 别人可能已经拉了。

确认远程真的收到了：

```bash
git ls-remote --tags origin | grep "vX.Y.Z"
```

### 4. pnpm pack，并校验 tarball 内容

**打出来的 tarball 才是要发布的东西**，源码目录不是。发布前必须亲眼看一眼包里有什么：

```bash
export PNPM="<dsh home>/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
node "$PNPM" pack --pack-destination "$(cygpath -w /tmp)"

# 列出内容并核对
tar tzf /tmp/dsh-plugin-syncup-X.Y.Z.tgz | sort
```

必须**恰好 23 个文件**，与 `package.json` 的 `files` 白名单一致：

```text
package/LICENSE
package/README.en.md
package/README.md
package/client.js
package/cordis.patch.yml
package/icon.svg
package/index.js
package/lib/{config,errors,github,http,jobs,manifest,manual,preview,pushplan,spec,state,sync,versions}.js
package/locale/{en,zh}.json
package/package.json
```

逐项确认：

- [ ] 没有 `test/`、没有 `.git*`、没有 `.npmrc`（**凭据文件绝不能进包**）、没有 `node_modules/`、没有 `*.tgz`
- [ ] `lib/` 下 13 个文件齐全（少一个就是运行时 `ERR_MODULE_NOT_FOUND`）
- [ ] `locale/` 的中英字典都在
- [ ] 解包后 `package/package.json` 里的 `version` 就是要发的版本
- [ ] 改动确实进了包：`tar xzOf /tmp/dsh-plugin-syncup-X.Y.Z.tgz package/index.js | grep <本次关键字>`

`files` 白名单变了的时候，本节的 23 这个数字也要一起改。

### 5. 发布到 npm

```bash
cd /tmp && rm -rf pkgcheck && mkdir pkgcheck && tar xzf dsh-plugin-syncup-X.Y.Z.tgz -C pkgcheck
cd pkgcheck/package
node "$PNPM" publish --access public --no-git-checks
```

- `--no-git-checks`：`pnpm publish` 默认要求当前在 `main`/`master` 分支且工作区干净。在 detached HEAD、临时解包目录或 CI 里会报 `ERR_PNPM_GIT_UNKNOWN_BRANCH`。**从解包目录发布是最稳的**——发的一定是第 4 步验过的那份 tarball，而不是工作区当前状态。
- 先 `--dry-run` 演练一遍：`node "$PNPM" publish --dry-run --access public --no-git-checks`

### 6. **从注册表拉回校验**（不可跳过）

第 5 步打印的 `✅ Published` **不能作为发布成功的证据**（见「坑 1」）。必须换一个方向验证：从 registry 下载回来，看是不是你要的东西。

```bash
# 6.1 版本必须出现
node "$PNPM" view dsh-plugin-syncup versions --json

# 6.2 dist-tag 必须指向新版本（这一条最容易漏，见「坑 4」）
curl -s https://registry.npmjs.org/dsh-plugin-syncup | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)['dist-tags']))"

# 6.3 拉回 tarball，与本地 pack 的结果逐文件比对
cd /tmp && curl -s -o back-X.Y.Z.tgz https://registry.npmjs.org/dsh-plugin-syncup/-/dsh-plugin-syncup-X.Y.Z.tgz
rm -rf back && mkdir back && tar xzf back-X.Y.Z.tgz -C back

# 逐个文件的 sha256 对比（除 package.json 外应全部一致）
diff -rq back/package pkgcheck/package
```

必须满足：

- [ ] `versions` 列表里有 `X.Y.Z`
- [ ] `dist-tags.latest` 就是 `X.Y.Z`
- [ ] 拉回解包后的 23 个文件与第 4 步 sha256 一致
- [ ] **拉回的 `index.js` 里确实有本次改动**（`grep` 关键字）。这一条专治「版本号对了但内容是旧的」

任何一条不满足 → **不要建 Release**，先回滚处理（见文末）。

### 7. 创建 GitHub Release

```bash
export GH="/c/Program Files/GitHub CLI/gh.exe"
"$GH" release create vX.Y.Z --repo jijijitian/dsh-plugin-syncup \
  --verify-tag \
  --title "vX.Y.Z — 一句话说清这个版本改了什么" \
  --notes-file /tmp/notes-vX.Y.Z.md
```

- `--verify-tag`：**必须加**。tag 已经在第 3 步推过了，不加这个参数 gh 可能试图新建/移动 tag，导致 tag 与 Release 指向不同提交。加了之后 tag 不存在会直接失败退出，这是好事。
- 标题格式沿用历史：`vX.Y.Z — 中文一句话摘要`。
- 说明按**实际提交**撰写，不要编造功能。取材来源：

```bash
git log --oneline v上一个版本..vX.Y.Z     # 有哪些提交
git show vX.Y.Z --stat                    # 改了哪些文件
git show vX.Y.Z --format='' -- <文件>      # 具体改了什么
```

- 结构参考已有 Release（`"$GH" release view v3.4.2 --repo jijijitian/dsh-plugin-syncup`）：**现象 → 根因 → 修复 → 验证**，末尾附完整改动 commit hash。
- 如果某个版本的提交只是版本号推进（内容与上个版本相同），**如实写**，不要为了好看编出功能。

### 8. 收尾核对

```bash
"$GH" release list --repo jijijitian/dsh-plugin-syncup --limit 5
"$GH" release view vX.Y.Z --repo jijijitian/dsh-plugin-syncup --json tagName,isDraft,isPrerelease,name
```

- [ ] Release 存在、`isDraft=false`、`isPrerelease=false`
- [ ] 最新版本显示 `Latest` 标记
- [ ] tag 指向的提交与 `main` 一致，且 **tag 的 sha 没有被 `release create` 改动**

---

## 已知坑（血泪教训）

### 坑 1：`pnpm publish` 的「✅ Published」是假成功

`pnpm publish` 可能走 npm 的**暂存（staged）**流程：包被推入 staging，命令打印 `✅ Published` 并**返回 0**，但 `registry.npmjs.org` 上根本没有这个版本。

证据只看命令输出是不够的。**唯一可信的验证是第 6 步：从注册表按版本号拉回 tarball 并解包检查。**

如果第 6 步 404 或版本不存在，说明卡在暂存里：去 npm 网页端该包的 **Staged** 页面手动确认「Approve」，否则这个版本号会一直被占着（见坑 2）。**在确认上架之前，不要建 Release。**

### 坑 2：版本号被孤儿暂存占用（409）

报错形如：

```text
409 Cannot publish over previously staged version
```

原因：之前某次 publish 进了暂存但从未审批，这个版本号就**既不存在于 registry、也无法再发**——它成了孤儿。注意：**卡在暂存里的版本号，`pnpm view` 有时照样能看到**（本仓库 `4.1.1`/`4.1.2` 就是列表里可见但内容是旧的），所以「能在列表里看到」不能当作「上架成功」。真正的判据只能是第 6.3 步拉回 tarball 比对内容。

处理：

1. 去 npm 网页端的 Staged 列表，能 Approve 就 Approve，能 Discard 就 Discard；
2. 处理不了 / 不想纠缠——**直接换一个版本号**。跳过被占的号比抢救它快得多。

本仓库的真实后果：`4.1.1`、`4.1.2` 两个号就是这样被消耗掉的，实际发上去的 tarball 内容是 `4.1.0` 的代码（不含工具注册守卫）。守卫最终是随 `4.2.0` 才真正上架的，于是不得不再补一个 `4.3.0`。**一次假成功，赔进去两个版本号。**

### 坑 3：直接 PUT registry 的 202 不是成功

```text
PUT https://registry.npmjs.org/<pkg>  →  202 Accepted
```

`202` 表示**进入了暂存队列**，不是已发布。它可能：

- 过一会儿自动上架（此时 `dist-tags` 才会更新）；
- 永远停在暂存里等人审批。

**不要在拿到 202 之后就去建 Release。** 等 `pnpm view` / `curl registry` 能看到该版本、且 `dist-tags.latest` 指向它，再做第 7 步。轮询几秒钟没有变化不是「慢」，是「没上架」。

### 坑 4：版本存在 ≠ `latest` 指向它

`npm publish` 只在 `--tag` 指定或默认情况下才更新 `dist-tags.latest`；一旦发布过程中断、或在暂存/审批流程里被修补过，就会出现「版本在列表里，但 `latest` 还停在旧版本」。

其它机器执行 `install_bundle target=dsh-plugin-syncup`（不写版本号）时拿的是 **`latest`**，不是最高的版本号。**版本存在而 `latest` 落后，等于用户装到旧代码。**

所以第 6.2 步的 `dist-tags` 检查是强制项。发现落后就修：

```bash
node "$PNPM" dist-tag add dsh-plugin-syncup@X.Y.Z latest
```

### 坑 5：只有 tag、没有 Release

v4.0.0～v4.4.0 五个版本都只推了 tag 没建 Release，`gh release list` 最新停在 v3.4.2。后果：插件自己的更新检测以 Release 为准，于是这几个版本对所有用户**不可见**，界面显示「已是最新」。

打完 tag 不等于发布完成。第 7 步不是可选项。事后补建时**必须加 `--verify-tag`**，否则会得到与已有 tag 不一致的新 tag。

### 坑 6：`pnpm publish` 的 git 检查在非常规环境里直接失败

`ERR_PNPM_GIT_UNKNOWN_BRANCH`：detached HEAD（比如从 tag 检出的 worktree）、临时解包目录、CI 环境都会触发。

**不要**为此把 `git-checks` 写进仓库配置关掉——那会让「发布内容和 tag 对不上」失去最后一层保护。正确做法是第 5 步那样：在**解包目录**里发，并显式加 `--no-git-checks`。发的是验过的 tarball，git 状态无关紧要。

---

## 版本台账

发布时维护，用于事后核对（这张表救过一次命 —— 就是靠它发现 `4.1.1`/`4.1.2` 是空占位）。

| npm 版本 | git tag | 是否上架 | 备注 |
| --- | --- | --- | --- |
| `0.0.0-stage` | — | 是（stub） | 占位包，2 个文件 |
| `4.0.0` | `v4.0.0` | 是 | 包改名 `dsh-plugin-syncup` |
| `4.1.0` | `v4.1.0` | 是 | 管理器更新路径；**内容与 4.0.0 不同，正常** |
| `4.1.1` | `v4.1.1` | 是（内容错误） | 发出的是 4.1.0 的代码，**不含注册守卫** |
| `4.1.2` | 无 | 是（内容错误） | 无对应 tag，内容同 4.1.0 |
| `4.2.0` | 无 | 是 | 守卫真正上架的第一个版本（与 v4.1.1 源码一致） |
| `4.3.0` | `v4.3.0` | 是 | 内容同 4.2.0；tag 提交仅改版本号 |
| `4.4.0` | `v4.4.0` | 是 | 缓存锁修复；**当前 `latest`** |
| `4.4.1` | 无 | 是 | 内容同 4.4.0（仅版本号）；**`latest` 曾指向它，2026-11-10 已回退到 `4.4.0`** |

**实测校验（2026-11-10，逐个解包 registry tarball 核对特征代码）：**

| npm 版本 | 工具注册守卫 | endpoint 查询串修复 |
| --- | --- | --- |
| `4.1.0` / `4.1.1` / `4.1.2` | 否 | 否 |
| `4.2.0` / `4.3.0` | **是** | 否 |
| `4.4.0` | **是** | **是** |

结论：**从 npm 安装至少要 `4.2.0` 才能避免工具重名故障；要拿到「检查后不显示更新选项」的修复，至少要 `4.4.0`。**

### 从这张表得到的教训

**npm 上有版本号、有 tarball，都不代表那是正确的代码。** `4.1.1` 有版本、有 tarball、能安装，内容却是上一个版本的——只有把 tarball 拉回来解包逐字节比对 tag 才能发现。这正是第 6 步存在的理由。

---

## 失败处理

一旦第 6 步没通过（版本没上架 / 内容是旧的 / `latest` 不指向它）：

1. **不要建 Release。** 没有 Release 的 tag 只是不可见的 tag，代价远小于发一个指向错误内容的 Release。
2. **不要重发同一个版本号。** npm 不允许覆盖已发布版本；卡在暂存的号也发不进去。
3. 修好问题后**升版本号**重来（`X.Y.Z` → `X.Y.(Z+1)`），并在本文件「版本台账」里记下被消耗掉的号。
4. 已经发错的版本，用 `npm deprecate` 标记而不是删除：

```bash
node "$PNPM" deprecate dsh-plugin-syncup@X.Y.Z "内容有误，请安装 X.Y.Z+1"
```

`unpublish` 会破坏已经锁定的下游 lockfile，非安全事件不要用。
