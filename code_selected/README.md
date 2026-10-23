# Code Selected (Claude / Codex)

将 VS Code 编辑器中选中的代码直接发送到已经打开的 Claude Code CLI 或 Codex CLI 终端。

## 前置条件

- VS Code 1.85 或更高版本，扩展安装在 WSL / Linux 侧。
- 已在 VS Code 集成终端中启动 Claude CLI 或 Codex CLI，并且它正在等待输入。

## 选择 CLI

通过 `codeSelected.cli` 选择目标 CLI，默认为 `claude`。修改后立即生效，不需要重新加载窗口。

| 功能 | `claude`（默认） | `codex` |
|---|---|---|
| 编辑器右键菜单 | `Claude: 发送选中代码到 CLI（带/不带前缀）` | `Codex: 发送选中代码到 CLI（带/不带前缀）` |
| 编辑器快捷键 | `Ctrl+Alt+L` | `Ctrl+Alt+C` |
| 发送内容 | `@路径#L行号` 引用 | 路径:行号 或原始代码 |
| 终端 `Ctrl+V` | VS Code 原生粘贴 | 终端智能粘贴（支持图片） |

命令面板也只显示当前 CLI 对应的命令。

```json
{
  "codeSelected.cli": "codex"
}
```

## Claude 模式

1. 在 VS Code 集成终端中启动 Claude CLI：

   ```bash
   claude
   ```

2. 回到编辑器，把光标放到目标行，或选择一段跨多行的代码。
3. 按 `Ctrl+Alt+L`，或右键选择以下任一命令：
   - `Claude: 发送选中代码到 CLI（带前缀）`
   - `Claude: 发送选中代码到 CLI（不带前缀）`
4. 扩展以 Claude 的 `@` 引用格式发送工作区相对路径和行号，Claude CLI 会自动附带对应行的代码：
   - 选区没有跨行时发送光标所在行，例如 `@src/foo.c#L141`。
   - 选区跨多行时发送行号范围，例如 `@src/foo.c#L10-20`。选区结束在某行第 0 列时（例如用 `Shift+↓` 整行选中），不包含该行。
   - 引用末尾带一个空格，方便接着输入问题。
5. 默认不会自动回车提交；需要自动提交时，将 `easyClaude.autoSubmit` 设置为 `true`。

### 终端选择

扩展通过 `/proc` 检查每个终端的进程树，找到正在运行 `claude` 进程的终端：

1. 当前活动终端里运行着 `claude` 时，优先发送到它。
2. 否则发送到第一个运行着 `claude` 的终端。
3. 都没有找到时，退回到名称中包含 `claude` 的终端。
4. 仍然找不到时提示错误，不会把代码发送到普通 Shell。

### 配置

- `easyClaude.autoSubmit`：粘贴后是否自动按回车，默认为 `false`。
- `easyClaude.prefix`：每次发送时添加到路径和行号前面的文字，默认为空。前缀非空时，扩展会在前缀后添加一个换行，再附加路径和行号。

### 注意事项

- 文本通过 bracketed paste 直接写入目标终端，不会覆盖系统剪贴板。
- Claude 在 tmux 等终端复用器里运行时，进程不在终端的进程树中，只能靠终端名称匹配。

## Codex 模式

1. 在 VS Code 集成终端中启动 Codex CLI：

   ```bash
   codex
   ```

2. 回到编辑器，打开一个代码文件，将光标放到目标行，或选择一个跨多行的代码区域。
3. 确保 Codex CLI 所在终端是当前活动终端。
4. 按 `Ctrl+Alt+C`，或右键选择以下任一命令：
   - `Codex: 发送选中代码到 CLI（带前缀）`
   - `Codex: 发送选中代码到 CLI（不带前缀）`
5. 如果选区没有跨行，扩展会发送光标所在行的当前工作区相对路径和行号；如果选区跨多行，扩展会把原始区域以真实粘贴方式写入 Codex CLI 输入框。
6. 默认不会自动回车提交；需要自动提交时，将 `codex.autoSubmit` 设置为 `true`。

扩展优先选择终端名称中包含 `codex` 的终端；如果没有找到，则使用当前活动终端。

### 配置

- `codex.autoSubmit`：粘贴后是否自动按回车，默认为 `false`。
- `codex.prefix`：每次发送时添加到路径或选中区域前面的文字，默认为空。前缀非空时，扩展会在前缀后添加一个换行，再附加路径或选中的原始区域。

扩展只粘贴选中的原始代码，不附加说明、代码围栏或额外空行。较长的多行内容会由 Codex CLI 按其内部阈值折叠显示；较短内容可能直接展开，扩展不改变代码来强制折叠。

### 终端智能粘贴

Codex 模式下，终端中按 `Ctrl+V` 或右键选择 `Codex: 终端智能粘贴`：剪贴板是文本时直接粘贴，是图片时向 Codex CLI 发送 `Alt+V` 粘贴图片。

### 复制 Codex 代码块

配套 Codex CLI 在代码块标题右侧显示 `⧉`。按住 `Ctrl` 并左键点击该图标，扩展会从当前 WSL 中运行的 Codex CLI 获取完整代码块并写入系统剪贴板。该功能不受 `codeSelected.cli` 影响。

代码块通过当前用户私有的 Unix Socket 传递，不写入磁盘文件。普通左键选择、鼠标滚轮和终端右键菜单保持 VS Code 原有行为。

扩展 ID 必须保持 `codex-publisher.codex-code-selected`，配套 Codex CLI 生成的复制链接写死了这个 ID。

### 注意事项

- 如果没有打开终端，命令会提示先打开 Codex CLI 终端。
- 使用“带前缀”命令时，会应用 `codex.prefix` 配置；使用“不带前缀”命令时会跳过该配置。
- 如果当前活动终端是普通 Shell，文本可能会被发送到该 Shell；发送前请确认 Codex CLI 终端处于活动状态。
- 发送多行代码会覆盖系统剪贴板。
- 代码块复制要求扩展安装在 `WSL: Ubuntu-22.04` 中，并使用配套的 Codex CLI 版本。

## 打包安装

在 `vscode_plugins` 仓库根目录执行：

```bash
scripts/package-install-all.sh code_selected
```

从旧的 Easy Claude 扩展迁移时，先卸载它，避免右键菜单和快捷键重复：

```bash
code --uninstall-extension local.easy-claude
```
