# 测试目录约定

- `unit/`：Vitest 单元与回归测试。
- `fixtures/`：允许纳入项目的极短、已确认或脱敏测试样例。
- `private-input/`：本地真实小说输入，已整体忽略，禁止提交完整原文。

真实小说可以任意 `.txt` 文件名放入 `private-input/`。新增回归案例时，只摘取验证问题所需的最短片段。

本地质量测试样本目前包含 5 本来自 Project Gutenberg 的公开领域中文小说，保存在
`private-input/public-domain/`，包括《儒林外史》《施公案》《警世通言》《镜花缘》和《老残游记》。
这些完整正文不会提交到 GitHub；测试会在本地样本存在时运行，干净克隆没有样本时自动跳过这项本地审计。

词库同文同章替换数基准使用 `private-input/quality/reader-benchmark-v1.json`（只含路径和指纹，正文不提交），运行：

```sh
npm run quality:benchmark-reader
```

该命令串行比较 CET4、CET6、考研英语、IELTS、TOEFL；它只生成开发者对照数据，用户界面仍只显示每章实际替换单词数。

来源链接：

- [儒林外史 #24032](https://www.gutenberg.org/ebooks/24032)
- [施公案 #23825](https://www.gutenberg.org/ebooks/23825)
- [警世通言 #24141](https://www.gutenberg.org/ebooks/24141)
- [镜花缘 #23818](https://www.gutenberg.org/ebooks/23818)
- [老残游记 #25124](https://www.gutenberg.org/ebooks/25124)
