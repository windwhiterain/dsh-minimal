# dsh-minimal

[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)「极简模式」（`minimal` agent preset）的组件库，给 comrade-harness 的子 harness 用。

**为什么拉过来**：社区发现 DeepSeek v4 正式版模型对这份 system prompt 存在过拟合——在这句 role 上性能有巨大提升。极简模式的做法就是把其他一切废话删掉，只留一句：

> You are a helpful software engineer assistant.

配套只有两个工具：持久 `bash` + `str_replace_editor`。模型可见的一切（描述、参数 schema、错误消息、退出码格式）逐字对齐上游。

## 接入（core 的 src/index.ts，两行）

```ts
import { minimalTools, PERSONA_TEXT } from "dsh-minimal";

const system = PERSONA_TEXT;                                    // system prompt = 极简一句（完整 persona，不拼其他段落）
const tools = [...minimalTools({ cwd: process.env.CORE_DIR })]; // 工具包：bash + str_replace_editor
```

> ⚠️ 极简模式的消费方（comrade-harness-dsh-minimal core）**只准这样接**：不拼 `buildSystemPrompt`（harness 契约）、不拼 `toolsCore()`——它们的文本对模型也是"别的 prompt"，会破坏 DeepSeek v4 对这句 role 的过拟合。工具用法由 schema 描述自带，不需要 system prompt 教。

- `minimalTools()` 返回两个 `ToolPackage`：`dsh-minimal-bash`（持久 bash）+ `dsh-minimal-editor`（str_replace_editor）；也可单独 `bashPackage()` / `editorPackage()`。
- 与 lib 的 `ToolPackage` 结构兼容，`runTools` 直接消费；`exec(name, rawArgs)` 收原始 JSON 字符串，错误转成 result 文本。
- 只想要 role 或只想要工具，自由组合——组合是流的一行代码，不是包的义务。
- `buildPersona(text?)` 与 lib 的 `buildSystemPrompt(coreId, immutable)` 不撞名；想改身份就传 text。

## 依赖

本地开发（未发布前）：`cd dsh-minimal && bun link`，core 的 dependencies 加 `"dsh-minimal": "link:dsh-minimal"`。
已发布：core 提交 `"dsh-minimal": "github:windwhiterain/dsh-minimal#v0.1.0"`，任何机器 clone 后 `bun install` 直接拉 GitHub。

## 说明

- bash 是**管道后端**（非交互 bash），不是上游的 node-pty PTY：零原生依赖、Windows/Git Bash 直接可用、marker 协议在管道下更可靠；代价是无 tty 的命令（vim/less 等）不可用。想换回 PTY：实现 `TerminalHandle` 接口即可。
- 无沙箱：`cwd` 只是解析基准不是边界，信任模型 = 谁调用谁负责（上游由宿主 sandboxPolicy 决定）。

## 开发

```bash
bun run typecheck    # tsc --noEmit
bun run demo         # 库消费形态演示（exec 走 runTools 同款路径）
```
