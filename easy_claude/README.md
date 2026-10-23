# Easy Claude

将 VS Code 编辑器中选中代码的位置（文件和行号）直接发送到已经打开的 Claude Code CLI 终端。

## 前置条件

- VS Code 1.85 或更高版本，扩展安装在 WSL / Linux 侧。
- 已在 VS Code 集成终端中启动 Claude CLI，并且它正在等待输入。

## 使用方式

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

## 终端选择

扩展通过 `/proc` 检查每个终端的进程树，找到正在运行 `claude` 进程的终端：

1. 当前活动终端里运行着 `claude` 时，优先发送到它。
2. 否则发送到第一个运行着 `claude` 的终端。
3. 都没有找到时，退回到名称中包含 `claude` 的终端。
4. 仍然找不到时提示错误，不会把代码发送到普通 Shell。

## 配置

- `easyClaude.autoSubmit`：粘贴后是否自动按回车，默认为 `false`。
- `easyClaude.prefix`：每次发送时添加到路径或选中区域前面的文字，默认为空。

例如：

```json
{
  "easyClaude.prefix": "请分析下面的代码："
}
```

前缀非空时，扩展会在前缀后添加一个换行，再附加路径和行号。

## 注意事项

- 文本通过 bracketed paste 直接写入目标终端，不会覆盖系统剪贴板。
- Claude 在 tmux 等终端复用器里运行时，进程不在终端的进程树中，只能靠终端名称匹配。

## 打包安装

在 `vscode_plugins` 仓库根目录执行：

```bash
scripts/package-install-all.sh easy_claude
```
