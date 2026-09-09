# C Preprocessor Visualizer

一个用于 VS Code 的 C 语言预处理可视化插件。

它会在编辑 C/C++ 文件时辅助查看条件编译结构：

- 点击 `#if`、`#ifdef`、`#ifndef`、`#elif`、`#else`、`#endif` 指令本身时，高亮同一组预处理指令。
- 对当前未启用的条件编译代码区域，在行号和代码之间显示绿色竖线，不改变代码文字颜色。
- 光标进入未启用区域时，gutter 竖线保持不变。
- 可选：在未启用区域提供轻量 C 语言补全，弥补 clangd 对 inactive 代码补全较弱的问题。
- 处理当前打开并获得焦点的文件，同时会尝试解析项目内的 `#include "..."` 头文件宏。
- 会读取 `build/compile_commands.json` 中的 `-D`、`-U` 和 `-I` 参数。

## 功能效果

例如：

```c
#define FEATURE_X 1
#define FEATURE_Y 0

#if defined(FEATURE_X)
int feature_x = 1;
#elif defined(FEATURE_Y)
int feature_y = 1;
#else
int no_feature = 1;
#endif
```

当光标点击 `#if`、`#elif`、`#else` 或 `#endif` 这些指令 token 时，插件会把同一组里的预处理指令一起标识出来。

未启用的代码分支会在行号和代码之间显示绿色竖线，默认提示颜色为：

```text
#5ac83cd9
```

## 本地调试

用 VS Code 打开项目目录：

```bash
code .
```

然后按 `F5`，VS Code 会打开一个新的 `Extension Development Host` 窗口。

在新窗口中打开任意 `.c`、`.h`、`.cpp`、`.hpp` 等 C/C++ 文件，点击预处理指令即可查看效果。

注意：需要点击指令本身，比如 `#ifdef` 这几个字符；光标在指令 token 后面的空白位置也会触发，但点击同一行的宏名不会触发高亮。

## 运行测试

项目没有额外依赖，直接运行：

```bash
npm test
```

测试内容包括：

- C 预处理指令配对识别。
- `#if/#elif/#else/#endif` 同组高亮。
- `#ifdef/#else/#endif` 同组高亮。
- `#ifndef/#endif` 配对高亮。
- 未启用代码区域识别。
- 简单数值宏判断。

## 当前支持的预处理能力

当前解析器支持：

- `#define`
- `#undef`
- `#if`
- `#ifdef`
- `#ifndef`
- `#elif`
- `#else`
- `#endif`
- `#include "local_header.h"`
- `defined(MACRO)`
- 简单数值表达式，例如：

```c
#define FEATURE_Y 0
#define TARGET_LEVEL 2

#if defined(FEATURE_X) && TARGET_LEVEL >= 2
```

## 当前限制

这个插件不是完整 C 预处理器，目前有这些限制：

- 只解析本地双引号 include，例如 `#include "config.h"`；不解析系统头 `<...>`。
- 默认只读取 workspace 下的 `build/compile_commands.json`。
- 不支持复杂宏展开。
- 函数式宏会按已定义处理，但不会执行宏展开。
- 条件分支判断仍是轻量模拟，不等价于完整编译器预处理。

这些限制是刻意保守的：插件优先用于编辑器里的快速视觉辅助，而不是替代编译器预处理结果。

## 缓存

插件会把 `build/compile_commands.json` 提取后的结果缓存到：

```text
build/c-preprocessor-visualizer-cache.json
```

这个缓存用于减少重复解析编译数据库的开销。缓存策略：

- 只保留当前项目的一个缓存文件。
- 当 `compile_commands.json` 修改后会自动刷新。
- 超过 14 天未更新会自动删除并重建。
- 头文件解析结果只保存在内存中，最多 128 条，避免 build 目录缓存膨胀。

## 项目结构

```text
extension.js
  VS Code 插件入口，负责编辑器事件、装饰器和缓存。

parser.js
  C 预处理结构解析器，负责判断分支关系和 inactive 区域。

project-context.js
  项目上下文读取，负责 compile_commands.json、include 路径和头文件宏解析。

c-preprocessor-visualizer-tests/
  插件核心解析逻辑测试。

.vscode/launch.json
  VS Code 扩展调试配置。
```

## 配置项

可以在 VS Code 设置中修改 inactive 区域竖线颜色和透明度：

```json
{
  "cPreprocessorVisualizer.inactiveColor": "#5ac83cd9",
  "cPreprocessorVisualizer.inactiveOpacity": 1,
  "cPreprocessorVisualizer.showInactiveRegions": true,
  "cPreprocessorVisualizer.inactiveCodeOpacity": 1,
  "cPreprocessorVisualizer.enableInactiveCompletions": true
}
```

说明：

- `inactiveColor`：关闭区域左侧竖线颜色。
- `inactiveOpacity`：关闭区域左侧竖线透明度，范围 `0.1` 到 `1`。
- `showInactiveRegions`：是否显示关闭区域左侧竖线。
- `inactiveCodeOpacity`：未启用的闭合区域内普通代码文字透明度，范围 `0.1` 到 `1`，不作用于 `#if/#elif/#else/#endif` 指令本身。
- `enableInactiveCompletions`：是否在关闭区域启用轻量补全。

## Inactive 区域补全

clangd 通常不会为预处理关闭区域提供完整补全。插件可以在这些区域提供一套轻量补全，来源包括：

- C 语言关键词。
- 当前文件中的宏名。
- `build/compile_commands.json` 和 include 头文件解析得到的宏名。
- 当前文件和已解析 include 头文件中的枚举常量、函数名和普通标识符；函数补全会插入 `函数名(参数类型...)`，不会使用已有调用里的实参值。
- 常见 C 库函数签名，例如 `printf(const char *restrict, ...)`、`snprintf(char *restrict, size_t, const char *restrict, ...)`；`void` 参数会保留为 `func(void)`。
- `.` / `->` 后的结构体字段候选。
- 在 `#if/#ifdef/#ifndef/#elif` 行内会优先只补宏名。

这个补全不是 clangd 的替代品，只做轻量类型推断；它主要用于 inactive 区域里快速输入常见符号。`ptr->` 场景会尝试根据当前文件中的 `struct xxx *ptr` 推断字段，推断不到时退回到当前文件字段候选。
