# 沉浸式小说背单词

移动优先的 React + Vite + TypeScript PWA MVP。应用只在浏览器本地读取 `.txt` 或可复制文字的 `.pdf` 小说文件，把部分中文名词、动词、形容词替换成 CET4 英文单词，支持点击释义、音标、生词本、黑名单、阅读进度和章节填空题。

核心优势：

- 个性化：用户可自行选择喜欢的本地小说，把背词融入自己的阅读兴趣。
- 隐私化：小说全文不上传、不分享、不转发；断词、候选选择和替换全部在浏览器本地完成。

## 功能

- 本地选择 `.txt` 或可复制文字的 `.pdf` 小说文件，通过浏览器读取；PDF 使用 PDF.js 提取文字层。
- 小说全文不上传服务器，也不会在正常阅读时调用 AI API、云端翻译或分析服务。
- 使用本地 `src/data/cet4-map.json` 做中英词表映射；生产入口会过滤反向释义碎片和高风险词项。
- 断词同时保留原生分词与本地扫描候选；冲突按本地候选网格、边界证据与明确语境规则决策。多义、多词性且没有可靠证据的项默认保留中文。
- 默认使用沉浸模式：先建立本章全部高置信安全词的最大池，再按低/中/高分别显示约 `1/3`、`2/3`、`100%`；三档始终使用同一个安全池，不会为了增加数量强行加入低置信候选。
- 点击英文单词显示中文释义、IPA 音标、原中文词和原句；当前词表有 3807 条源记录，显示候选均要求 IPA。
- 使用 `IndexedDB + Dexie.js` 保存阅读进度、生词本、替换记录、黑名单和题目记录。
- 阅读章节后生成最多 5 道基于原句的填空题。
- 支持 PWA 安装与离线应用壳缓存。
- TXT 支持 UTF-8、UTF-16 和 GB18030/GBK 小说编码；扫描版图片 PDF 需要先 OCR。
- 用户可将不想显示的词加入本地黑名单；黑名单和本地纠正不会上传，也不会自动改动内置词表。

音标数据使用 CMUdict 的公开发音数据转换为美式 IPA；少量 CMUdict 未覆盖的英式拼写和复合词使用人工核对的 IPA 补齐。

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

## 测试

```bash
npm test
npm run test:coverage
```

测试资源统一位于 `tests/`。真实小说只能放入已忽略的 `tests/private-input/`，不得提交完整原文。用户自己的语料可用以下流程建立质量基线；输出只包含文件 SHA-256、字符位置、标签和指标，不含小说正文：

```bash
npm run quality:sample -- --corpus /mnt/d/学习/阅读/小说
npm run quality:audit-corpus -- --corpus /mnt/d/学习/阅读/小说 \
  --out tests/private-input/quality/corpus-near-duplicate-audit.json
npm run quality:repartition -- \
  --manifest tests/private-input/quality/manifest.json \
  --audit tests/private-input/quality/corpus-near-duplicate-audit.json
# 在 tests/private-input/quality/ 中完成离线人工标注后：
NOVEL_CORPUS_DIR=/mnt/d/学习/阅读/小说 npm run quality:novels
# 与当前 Git 基线作同一盲测候选选择对照（不导出正文）：
NOVEL_CORPUS_DIR=/mnt/d/学习/阅读/小说 npm run quality:baseline
```

`quality:audit-corpus` 当前只审计可解码的 TXT；PDF 需先本地提取为文本才能参加近似重复检测。`quality:expand` 可为既有 split 增加偏移样本，但盲测标签不参与规则或允许词表选择。候选进入生产允许词表前必须有开发集重复证据、验证集负例筛查和 Sol 审查记录。

质量门禁要求开发、验证与盲测按内容近似重复组件的 `bookGroupId` 隔离；盲测以端到端替换精确率（边界、候选词和词性同时正确）达到 `97%` 为通过条件，并同时报告实际替换数、覆盖率和 Wilson 95% 置信区间。缺少私有标注清单或未达到门槛会明确失败，不会伪造绿灯。

## 项目结构

```text
src/
  components/        页面和交互组件
  core/
    fileReader.ts   本地 .txt / .pdf 文件读取
    tokenizer.ts    章节、句子、词项匹配
    replacer.ts     高置信、稳定替换和题目生成
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
- `PDF.js`：在浏览器本地提取可复制文字 PDF 的文字层。
- `IndexedDB`：通过 Dexie.js 保存本地学习数据。
- `Service Worker / Web App Manifest`：通过 `vite-plugin-pwa` 提供 PWA 能力。

## 隐私说明

应用不包含小说上传、后端登录、云同步、统计分析或 AI/翻译 API 调用。小说全文只存在于当前浏览器运行时内存中。阅读进度、生词、替换记录、黑名单、题目记录和用户保存的局部纠正会写入当前浏览器的 IndexedDB；其中生词、替换记录和题目可能包含其来源句子，用户可在设置中“清除本地学习数据”一次性删除。浏览器授予的本地文件句柄也在此操作中删除。

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
