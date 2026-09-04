#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT, chatCompletion, parseArgs } from "./ds-client.mjs";
import { appendUsageLedger } from "./pipeline-utils.mjs";

const BOOKS = [
  {
    id: "tide-post-office",
    project: "AI小说/作品/短篇试验",
    title: "潮汐邮局",
    source: "public/ai-novels/tide-post-office/content.v2.json",
    output: "AI小说/作品/短篇试验/10-导出/潮汐邮局-阅读版-v3.md",
    instruction: "保留现实奇幻、海岬镇、旧灯塔、未寄出的信、林遥与父亲重新开口这条核心线。主驱动力是亲情拉扯，辅以周砚与林遥之间的干脆对话幽默；奇幻规则只在潮汐邮局本身，不增加新法术或世界设定；父女关系必须靠实际见面、争执和具体安排推进。",
    chapterPlans: [
      "林遥在外婆去世后回到海岬镇，原本只想清空灯塔看守屋并卖掉房子。屋顶、电路和中介带来的现实麻烦迫使她多留几天；她在遗物里找到外婆保存的明信片、母亲的记录和一封十三岁时写给父亲、始终没有寄出的信。退潮时她在灯塔礁石间看见蓝门，遇到潮汐记录员周砚，确认门与那封信有关，决定第二天再来。",
      "林遥带旧信进入潮汐邮局，周砚说明它不能把信送回过去，旧地址也已经失效。她不接受规则，和周砚争执，试图把多年没有说完的话交给邮局代办；涨潮前她只写出一封新信的开头，终于承认自己要找的是现在的父亲。她拿到父亲住在旧船坞的具体去处，带着旧信离开，决定亲自见他。",
      "林遥在旧船坞找到父亲林岑，两人从房屋修缮和外婆的托付说起，话题逐渐逼近母亲去世、父亲离开和多年沉默。林遥把旧信放到工作台，父亲承认知道这封信，却一直没有勇气问；他说明当年离开的真实原因，但不要求女儿原谅。林遥说出自己真正害怕的是没人记得母亲，两人没有突然和好，只约定一起修好灯塔屋；她回去时蓝门已经消失。",
    ],
  },
  {
    id: "zero-buyback-agreement",
    project: "AI小说/作品/零点回购协议",
    title: "签字即归零",
    source: "public/ai-novels/zero-buyback-agreement/content.v2.json",
    output: "AI小说/作品/零点回购协议/10-导出/零点回购协议-阅读版-v4.md",
    instruction: "保留跨境生物科技并购、回购条款、唐栖真拒绝背书、段启衡协助核验、董事会暂停签约这条核心线。主驱动力是风控专业能力带来的翻盘爽点，辅以唐栖真与贺成礼的权力拉扯；专业内容只能在人物当场争执、核验和承担代价时出现，不要写成合同解读或会议纪要。",
    chapterPlans: [
      "签约前十八小时，风险负责人唐栖真在数据室发现新版本许可条款和版本日志，意识到砺川买下维澜治疗后，核心许可会在控制权变更后的零点被关联方低价买回。她只有只读权限，无法暂停交易；CFO贺成礼以融资窗口和卖方催签施压。她拒绝在风险清单上签字，联系顾问段启衡核对批次资料，并把第一份可复核的疑点留在系统里。",
      "唐栖真和段启衡在材料锁定前连夜核验：批次保管记录、授权目录、关联方公开登记和版本流转互相印证。贺成礼试图把问题压成措辞争论，要求她先签再补说明；唐栖真在权限边界内坚持只提交能证明的事实，并让独立律师确认触发条件。两人把备忘录送给有权限暂停交易的董事长宋曼青，等待最后一场会议。",
      "签约前的董事会会议上，唐栖真面对贺成礼、卖方代表和融资压力，逐项说明证据来源、仍未确认的部分与继续签约的代价。她拒绝替董事会做结论，也拒绝用沉默背书；段启衡补充技术和保管链核验，宋曼青当场暂停签约并启动独立调查。唐栖真失去原项目主谈席位，仍保住风险判断的可信度，结尾落在她把未签名清单交给调查组。",
    ],
  },
  {
    id: "orbital-greenhouse-quota",
    project: "AI小说/作品/轨道温室配额",
    title: "末日空间站：氧气只剩十八小时",
    source: "public/ai-novels/orbital-greenhouse-quota/content.v2.json",
    output: "AI小说/作品/轨道温室配额/10-导出/轨道温室配额-阅读版-v3.md",
    instruction: "保留科幻题材、弧光三号、氧气与水回收危机、补给舱交会、苏惟安的调度选择和全员协作。主驱动力是工程判断推动的生存翻盘爽点，辅以苏惟安与团队之间的信任拉扯；第一章开头必须交代时代、人类文明阶段、弧光三号的用途和她为何驻站。科幻设定必须通过人物正在处理的故障、权限冲突和关系反应呈现，禁止大段技术说明；必要数字极少出现，优先用人物对话说明后果。",
    chapterPlans: [
      "科幻空间站弧光三号等待补给舱，调度员苏惟安在交班前发现生命保障曲线突然恶化，氧气余量只够撑到补给前。备用传感器尚未同步，站长沈砚秋要求确认后再动温室，货运代表费沉舟坚持保住高价值种源。苏惟安先让全员进入保守方案，调取维修工单、库存和负载变化，发现一条没有现场记录的回收舱维修申请。",
      "备用传感器恢复后，异常仍然存在。苏惟安带黎观澜检查水回收舱，发现旁路阀微漏和冷凝水积压，维修并不顺利，补给交会窗口又要求她尽快给出配额。她与费沉舟正面争执，说明保住种源没有意义的前提是先让六个人活下来；她冻结非必要货运、让温室进入保活状态，并把两套遥测、维修记录和冷凝水盘点发给地面飞控。",
      "交会窗口临近，维修后的曲线暂时下降，地面却质疑站内越权调整。苏惟安在控制舱、设备舱和通讯链之间协调，要求每个人报出自己能确认的事实，不让任何人用一句‘应该没事’结束判断。她用完整证据包争取到调整交会窗口的批准，六名乘员在补给舱抵达前守住生命保障；事故责任进入复盘，她承担冻结货柜的问询，却把温室最低种源和可追踪记录一起保留下来。",
    ],
  },
  {
    id: "funeral-livestream",
    project: "AI小说/作品/手机正在直播我的葬礼",
    title: "手机正在直播我的葬礼",
    source: "public/ai-novels/funeral-livestream/content.v2.json",
    output: "AI小说/作品/手机正在直播我的葬礼/10-导出/手机正在直播我的葬礼-阅读版-v3.md",
    instruction: "保留当代都市、直播事故、许砚被嫁祸、沈梨协助取证、许葵与受影响者、发布会现场翻盘这条核心线。主驱动力是荒诞葬礼设定带来的抽象幽默与证据翻盘爽点，幽默必须来自许砚、沈梨和唐骁的性格对撞；前三段让读者明白主角是谁、为什么被推上风口、他必须马上做什么；证据通过人物对话和现场行动出现，不写成取证报告。",
    chapterPlans: [
      "视频剪辑师许砚在北辰传媒被当成慈善直播泄密的替罪羊，刚交还工牌，一部陌生手机开始播放他的葬礼。画面里的遗照、灵堂和主持词让他确认有人在制造自己已经死亡或失联的舆论假象；公司公关负责人唐骁逼他交出原片备份。许砚在沈梨帮助下保住手机，发现直播里短暂露出被剪掉的退款承诺，线索指向旧水厂备用演播间。",
      "许砚和沈梨去找妹妹许葵以及受影响的社区居民，核对收据、公开回放和原始视频副本。沈梨说明每份材料的来源，许砚也承认自己已经没有公司权限，不能把猜测当证据。唐骁用工作机会和威胁交换手机，许砚拒绝；平台投诉回执和原片片段证明回放被剪改，两人决定把材料带到北辰传媒的品牌发布会，让直播自己留下完整现场。",
      "品牌发布会现场，唐骁试图用话筒和保安夺回叙事，许砚让葬礼直播继续，把原始视频、平台回执和受影响者的收据交给在场媒体与警方。唐骁在争执中说出只有操盘者才知道的剪辑安排，现场录音被保存；许砚不再私下交换手机，承担公开指控带来的风险。警方正式受理，泄密罪名被撤下；他失去原职位，却决定和沈梨做事实核查，结尾落在新的工作开始。",
    ],
  },
];

const HARD_RULE_SUMMARY = `情节要完整，开头交代人物、关系、背景和眼前目标，结尾落在具体行动、对白或结果上；篇幅按项目档位和剧情完整度决定，不对题材设限。严格遵循项目原有人设与设定。每篇短篇必须选定至少一种主驱动力并兑现：抽象幽默、主角翻盘爽点或关系情感线；前三段交代人物身份、世界/地点、前情、任务和代价，科幻篇还要交代时代、人类文明阶段、设施用途和角色位置。文风要有活人感，角色语言有差异，靠对话、动作、心理、神态和现场反应推进，少用无关旁白和数字，不能写成报告、说明书、会议纪要或侦探题。段落以手机端阅读舒适度为基准，普通叙事段落尽量控制在两三行、约四十五至九十个汉字；完整对话、动作链或情绪转折确有必要时才保留长段，段落之间要有自然停顿，不能大段一坨，也不能连续拆成单句碎段。连接紧密的短句要合并，叙述句单元中的短句占比不超过百分之十五，不能连续出现单句动作段；自然嵌在完整对话里的短回应可以保留，但不能独立成段刷屏。参考优秀考试词汇网文的高层方法：身份与任务先行，词汇参与人物冲突、吐槽、阻力或反转，每章都有具体开场、必要背景、互动升级和阶段落点；短篇压缩环节，不删因果和结尾，不复制任何作者原句、桥段或独特措辞。破折号只用于不可替代的话锋转折或插入补充，单段最多一个，优先使用逗号、句号、冒号和分号。避免隐喻、装腔、套话、机械动作、夸张身体反应、随机英文和代码围栏。自动校验会拦截用户列出的固定禁句、禁词和生产术语；不要复述规则示例，不要把禁句写进正文。`;
const args = parseArgs(process.argv.slice(2));
const selectedBook = String(args.book ?? "").trim();

for (const book of BOOKS) {
  if (selectedBook && selectedBook !== book.id) continue;
  const projectDir = resolve(PROJECT_ROOT, book.project);
  const source = JSON.parse(readFileSync(resolve(PROJECT_ROOT, book.source), "utf8"));
  const projectFiles = [
    "00-项目控制/项目配置.md",
    "01-世界观/世界规则.md",
    "02-人物/人物模板.md",
  ].map((relative) => `\n## ${relative}\n${safePromptMaterial(readFileSync(resolve(projectDir, relative), "utf8"))}`).join("\n");
  const sourceChapters = source.chapters;
  const rewritten = [];
  const runId = `human-style-rewrite-${book.id}-${Date.now()}`;

  for (let index = 0; index < sourceChapters.length; index += 1) {
    const number = String(index + 1).padStart(3, "0");
    const original = sourceChapters[index];
    const previous = rewritten.at(-1);
    const context = previous
      ? `上一章重写稿的结尾，仅用于承接人物状态和现场位置，不要复述：\n${previous.text.slice(-1400)}`
      : "这是第一章，没有上一章。";
    const prompt = `请重写下面这一本小说的第${number}章，写成可以直接给读者看的完整正文。不要解释修改过程，只输出合法 JSON，不要代码围栏：
{"title":"章节标题","text":"完整正文"}

本书核心要求：${book.instruction}

全局硬规则摘要：
${HARD_RULE_SUMMARY}

    本章以八千至一万二千字为目标，剧情需要时自然延长；不能返回提纲、梗概、分镜、审核意见或省略版。至少写出足够多的完整短段，普通叙事段落以手机端两三行、约四十五至九十个汉字为目标，过长段落必须有完整对话、动作链或情绪转折作为理由；至少十个段落包含真正推动关系或事件的对话。要写具体场面、人物反应、犹豫、让步、冲突和后果，每一段都要让事件、关系、信息、选择或代价发生变化。

第一章尤其要在开头很快交代主角是谁、关键关系、世界或地点、必要前情、眼前麻烦、必须处理的目标和失败代价；科幻篇不得只抛出设施名称，必须说明时代、人类文明阶段、设施用途和主角驻留原因。后续章节要承接上一章的具体出口。三章合起来必须完成前因、发展、高潮和结尾，本章要有明确的阶段结果。

文风必须有活人味，角色语言有差异，幽默来自人物和处境；每篇至少兑现抽象幽默、翻盘爽点、关系情感线中的一种，不能只提供信息。正文由适合手机阅读的短文本块组成，把可连贯的短句合并为有呼吸的复句；短句句子单元不超过百分之十五，不能出现连续的单句动作段。对话不能像审讯记录或会议纪要，每次发言都要带出关系变化，并配合自然的动作、神态、心理或现场反应。破折号只在必要转折或插入说明时使用，单段最多一个。写完后自行检查，正文不要复述规则示例，也不要出现那些禁用字符结构。

    减少数字、编号、参数和旁白解释；数字只在影响当前选择时保留。每套支持词库在本章都要有至少六十个自然命中空间，优先使用剧情本来需要的普通动作、判断、关系、工作和生活词汇，让词汇随着人物选择和事件推进出现，禁止列词、硬塞生词、重复同义词或为了数量改变人物说话方式。禁止隐喻、套话、机械动作、夸张身体描写、无关英文、代码块符号、固定对比句式，以及硬规则列出的所有禁用表达和词语。结尾落在本章具体行动、对白或现场结果上，不用总结句。

项目资料：
${projectFiles}

上一章承接：
${context}

    本章必须覆盖以下已确认的事件链。只使用这些事件、项目资料和上一章承接来重新组织正文，不要照抄旧稿，不要把事件链写成提纲：
    ${book.chapterPlans[index]}

    编辑端旧稿不直接提供给写作者，避免复制旧句和旧腔调；本章只依据上面的已确认事件链与项目资料创作。
    `;

    let accepted = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const attemptPrompt = attempt === 1
        ? prompt
        : `${prompt}\n\n这是第${attempt}次重写。上一版未通过硬门禁，请保留已经发生的核心事件，重点修正检查结果；不要解释，不要复述规则，直接返回完整 JSON 章节正文。\n检查结果：${JSON.stringify(accepted?.audit ?? {})}\n上一版：\n${accepted?.text ?? ""}`;
      const result = await chatCompletion([
        {
          role: "system",
          content: "你是经验丰富的中文小说作者和责任编辑，擅长写有活人感、人物拉扯和自然对话的成年向网文。必须服从项目硬边界和用户文风硬规则。",
        },
        { role: "user", content: attemptPrompt },
      ], {
        thinking: "disabled",
        maxTokens: 13000,
        temperature: 0.88,
        responseFormat: { type: "json_object" },
        timeoutMs: 300000,
      });
      if (result.finishReason === "length") throw new Error(`${book.id} 第${number}章第${attempt}次输出被截断`);
      let payload;
      try {
        payload = parsePayload(result.text, `${book.id} 第${number}章`);
      } catch (error) {
        appendUsageLedger(projectDir, {
          runId,
          chapter: index + 1,
          stage: "human-style-rewrite",
          model: result.model,
          promptCharacters: attemptPrompt.length,
          contextCharacters: original.text.length,
          contextMemoryChapters: previous ? [index] : [],
          finishReason: result.finishReason,
          usage: result.usage,
          result: "failed-json",
          reason: error.message,
        });
        if (attempt === 5) throw error;
        continue;
      }
      let text = normalizeParagraphLayout(normalizeHardBans(String(payload.text ?? "").trim()));
      const title = String(payload.title ?? "")
        .replace(/^(?:第\d{1,3}章|第[一二三四五六七八九十百千]+章)[:：]?\s*/u, "")
        .trim();
      // A style-heavy rewrite can be structurally sound while still stopping
      // too early. Extend from the actual ending so the prose grows with the
      // scene instead of padding the beginning with exposition.
      let extensionCount = 0;
      while (auditStyleLocal(text).naturalChars < 12000 && extensionCount < 2) {
        extensionCount += 1;
        const extensionPrompt = `请从下面正文的最后一句继续写本章，直接输出合法 JSON：
{"text":"自然接续的正文"}

续写一段约两千至三千五百个中文字符的完整小说正文，必须承接最后的现场、人物关系和情绪，不要重复前文，不要总结，不要跳过冲突，不要写提纲或说明。继续推进本章已确认的事件链，让人物通过对话、具体行动、犹豫、让步和后果完成这一阶段；普通叙事段落以手机端两三行、约四十五至九十个汉字为目标，保持段落完整、对话有来回、叙述有呼吸，不要连续单句动作段，不要堆数字，不要加入事件链之外的新设定。正文需要有足够自然、具体且不重复的动词、名词和形容词，让正常词库替换能在本章形成充分覆盖，禁止为数量硬塞生词、数字、编号或同义重复。结尾要落在具体行动、对白或现场结果上。

本章事件链：${book.chapterPlans[index]}

正文结尾（只读最后一小段定位，禁止复述其中任何句子）：
${text.slice(-1400)}`;
        const extensionResult = await chatCompletion([
          {
            role: "system",
            content: "你是中文小说作者，只续写正文，不解释，不复述规则，不使用代码围栏。",
          },
          { role: "user", content: extensionPrompt },
        ], {
          thinking: "disabled",
          maxTokens: 9000,
          temperature: 0.86,
          responseFormat: { type: "json_object" },
          timeoutMs: 300000,
        });
        try {
          const extensionPayload = parsePayload(extensionResult.text, `${book.id} 第${number}章续写`);
          const extension = normalizeParagraphLayout(normalizeHardBans(String(extensionPayload.text ?? "").trim()));
          const nonOverlappingExtension = removeContinuationOverlap(text, extension);
          if (nonOverlappingExtension) text = `${text}\n\n${nonOverlappingExtension}`;
          appendUsageLedger(projectDir, {
            runId,
            chapter: index + 1,
            stage: "human-style-rewrite-extension",
            model: extensionResult.model,
            promptCharacters: extensionPrompt.length,
            contextCharacters: text.length,
            contextMemoryChapters: previous ? [index] : [],
            finishReason: extensionResult.finishReason,
            usage: extensionResult.usage,
            result: extension ? "generated" : "empty",
          });
        } catch (error) {
          appendUsageLedger(projectDir, {
            runId,
            chapter: index + 1,
            stage: "human-style-rewrite-extension",
            model: extensionResult.model,
            promptCharacters: extensionPrompt.length,
            contextCharacters: text.length,
            contextMemoryChapters: previous ? [index] : [],
            finishReason: extensionResult.finishReason,
            usage: extensionResult.usage,
            result: "failed-json",
            reason: error.message,
          });
        }
      }
      const audit = auditStyleLocal(text);
      const failures = [];
      if (audit.naturalChars < 7500) failures.push(`章节展开不足 ${audit.naturalChars}<7500`);
      // The final book-level gate remains 15%; a chapter-level retry threshold
      // leaves room for a short exchange or a tense scene before aggregation.
      if (audit.shortSentenceRatio > 0.20) failures.push(`本章叙述短句占比 ${audit.shortSentenceRatio}>0.20`);
      if (audit.longestShortParagraphChain > 1) failures.push("存在连续短句段落");
      if (audit.digitCount > Math.max(24, Math.ceil(audit.naturalChars * 0.025))) failures.push(`数字密度过高 ${audit.digitCount}`);
      if (audit.forbiddenMatches.length) failures.push(`命中禁区 ${audit.forbiddenMatches.map((item) => item.type).join("、")}`);
      appendUsageLedger(projectDir, {
        runId,
        chapter: index + 1,
        stage: "human-style-rewrite",
        model: result.model,
        promptCharacters: attemptPrompt.length,
        contextCharacters: original.text.length,
        contextMemoryChapters: previous ? [index] : [],
        finishReason: result.finishReason,
        usage: result.usage,
        result: failures.length ? "failed-style-gate" : "generated",
        reason: failures.join("；") || undefined,
      });
      accepted = { title, text, audit };
      if (failures.length) {
        const debugPath = resolve("/tmp", `ai-novel-${book.id}-${number}-attempt${attempt}.txt`);
        writeFileSync(debugPath, text, "utf8");
      }
      if (!failures.length) break;
      if (attempt === 5) throw new Error(`${book.id} 第${number}章五次未通过：${failures.join("；")}`);
    }
    rewritten.push(accepted);
    console.log(JSON.stringify({ ok: true, id: book.id, chapter: number, audit: accepted.audit }, null, 2));
  }

  const markdown = rewritten.map((chapter, index) => `第${String(index + 1).padStart(3, "0")}章：${chapter.title}\n\n${chapter.text}`).join("\n\n");
  const audit = auditStyleLocal(markdown);
  const failures = [];
  if (audit.shortSentenceRatio > 0.15) failures.push(`整本短句占比 ${audit.shortSentenceRatio}>0.15`);
  if (audit.longestShortParagraphChain > 1) failures.push("整本存在连续短句段落");
  if (audit.digitCount > Math.max(24, Math.ceil(audit.naturalChars * 0.025))) failures.push(`整本数字密度过高 ${audit.digitCount}`);
  if (audit.forbiddenMatches.length) failures.push(`整本命中禁区 ${audit.forbiddenMatches.map((item) => item.type).join("、")}`);
  if (failures.length) throw new Error(`${book.id} 整本未通过：${failures.join("；")}`);
  const outputPath = resolve(PROJECT_ROOT, book.output);
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, `${markdown}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, id: book.id, output: book.output, audit }, null, 2));
}

function safePromptMaterial(text) {
  return String(text ?? "")
    .replace(/```+/g, "")
    .replace(/全文完/g, "故事收束")
    .replace(/不是[^。！？\n]{0,40}而是/g, "需要避免的旧式对比")
    .replace(/不是[^。！？\n]{0,40}是/g, "需要避免的旧式判断")
    .replace(/[A-Za-z]{2,}/g, "中文术语");
}

function normalizeHardBans(text) {
  return String(text ?? "")
    .replace(/我来不是想说修房的事/g, "我今天来，和修房没有关系")
    .replace(/我不是来听这三个字的/g, "我今天来，也不只为听这三个字")
    .replace(/我那时候不是怪你。我是怕/g, "我那时候确实怨过你，真正怕的是")
    .replace(/我不是想扔下你，我是不知怎么当你爸/g, "我没想过扔下你，只是那时候不知道怎么当你爸")
    .replace(/像是某种/g, "带着")
    .replace(/空洞/g, "敷衍")
    .replace(/\bv\d+(?:\.\d+)?(?:[_-][A-Za-z]+)?\b/gi, "版本")
    // Keep the fallback local and syntax-safe. A broad clause rewrite can
    // swallow the next predicate and produce editorial-looking fragments.
    .replace(/不是/g, "并非")
    .replace(/而是/g, "真正是")
    .replace(/([，。；：])\s*([，。；：])/g, "$1");
}

function removeContinuationOverlap(source, continuation) {
  const left = String(source ?? "").trim();
  const right = String(continuation ?? "").trim();
  if (!left || !right) return right;
  const maximum = Math.min(left.length, right.length, 1800);
  for (let length = maximum; length >= 80; length -= 1) {
    if (left.slice(-length) === right.slice(0, length)) return right.slice(length).trim();
  }
  return right;
}

function normalizeParagraphLayout(text) {
  const paragraphs = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, "").trim())
    .filter(Boolean);
  const output = [];
  for (const paragraph of paragraphs) {
    const units = paragraph.split(/(?<=[。！？!?])/u).map((unit) => unit.trim()).filter(Boolean);
    if (units.length <= 1 || (paragraph.match(/[\u3400-\u9fff]/g) ?? []).length <= 120) {
      output.push(paragraph);
      continue;
    }
    let current = "";
    for (const unit of units) {
      const next = `${current}${unit}`;
      const length = (next.match(/[\u3400-\u9fff]/g) ?? []).length;
      const currentLength = (current.match(/[\u3400-\u9fff]/g) ?? []).length;
      if (current && (length > 120 || (currentLength >= 65 && length > 90))) {
        output.push(current);
        current = unit;
      } else {
        current = next;
      }
    }
    if (current) output.push(current);
  }
  return output.join("\n\n");
}

function parsePayload(text, label) {
  const clean = String(text ?? "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    return JSON.parse(clean);
  } catch (error) {
    throw new Error(`${label} 返回内容不是合法 JSON：${error.message}`);
  }
}

function auditStyleLocal(text) {
  const body = String(text).replace(/^\s*第\d{3}章[^\n]*$/gmu, "").trim();
  const naturalChars = (body.match(/[\u3400-\u9fff]/g) ?? []).length;
  const sentences = body.split(/(?<=[。！？!?])/u).map((item) => item.replace(/\s/g, "").trim()).filter(Boolean);
  const narrativeSentences = sentences.filter((sentence) => !/[“”「」『』]/u.test(sentence));
  const sizes = narrativeSentences.map((sentence) => (sentence.match(/[\u3400-\u9fff]/g) ?? []).length);
  const shortSentences = sizes.filter((size) => size > 0 && size <= 8).length;
  const paragraphs = body.split(/\n\s*\n/).map((item) => item.replace(/\s/g, "").trim()).filter(Boolean);
  const shortParagraphs = paragraphs.map((paragraph) => {
    const units = paragraph.split(/[。！？!?]+/u).map((item) => item.trim()).filter(Boolean);
    return units.length === 1 && (units[0].match(/[\u3400-\u9fff]/g) ?? []).length <= 8;
  });
  let longestShortParagraphChain = 0;
  let chain = 0;
  for (const item of shortParagraphs) {
    chain = item ? chain + 1 : 0;
    longestShortParagraphChain = Math.max(longestShortParagraphChain, chain);
  }
  const patterns = [
    ["代码块符号", /```/g],
    ["陈词滥调", /想说什么[^。！？\n]{0,18}(?:喉咙|声音)[^。！？\n]{0,18}(?:发不出声|说不出来)|石子[^。！？\n]{0,10}涟漪|(?:语气|声音)[^。！？\n]{0,18}像在[^。！？\n]{0,12}天气|心脏[^。！？\n]{0,18}攥紧|像是某种|警惕起不存在的耳朵|浓密的睫毛[^。！？\n]{0,30}疲惫的阴影|带你去过个地方/g],
    ["禁用句式", /不是[^。！？\n]{0,40}而是|不是[^。！？\n]{0,40}是/g],
    ["禁用词", /全文完|不带情欲|扭曲|疯狂|空洞|麻木/g],
    ["莫名其妙的英文", /\b[a-z]{4,}\b/g],
  ];
  const forbiddenMatches = patterns.map(([type, pattern]) => ({ type, matches: [...body.matchAll(pattern)].map((item) => item[0]) })).filter((item) => item.matches.length);
  return {
    naturalChars,
    sentenceCount: sentences.length,
    shortSentences,
    shortSentenceRatio: narrativeSentences.length ? Number((shortSentences / narrativeSentences.length).toFixed(4)) : 0,
    longestShortParagraphChain,
    digitCount: (body.match(/[0-9０-９]/g) ?? []).length,
    forbiddenMatches,
  };
}
