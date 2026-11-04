# dsh-session-groups — 项目开发与发布规则

本文件只适用于本仓库；与全局 `~/.dsh/AGENTS.md` 或外层工作区规则冲突时，以本文件为准。

## 1. 分支模型：dev 集成，main 只发布

```text
dev              开发集成主分支；日常所有工作从这里开始
main             发布分支；只接收经过验收的 dev 环形合并，不直接开发
feature/<slug>   本地临时开发分支；每个问题/需求一条
hotfix/<slug>    线上修复分支；从 main 切出
```

硬规则：

- **不再把 dev 和 main 做日常全量同步**；main 的每一次前进都必须对应一次发布或热修复。
- main 不直接提交功能、文档或测试改动。
- feature/hotfix 合并必须使用 `--no-ff`，保留环形合并边界。
- 本地临时分支默认不推送；需要协作或备份时再单独说明并推送。
- 合并前分支上必须完成对应验证；CI 绿灯是前置条件，不是验收结论。

## 2. 日常开发：feature → dev

```bash
git switch dev
git switch -c feature/<slug>

# 开发、补测试、更新文档
npm test
npm run build

git switch dev
git merge --no-ff feature/<slug> -m "merge: <简述> (feature/<slug>)"
# 可选，仅需要归档边界时：
git tag -a archive/feature/<slug> -m "archive feature/<slug>" feature/<slug>
git branch -d feature/<slug>
```

要求：

- 每个问题/需求一个分支，不把无关改动塞进同一批。
- 合并前至少运行受影响测试；UI/设置/拖拽类改动还必须跑对应 A+ 回归。
- 功能分支合并后删除；归档 tag 默认留本地，除非用户明确要求推送。
- 不为了“同步”把 main 合回 dev；只有在 main 产生热修复时，才按热修复流程回收。

## 3. 发布：dev → main → tag

只有用户明确宣布“这一批可以发布”时才进入本流程。

### 3.1 在 dev 上准备

1. 更新版本号，四处保持一致：
   - `package.json`
   - `dsh.plugin.json`
   - `src/shared/constants.js`
   - 当前文档中的版本引用
2. 更新 `CHANGELOG.md`。
3. 新建或更新 `docs/release-notes/v<version>.md`。
4. 运行：
   ```bash
   npm test
   npm run build
   node --check lib/client.js
   npm run check:coverage
   npm pack --dry-run
   ```
5. UI/行为改动必须有用户本地验收或对应 A+ 证据。

### 3.2 环形合并到 main

```bash
git switch main
git merge --no-ff dev -m "release: v<version>"
git tag -a v<version> -m "dsh-session-groups <version>"
```

确认 `main` 上只有发布边界，随后按用户授权推送：

```bash
git push origin main
git push origin v<version>
```

tag 推送会触发 `.github/workflows/release.yml`，由 GitHub Actions 构建 tgz 并创建 prerelease。普通 `push` 不触发发版。

### 3.3 发布后

- main 停在发布点，不跟随 dev 前进。
- dev 从当前发布点继续接收下一个 feature；main 与 dev 暂时分叉是正常状态。
- 不在每次提交后把 dev 全量合回 main。

## 4. 热修复：main → hotfix → main → dev

```bash
git switch main
git switch -c hotfix/<slug>
# 修复 + 测试
git switch main
git merge --no-ff hotfix/<slug> -m "hotfix: <简述>"
git tag -a v<version> -m "dsh-session-groups <version>"
git push origin main v<version>

# 把这次修复回收进 dev，避免下一次发布丢失
git switch dev
git merge --no-ff main -m "merge: hotfix v<version> back to dev"
```

热修复也必须有独立 tag 和 release；不能只改 main 不回收 dev。

## 5. CI / Release 边界

- `.github/workflows/ci.yml`：只检查 dev push / PR，不发布、不 bump 版本。
- `.github/workflows/release.yml`：只监听 `v*` tag；tag 才构建并创建 GitHub Release。
- CI 不自动决定版本号；版本号由发布准备阶段人工写入并验证。
- release notes 文件名必须与 tag 对应；发布前检查 workflow 引用的 notes 路径。
- 当前 repo 若仍是 `main` 为 GitHub 默认分支，建议在仓库设置中把默认分支改为 `dev`；main 保持发布视图。

## 6. 当前基线

- 最新发布：`0.3.0-beta.68`
- main / dev：以 `git log --oneline -1` 为准，发布后允许分叉
- 下一次开发从 `dev` 开新 feature 分支，不再从 main 拉功能分支
