# 沉浸式小说背单词

移动优先的 React + Vite + TypeScript PWA。应用只在浏览器本地读取 `.txt` 或可复制文字的 `.pdf` 小说文件，把部分中文名词、动词、形容词替换成用户选择的 CET4、CET6、考研英语、雅思或托福英文词条，支持点击释义、音标、生词本、黑名单、阅读进度和章节填空题。

核心优势：

- 个性化：用户可自行选择喜欢的本地小说，把背词融入自己的阅读兴趣。
- 隐私化：小说全文不上传、不分享、不转发；断词、候选选择和替换全部在浏览器本地完成。

## 功能

- 本地选择 `.txt` 或可复制文字的 `.pdf` 小说文件，通过浏览器读取；PDF 使用 PDF.js 提取文字层。
- 导入时自动恢复 TXT 单换行段落，并根据 PDF 文字坐标合并物理换行；低置信或复杂版式会保守回退，扫描版 PDF 仍需 OCR。
- 阅读页支持点击正文切换沉浸模式；字号、行距和左右边距统一在“设置”页调节，偏好保存在当前浏览器本地。
- 小说全文不上传服务器，也不会在正常阅读时调用 AI API、云端翻译或分析服务。
- 首次使用可选择 CET4、CET6、考研英语、IELTS 或 TOEFL；词库和学习数据按 `VocabularyId` 隔离。
- 使用本地、带来源审计的词库映射；CET6/考研英语/IELTS/TOEFL 词库在选择后懒加载，生产入口会过滤反向释义碎片和高风险词项。
- 断词同时保留原生分词与本地扫描候选；冲突按本地候选网格、边界证据与明确语境规则决策。多义、多词性且没有可靠证据的项默认保留中文。
- 默认使用沉浸模式：先建立本章全部高置信安全词的最大池，再按低/中/高分别显示约 `1/3`、`2/3`、`100%`；三档始终使用同一个安全池，不会为了增加数量强行加入低置信候选。
- 点击英文单词显示中文释义、IPA 音标、原中文词和原句；CET4 保留 3,807 条源记录（规范化后 3,806 条唯一映射），显示候选均要求 IPA。
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

第一阶段的本地验收步骤见 [`LOCALHOST-QA.md`](LOCALHOST-QA.md)，包括词库切换、学习数据隔离、清理操作、响应式宽度和 PWA 检查。发布前仍应先完成 localhost 验收；当前 `main` 已连接 Cloudflare Pages，推送后会触发自动构建。

如果切换词库时仍看到旧的 `ConstraintError`，先用 `Ctrl+Shift+R` 强制刷新；这是浏览器还在使用旧前端脚本，不需要先清除本地学习数据。

离线独立审核页不在 localhost 菜单里，而是生成到 `tests/private-input/quality/` 后直接用浏览器打开。例如：

```bash
npm run quality:render-annotation -- \
  --packet tests/private-input/quality/annotation-cet6-development.json \
  --out tests/private-input/quality/review-cet6-development.html
```

当前已生成的检查页都在 `tests/private-input/quality/`，供 CET6、雅思和托福的独立审核使用；考研英语已接入同一套离线审核流程，审核样本准备好后可按同样方式生成。它们是开发/内容审核人员的内部工具，不是普通用户的日常功能；普通用户只需关注阅读页显示的“本章替换 N 个单词”。

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
# 在 tests/private-input/quality/ 中完成离线独立审核后：
NOVEL_CORPUS_DIR=/mnt/d/学习/阅读/小说 npm run quality:novels
# 为其他词库生成各自的上下文检查包（不会覆盖 CET4 的检查结果）：
node scripts/prepare-local-annotation-pack.mjs --vocabulary cet6 --split development --limit 240
node scripts/prepare-local-annotation-pack.mjs --vocabulary kaoyan --split development --limit 240
node scripts/prepare-local-annotation-pack.mjs --vocabulary ielts --split validation --limit 192
node scripts/prepare-local-annotation-pack.mjs --vocabulary toefl --split blind --limit 240
# 每条 packet 同时带有 targetOffsetStart/targetOffsetEnd，标注时按该相对 span 判断，避免同词重复出现时选错位置。
# 生成完全离线的独立审核页面（输出仍放在 ignored private-input，不上传正文）：
npm run quality:render-annotation -- \
  --packet tests/private-input/quality/annotation-cet6-development.json
# 用浏览器打开生成的 HTML，逐条判断“要不要换、换成哪个英文词”，然后点击“导出检查结果”；可关闭页面后继续，草稿保存在该浏览器本地。
# 将独立审核结果合并到同一 manifest 的 vocabularyLabels.<id> 下：
node scripts/merge-local-quality-labels.mjs --vocabulary cet6 --labels tests/private-input/quality/cet6-development-labels.json
# 使用各库 development/validation 标签生成候选提案（只读 metadata，不读 blind，不自动改白名单）：
npm run quality:propose-candidates -- --vocabulary cet6 --out tests/private-input/quality/candidate-promotion-proposal-cet6.json
# 全量 blind-book 路径可按小说分批运行并从中断批次继续：
NOVEL_CORPUS_DIR=/mnt/d/学习/阅读/小说 npm run quality:novels:batches -- --batch-size 4
# 如果中断，使用上次输出的 checkpoint 继续：
NOVEL_CORPUS_DIR=/mnt/d/学习/阅读/小说 npm run quality:novels:batches -- \
  --batch-size 4 --resume tests/private-input/quality/local-quality-cet4-batches.json
# 与当前 Git 基线作同一盲测候选选择对照（不导出正文）：
NOVEL_CORPUS_DIR=/mnt/d/学习/阅读/小说 npm run quality:baseline
# 五库公开数据契约与来源门禁：
npm run quality:pack-contract
npm run quality:audit-vocabulary
npm run quality:audit-labels
```

`quality:audit-corpus` 当前只审计可解码的 TXT；PDF 需先本地提取为文本才能参加近似重复检测。`quality:expand` 可为既有 split 增加偏移样本，但盲测标签不参与规则或允许词表选择。候选进入生产允许词表前必须有开发集重复证据、验证集负例筛查和 Sol 审查记录。

`QUALITY_SKIP_EXHAUSTIVE=1 npm run quality:novels` 只用于快速诊断标注指标，会跳过完整盲书逐章路径并改为报告-only；可配合 `QUALITY_DIAGNOSTIC_SPLITS=development,validation` 只检查允许调规则的分片。它不能作为发布门禁。只有显式设置 `QUALITY_USE_BASELINE_LABELS=1` 才会复用 CET4 标签做对照诊断，该结果不能作为其他词库的独立证据。正式门禁不能设置这些变量。

质量门禁要求开发、验证与盲测按内容近似重复组件的 `bookGroupId` 隔离；五个词库分别以端到端替换精确率（边界、候选词和词性同时正确）达到 `99.5%`、覆盖率达到 `55%` 为内部发布条件。普通用户界面不展示这些内部指标，只展示每章实际替换单词数；缺少私有标注清单或未达到门槛会明确失败，不会伪造绿灯。

固定阅读基准（5 种题材、每本 3 章、每章 4,500 字符、中密度）最近一次本地对照为：CET4 668、CET6 470、考研英语 501、IELTS 453、TOEFL 391 个替换。该数字仅用于研发调优，不作为考试官方覆盖率声明。

## 项目结构

```text
src/
  components/        页面和交互组件
  core/
    fileReader.ts   本地 .txt / .pdf 文件读取
    paragraphs.ts   TXT/PDF 智能段落恢复
    readerPreferences.ts 阅读排版偏好
    readingLocation.ts   段落锚点与阅读位置恢复
    tokenizer.ts    章节、句子、词项匹配
    replacer.ts     高置信、稳定替换和题目生成
    db.ts           Dexie / IndexedDB 表结构和读写方法
    sm2.ts          生词复习调度
    types.ts        核心类型
  data/
    vocabulary.ts          五库加载契约与来源清单
    cet4-map.json          CET4 兼容词表
    cet6-map.json          CET6 懒加载词表
    kaoyan-map.json        考研英语懒加载词表
    ielts-map.json         IELTS 懒加载词表
    toefl-map.json         TOEFL 懒加载词表
  App.tsx           应用状态编排
  main.tsx          React 入口和 PWA 注册
```

## 调用的浏览器 API

- `FileReader API`：读取用户选择的本地 `.txt` 文件。
- `PDF.js`：在浏览器本地提取可复制文字 PDF 的文字层。
- `IndexedDB`：通过 Dexie.js 保存本地学习数据。
- `Service Worker / Web App Manifest`：通过 `vite-plugin-pwa` 提供 PWA 能力；大词库按需进入运行时缓存，不随首屏全部预缓存。

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
