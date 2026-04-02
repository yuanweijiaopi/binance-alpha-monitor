---
description: 分析暂存区变更，自动生成符合 Conventional Commits 规范的提交信息并执行 git commit
---

// turbo-all

## 执行步骤

1. 运行以下命令获取当前 git 状态和暂存区变更：
```bash
git status && git diff --staged
```

2. 根据变更内容，按照 **Conventional Commits** 规范生成 commit message：
   - 格式：`<type>(<scope>): <subject>`
   - type 选项：`feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
   - subject 使用**中文**描述，简洁明了，不超过 50 字
   - 如有必要，添加 body 说明（空行分隔）

3. 展示给用户确认生成的 commit message，然后执行：
```bash
git commit -m "<生成的 commit message>"
```

4. 输出 commit 结果，显示提交的文件数和 commit hash

## 注意事项
- 如果暂存区为空（nothing to commit），提示用户先执行 `git add`
- 如果有未暂存的变更，询问是否一并暂存（`git add -A`）
- commit message 的 scope 根据变更的文件路径自动推断
