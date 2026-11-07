# DSH Dialogue Session

DeepSeek Harness 的会话记忆插件。普通项目按工作目录隔离规则与决定。长期角色对话可以指定一个项目，加载项目提供的人格和规则，保存有原话依据的记忆，在新聊天里接续关系与尚未了结的事。

## 安装

本版针对 DeepSeek Harness `0.2.2-rc.1` 和带有 `node:sqlite` 的 Node.js 24.21 或以上版本。已安装 DSH CLI 的用户可在终端执行：

```sh
git clone https://github.com/oTATo-Boss/dsh-dialogue-session.git
cd dsh-dialogue-session
npm pack
dsh plugin --profile desktop add "file:$PWD/otato-dialogue-session-1.2.2.tgz"
```

安装后在 DSH 插件管理页确认已启用。通用模式识别 Git 根目录或包含 AGENTS.md、CLAUDE.md、package.json 等标记的项目。它会重新读取项目文档，检查模型提取的决定和待确认事项是否有用户原话支撑，再写入本机的项目记录。

## 给自己的角色接入长期对话

将 [示例目录](examples/character) 复制到自己的工作区，按需编辑 `soul.md` 与 `对话/规则.md`。在桌面 profile 的 `cordis.patch.yml` 顶层数组中添加以下覆盖项，把示例路径换成角色项目的绝对路径：

```yaml
- id: otato-dialogue-session
  name: '@otato/dialogue-session'
  config:
    autoProjects: true
    projectRoot: '/absolute/path/to/your/character-project'
```

在 DSH 中打开该目录并新建聊天。默认使用对话模式；可明确说“工作模式”或“开发模式”切换。角色在回复前会拿到相关经历、近期原话和仍惦记的事。回复后，插件用当前模型提取记录并验证引文。不同聊天共享长期记忆，各自保留本场状态。通用模式会跳过这个角色目录。可在同一 config 中使用 `excludedRoots` 排除其他项目，或设 `autoProjects: false` 只启用角色目录。

## 数据位置

角色对话原文和 SQLite 记忆在角色项目的 `对话/私有数据/`。通用项目的记录位于 DSH 数据目录下的 `session-guard/projects/`。给角色项目配置版本控制时，应忽略私有数据目录。回复前的准备与回复后的记忆提取会将相应会话内容交给 DSH 当前配置的模型服务。工作模式只提取明确的个人事实，开发模式跳过角色记忆写入。

独立客户端也可在角色项目根目录运行本仓库的 `dialogue-cli.js`，通过 stdin 提交 JSON。用稳定的 `local:ID` 标识聊天，`open` 传入 text，`consider` 可根据返回的 attention 选择经历，`finish` 传入 turn、reply 和带引文的 notes。DSH 桌面会自动完成读写。

## 开发

在可解析对应版本 DSH 宿主依赖的环境中运行 `node --test tests/*.test.mjs`。原生事件集成用合成消息与模拟模型，不需要聊天数据或 API 密钥。

本项目采用 [MIT 许可证](LICENSE)。随包分发的两个第三方组件及各自的许可证见 [THIRD_PARTY.md](THIRD_PARTY.md)。
