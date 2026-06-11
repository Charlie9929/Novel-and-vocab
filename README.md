# 沉浸式小说背单词

移动优先的 React + Vite + TypeScript PWA MVP。应用只在浏览器本地读取 `.txt` 小说文件，把部分中文名词、动词、形容词替换成 CET4 英文单词，支持点击释义、音标、生词本、黑名单、阅读进度和章节填空题。

核心优势：

- 个性化：用户可自行选择喜欢的本地小说，把背词融入自己的阅读兴趣。
- 隐私化：小说文本不上传、不分享、不转发，只在浏览器本地读取和处理。

## 功能

- 本地选择 `.txt` 小说文件，通过浏览器 `FileReader API` 读取。
- 小说全文不上传服务器，不接入后端，不接入 AI。
- 使用本地 `src/data/cet4-map.json` 做中英词表映射。
- 默认使用沉浸模式，约 `35%` 候选词替换，并按段落均匀分布。
- 点击英文单词显示中文释义、音标、原中文词和原句。
- 使用 `IndexedDB + Dexie.js` 保存阅读进度、生词本、替换记录、黑名单和题目记录。
- 阅读章节后生成最多 5 道基于原句的填空题。
- 支持 PWA 安装与离线应用壳缓存。

## 本地运行

项目运行在 WSL 环境下，使用原生 Linux 命令：

```bash
npm install
npm run dev
```

启动后打开：

```text
http://localhost:5173
```

如果 5173 被占用，Vite 会自动换端口，请看终端输出的实际地址。

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

## 项目结构

```text
src/
  components/        页面和交互组件
  core/
    fileReader.ts   本地 .txt 文件读取
    tokenizer.ts    章节、句子、词项匹配
    replacer.ts     10% 稳定替换和题目生成
    db.ts           Dexie / IndexedDB 表结构和读写方法
    sm2.ts          生词复习调度
    types.ts        核心类型
  data/
    cet4-map.json   本地 CET4 种子词表
  App.tsx           应用状态编排
  main.tsx          React 入口和 PWA 注册
```

## 调用的浏览器 API

- `FileReader API`：读取用户选择的本地 `.txt` 文件。
- `IndexedDB`：通过 Dexie.js 保存本地学习数据。
- `Service Worker / Web App Manifest`：通过 `vite-plugin-pwa` 提供 PWA 能力。

这些都是浏览器本地能力，不需要 API Key，也不需要付费。

## 隐私说明

当前 MVP 不包含任何上传小说全文的逻辑，也没有后端登录、云同步、AI 接口或统计分析。小说文本只存在于当前浏览器运行时内存中；应用只把阅读进度、生词、替换记录、黑名单和练习记录写入本地 IndexedDB。

## 常见问题

### VPN 开着打不开页面

先确认开发服务器是否正在运行：

```bash
npm run dev
```

如果服务器已经启动但浏览器打不开 `http://localhost:5173`，常见原因是 VPN/代理软件接管了浏览器流量，把 `localhost` 也走代理了。可以尝试：

- 关闭 VPN 后刷新页面。
- 或在 VPN/代理软件里添加绕过规则：`localhost`、`127.0.0.1`、`::1`。
- 或直接打开 `http://127.0.0.1:5173`。

关掉梯子通常可以解决本地开发页打不开的问题，但更推荐配置"绕过本地地址"，这样不用每次切换。
