# DSH 原生磨砂皮肤

macOS 版 DeepSeek Harness 的三款磨砂皮肤，**晴蓝、雾白、薄荷**。玻璃背后是 macOS 合成的真实桌面和其他窗口。移动窗口时，透出的背景跟着变化，输入框和正文保持清楚。

入口在左下角 **更多 → 设置 → 皮肤**。左栏的「皮肤」在「Agent 预设」下方。选中皮肤后可以拖动 **玻璃透明度**，范围 0%–85%，默认 60%。皮肤和透明度都保存在当前桌面配置中。

## 适用范围

- macOS 版 DSH `0.2.2-rc.5`。
- 三款皮肤在浅色外观下生效。选「原生」或切到深色时，窗口恢复 DSH 默认材质。开启 macOS「降低透明度」时，皮肤使用实色底。
- 更清透的 HUD 材质需要下方的桌面端桥接。只安装皮肤包时，使用 DSH 自带的 Sidebar 磨砂。

## 构建和安装

在仓库目录运行以下命令。

```sh
npm test
npm pack
dsh plugin --profile desktop add "$PWD/dsh-glass-skins-0.2.0.tgz"
```

如果 `dsh` 不在 PATH，可使用应用随附的 CLI。

```sh
sh "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$PWD/dsh-glass-skins-0.2.0.tgz"
```

## 接入原生 HUD 磨砂

桥接用于 **已解包且通过兼容性检查** 的 DSH `0.2.2-rc.5`。先退出 DSH，再用实际的应用路径执行检查。支持的宿主会显示 `Desktop layout is compatible.`。

```sh
node scripts/patch-desktop.mjs check "/Applications/DeepSeek Harness.app"
node scripts/patch-desktop.mjs install "/Applications/DeepSeek Harness.app"
```

重新打开 DSH 并选中一款皮肤即可使用。安装脚本在本机备份原始桌面文件，兼容既有皮肤偏好。宿主更新后请重新检查。若多个桌面配置共用同一个应用包，桥接随应用包提供，各配置需要各自启用皮肤。

要撤回桥接，退出 DSH 后运行以下命令。

```sh
node scripts/patch-desktop.mjs remove "/Applications/DeepSeek Harness.app"
```

皮肤包可以独立卸载。

```sh
dsh plugin --profile desktop remove dsh-glass-skins
```

## 隐私

背景由 macOS 窗口合成器实时处理。桥接仅接收来自 DSH 主窗口主框架的布尔值，对应 HUD 和 Sidebar 两种系统材质。皮肤偏好使用当前桌面配置的本地存储。
