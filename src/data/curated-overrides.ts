import type { Cet4Entry } from "../core/types";

const CURATED_ENTRY_OVERRIDES: Record<string, Cet4Entry[]> = {
  "情况": [
    { zh: "情况", en: "situation", meaning: "情况；形势；处境", partOfSpeech: "noun", phonetic: "/ˌsɪtʃuˈeɪʃən/", priority: 30 },
  ],
  "信息": [
    { zh: "信息", en: "information", meaning: "信息；资料；情报", partOfSpeech: "noun", phonetic: "/ˌɪnfɚˈmeɪʃən/", priority: 30 },
  ],
  "完全": [
    { zh: "完全", en: "completely", meaning: "完全地；彻底地", partOfSpeech: "adverb", phonetic: "/kəmˈplitli/", priority: 30 },
  ],
  "瞬间": [
    {
      zh: "瞬间",
      en: "instantly",
      meaning: "瞬间；立即地",
      partOfSpeech: "adverb",
      phonetic: "/ˈɪnstəntli/",
      priority: 20,
    },
    {
      zh: "瞬间",
      en: "instant",
      meaning: "瞬间；片刻",
      partOfSpeech: "noun",
      phonetic: "/ˈɪnstənt/",
      priority: 30,
      contextHints: ["一瞬间", "这一瞬间", "那一瞬间", "的瞬间", "某个瞬间", "那个瞬间"],
    },
  ],
  "自然": [
    { zh: "自然", en: "naturally", meaning: "自然地；当然", partOfSpeech: "adverb", phonetic: "/ˈnætʃɚəli/", priority: 20 },
    {
      zh: "自然",
      en: "natural",
      meaning: "自然的；天然的",
      partOfSpeech: "adjective",
      phonetic: "/ˈnætʃɚəl/",
      priority: 30,
      contextHints: ["自然风", "自然光", "自然环境", "自然状态", "自然规律", "自然条件", "自然资源"],
    },
  ],
  "基本": [
    { zh: "基本", en: "basically", meaning: "基本上；大体上", partOfSpeech: "adverb", phonetic: "/ˈbeɪsɪkli/", priority: 20 },
    {
      zh: "基本",
      en: "basic",
      meaning: "基本的；基础的",
      partOfSpeech: "adjective",
      phonetic: "/ˈbeɪsɪk/",
      priority: 30,
      contextHints: ["基本常识", "基本原则", "基本条件", "基本功能", "基本信息", "基本要求", "基本情况", "基本结构"],
    },
  ],
  "呼吸": [
    { zh: "呼吸", en: "breath", meaning: "呼吸；气息", partOfSpeech: "noun", phonetic: "/brɛθ/", priority: 20 },
    {
      zh: "呼吸",
      en: "breathe",
      meaning: "呼吸",
      partOfSpeech: "verb",
      phonetic: "/brið/",
      priority: 30,
      contextHints: ["无法呼吸", "停止呼吸", "开始呼吸", "呼吸着", "呼吸了", "大口呼吸", "深深呼吸"],
    },
  ],
  "拒绝": [
    { zh: "拒绝", en: "refuse", meaning: "拒绝；不接受", partOfSpeech: "verb", phonetic: "/rɪˈfjuz/", priority: 30 },
  ],
  "证明": [
    { zh: "证明", en: "prove", meaning: "证明；证实", partOfSpeech: "verb", phonetic: "/pruv/", priority: 30 },
  ],
  "想象": [
    { zh: "想象", en: "imagine", meaning: "想象；设想", partOfSpeech: "verb", phonetic: "/ɪˈmædʒən/", priority: 20 },
    {
      zh: "想象",
      en: "imagination",
      meaning: "想象；想象力",
      partOfSpeech: "noun",
      phonetic: "/ɪˌmædʒəˈneɪʃən/",
      priority: 30,
      contextHints: ["想象力", "想象中", "想象空间", "超出想象"],
    },
  ],
  "永远": [
    { zh: "永远", en: "forever", meaning: "永远；总是", partOfSpeech: "adverb", phonetic: "/fɚˈɛvɚ/", priority: 30 },
  ],
  "肌肉": [
    { zh: "肌肉", en: "muscle", meaning: "肌肉；体力", partOfSpeech: "noun", phonetic: "/ˈmʌsəl/", priority: 30 },
  ],
  "另外": [
    { zh: "另外", en: "additionally", meaning: "另外；此外", partOfSpeech: "adverb", phonetic: "/əˈdɪʃənəli/", priority: 20 },
    {
      zh: "另外",
      en: "another",
      meaning: "另一个；另外的",
      partOfSpeech: "adjective",
      phonetic: "/əˈnʌðɚ/",
      priority: 30,
      contextHints: ["另外一", "另外两", "另外几", "另外的"],
    },
  ],
  "最近": [
    { zh: "最近", en: "recently", meaning: "最近；近来", partOfSpeech: "adverb", phonetic: "/ˈrisəntli/", priority: 20 },
    {
      zh: "最近",
      en: "recent",
      meaning: "最近的；近期的",
      partOfSpeech: "adjective",
      phonetic: "/ˈrisənt/",
      priority: 30,
      contextHints: ["最近的", "最近几", "最近一", "最近两"],
    },
    {
      zh: "最近",
      en: "nearest",
      meaning: "最近的；距离最短的",
      partOfSpeech: "adjective",
      phonetic: "/ˈnɪrəst/",
      priority: 40,
      contextHints: ["离我最近", "离你最近", "离他最近", "离她最近", "离得最近", "距离最近", "最近的出口", "最近的医院", "最近的汽车"],
    },
  ],
  "安排": [
    { zh: "安排", en: "arrange", meaning: "安排；筹备", partOfSpeech: "verb", phonetic: "/əˈreɪndʒ/", priority: 20 },
    {
      zh: "安排",
      en: "arrangement",
      meaning: "安排；布置",
      partOfSpeech: "noun",
      phonetic: "/əˈreɪndʒmənt/",
      priority: 30,
      contextHints: ["作了安排", "做出安排", "接受安排", "组织安排", "听从安排", "所有安排", "这个安排", "的安排", "安排就", "安排是", "睡觉安排"],
    },
  ],
  "活动": [
    { zh: "活动", en: "activity", meaning: "活动；行动", partOfSpeech: "noun", phonetic: "/ækˈtɪvəti/", priority: 20 },
    {
      zh: "活动",
      en: "move",
      meaning: "活动；移动",
      partOfSpeech: "verb",
      phonetic: "/muv/",
      priority: 30,
      contextHints: ["活动自己", "活动一下", "活动了", "左右活动", "活动手", "活动肩", "活动身体", "活动关节"],
    },
  ],
  "白色": [
    { zh: "白色", en: "white", meaning: "白色的", partOfSpeech: "adjective", phonetic: "/waɪt/", priority: 30 },
  ],
  "红色": [
    { zh: "红色", en: "red", meaning: "红色的", partOfSpeech: "adjective", phonetic: "/rɛd/", priority: 30 },
  ],
  "绿色": [
    { zh: "绿色", en: "green", meaning: "绿色的", partOfSpeech: "adjective", phonetic: "/ɡrin/", priority: 30 },
  ],
  "信任": [
    { zh: "信任", en: "trust", meaning: "信任；相信", partOfSpeech: "verb", phonetic: "/trʌst/", priority: 30 },
  ],
  "学生": [
    { zh: "学生", en: "student", meaning: "学生；学者", partOfSpeech: "noun", phonetic: "/ˈstudənt/", priority: 30 },
  ],
  "姿势": [
    { zh: "姿势", en: "posture", meaning: "姿势；姿态", partOfSpeech: "noun", phonetic: "/ˈpɑstʃɚ/", priority: 30 },
  ],
  "最大": [
    { zh: "最大", en: "maximum", meaning: "最大的；最大限度的", partOfSpeech: "adjective", phonetic: "/ˈmæksəməm/", priority: 30 },
  ],
  "有意": [
    { zh: "有意", en: "intentionally", meaning: "有意地；故意地", partOfSpeech: "adverb", phonetic: "/ɪnˈtɛnʃənəli/", priority: 30 },
  ],
  "同样": [
    { zh: "同样", en: "similarly", meaning: "同样地；相似地", partOfSpeech: "adverb", phonetic: "/ˈsɪmələrli/", priority: 20 },
    {
      zh: "同样",
      en: "same",
      meaning: "同样的；相同的",
      partOfSpeech: "adjective",
      phonetic: "/seɪm/",
      priority: 30,
      contextHints: ["同样的"],
    },
  ],
  "进行": [
    { zh: "进行", en: "conduct", meaning: "进行；实施", partOfSpeech: "verb", phonetic: "/kənˈdʌkt/", priority: 20 },
    {
      zh: "进行",
      en: "proceed",
      meaning: "继续进行；推进",
      partOfSpeech: "verb",
      phonetic: "/prəˈsid/",
      priority: 30,
      contextHints: ["进行下去", "继续进行", "正在进行", "进行中"],
    },
  ],
  "表现": [
    { zh: "表现", en: "perform", meaning: "表现；执行", partOfSpeech: "verb", phonetic: "/pɚˈfɔrm/", priority: 20 },
    {
      zh: "表现",
      en: "performance",
      meaning: "表现；行为；成绩",
      partOfSpeech: "noun",
      phonetic: "/pɚˈfɔrməns/",
      priority: 30,
      contextHints: ["的表现", "表现很好", "表现不错", "表现如何", "表现其实"],
    },
  ],
  "反应": [
    { zh: "反应", en: "reaction", meaning: "反应；反作用", partOfSpeech: "noun", phonetic: "/riˈækʃən/", priority: 20 },
    {
      zh: "反应",
      en: "react",
      meaning: "作出反应；反应过来",
      partOfSpeech: "verb",
      phonetic: "/riˈækt/",
      priority: 30,
      contextHints: ["反应过来", "反应不过来", "没反应过", "来不及反应"],
    },
  ],
  "说明": [
    { zh: "说明", en: "explain", meaning: "说明；解释", partOfSpeech: "verb", phonetic: "/ɪkˈspleɪn/", priority: 20 },
    {
      zh: "说明",
      en: "indicate",
      meaning: "表明；说明",
      partOfSpeech: "verb",
      phonetic: "/ˈɪndəˌkeɪt/",
      priority: 30,
      contextHints: ["这说明", "说明这", "说明了", "足以说明", "至少说明", "只能说明", "充分说明", "的话说明", "也说明", "就说明", "便说明"],
    },
  ],
  "目前": [
    { zh: "目前", en: "currently", meaning: "目前；现在", partOfSpeech: "adverb", phonetic: "/ˈkɝəntli/", priority: 20 },
    {
      zh: "目前",
      en: "current",
      meaning: "目前的；当前的",
      partOfSpeech: "adjective",
      phonetic: "/ˈkɝənt/",
      priority: 30,
      contextHints: ["目前的", "按目前", "目前情况", "目前状态", "目前阶段", "目前速度", "目前水平"],
    },
  ],
  "实际": [
    { zh: "实际", en: "actually", meaning: "实际上；事实上", partOfSpeech: "adverb", phonetic: "/ˈæktʃuəli/", priority: 20 },
    {
      zh: "实际",
      en: "actual",
      meaning: "实际的；真实的",
      partOfSpeech: "adjective",
      phonetic: "/ˈæktʃuəl/",
      priority: 30,
      contextHints: ["实际情况", "实际环境", "实际行动", "实际效果", "实际问题", "实际需要", "实际用途", "实际意义"],
    },
  ],
  "威胁": [
    { zh: "威胁", en: "threat", meaning: "威胁；危险", partOfSpeech: "noun", phonetic: "/θrɛt/", priority: 20 },
    {
      zh: "威胁",
      en: "threaten",
      meaning: "威胁；恐吓",
      partOfSpeech: "verb",
      phonetic: "/ˈθrɛtən/",
      priority: 30,
      contextHints: ["威胁了", "威胁他", "威胁她", "威胁我", "威胁你", "被威胁"],
    },
  ],
  "以前": [
    { zh: "以前", en: "previously", meaning: "以前；先前", partOfSpeech: "adverb", phonetic: "/ˈpriviəsli/", priority: 30 },
  ],
  "很少": [
    { zh: "很少", en: "rarely", meaning: "很少；不常", partOfSpeech: "adverb", phonetic: "/ˈrɛrli/", priority: 20 },
    {
      zh: "很少",
      en: "few",
      meaning: "很少的；少数的",
      partOfSpeech: "adjective",
      phonetic: "/fju/",
      priority: 30,
      contextHints: ["人很少", "话很少", "材料很少", "数量很少", "机会很少", "东西很少", "很少，", "很少。", "很少；", "很少！"],
    },
  ],
  "暴露": [
    { zh: "暴露", en: "expose", meaning: "暴露；揭露", partOfSpeech: "verb", phonetic: "/ɪkˈspoʊz/", priority: 20 },
    {
      zh: "暴露",
      en: "exposed",
      meaning: "暴露的；无遮蔽的",
      partOfSpeech: "adjective",
      phonetic: "/ɪkˈspoʊzd/",
      priority: 30,
      contextHints: ["暴露在"],
    },
  ],
  "发现": [
    { zh: "发现", en: "discover", meaning: "发现；找到", partOfSpeech: "verb", phonetic: "/dɪˈskʌvɚ/", priority: 20 },
    {
      zh: "发现",
      en: "notice",
      meaning: "注意到；察觉",
      partOfSpeech: "verb",
      phonetic: "/ˈnoʊtɪs/",
      priority: 30,
      contextHints: ["忽然发现", "突然发现", "发现他", "发现她", "发现有", "发现一个", "发现什么"],
    },
    {
      zh: "发现",
      en: "realize",
      meaning: "意识到；发觉",
      partOfSpeech: "verb",
      phonetic: "/ˈriəˌlaɪz/",
      priority: 40,
      contextHints: ["发现自己", "才发现", "这才发现"],
    },
  ],
  "开始": [
    { zh: "开始", en: "begin", meaning: "开始；着手", partOfSpeech: "verb", phonetic: "/bɪˈɡɪn/", priority: 20 },
    {
      zh: "开始",
      en: "beginning",
      meaning: "开始；开端",
      partOfSpeech: "noun",
      phonetic: "/bɪˈɡɪnɪŋ/",
      priority: 30,
      contextHints: ["开始的", "从一开始", "在开始时", "故事开始", "行动开始"],
    },
  ],
  "明显": [
    { zh: "明显", en: "obviously", meaning: "明显地；显然地", partOfSpeech: "adverb", phonetic: "/ˈɑbviəsli/", priority: 20 },
    {
      zh: "明显",
      en: "obvious",
      meaning: "明显的；显而易见的",
      partOfSpeech: "adjective",
      phonetic: "/ˈɑbviəs/",
      priority: 30,
      contextHints: ["很明显", "非常明显", "十分明显", "更加明显", "最明显", "不明显", "明显的"],
    },
  ],
  "小说": [
    { zh: "小说", en: "novel", meaning: "小说", partOfSpeech: "noun", phonetic: "/ˈnɑvəl/", priority: 30 },
  ],
  "人群": [
    { zh: "人群", en: "crowd", meaning: "人群；群众", partOfSpeech: "noun", phonetic: "/kraʊd/", priority: 30 },
  ],
  "类似": [
    { zh: "类似", en: "similar", meaning: "类似的；相似的", partOfSpeech: "adjective", phonetic: "/ˈsɪməlɚ/", priority: 30 },
  ],
  "内部": [
    { zh: "内部", en: "inside", meaning: "在内部；内部", partOfSpeech: "adverb", phonetic: "/ɪnˈsaɪd/", priority: 20 },
    {
      zh: "内部",
      en: "internal",
      meaning: "内部的；内在的",
      partOfSpeech: "adjective",
      phonetic: "/ɪnˈtɝnəl/",
      priority: 30,
      contextHints: ["内部情况", "内部结构", "内部空间", "内部人员", "内部系统", "内部消息", "内部矛盾", "内部环境"],
    },
  ],
  "调查": [
    { zh: "调查", en: "investigate", meaning: "调查；查明", partOfSpeech: "verb", phonetic: "/ɪnˈvɛstəˌɡeɪt/", priority: 20 },
    {
      zh: "调查",
      en: "investigation",
      meaning: "调查；调查研究",
      partOfSpeech: "noun",
      phonetic: "/ɪnˌvɛstəˈɡeɪʃən/",
      priority: 30,
      contextHints: ["的调查", "例行调查", "接受调查", "展开调查", "进行调查", "调查结果", "调查报告"],
    },
  ],
  "报告": [
    { zh: "报告", en: "report", meaning: "报告；汇报", partOfSpeech: "verb", phonetic: "/rɪˈpɔrt/", priority: 20 },
    {
      zh: "报告",
      en: "report",
      meaning: "报告；报告书",
      partOfSpeech: "noun",
      phonetic: "/rɪˈpɔrt/",
      priority: 30,
      contextHints: ["的报告", "一份报告", "这份报告", "调查报告", "打了报告", "提交报告", "报告里"],
    },
  ],
  "设计": [
    { zh: "设计", en: "design", meaning: "设计；构思", partOfSpeech: "verb", phonetic: "/dɪˈzaɪn/", priority: 20 },
    {
      zh: "设计",
      en: "design",
      meaning: "设计；设计方案",
      partOfSpeech: "noun",
      phonetic: "/dɪˈzaɪn/",
      priority: 30,
      contextHints: ["的设计", "设计思想", "设计方案", "设计院", "设计图", "设计师", "这种设计", "这个设计", "那个设计"],
    },
  ],
  "成功": [
    { zh: "成功", en: "succeed", meaning: "成功；达成目的", partOfSpeech: "verb", phonetic: "/səkˈsid/", priority: 20 },
    {
      zh: "成功",
      en: "success",
      meaning: "成功；成就",
      partOfSpeech: "noun",
      phonetic: "/səkˈsɛs/",
      priority: 30,
      contextHints: ["取得成功", "获得成功", "成功率", "成功的", "成功是"],
    },
    {
      zh: "成功",
      en: "successfully",
      meaning: "成功地；顺利地",
      partOfSpeech: "adverb",
      phonetic: "/səkˈsɛsfəli/",
      priority: 40,
      contextHints: ["成功完成", "成功通过", "成功上位", "成功击败", "成功逃脱", "成功进入", "成功获得", "成功解决", "成功实现", "成功与", "成功将", "成功把", "成功从"],
    },
  ],
  "喜欢": [
    { zh: "喜欢", en: "like", meaning: "喜欢；喜爱", partOfSpeech: "verb", phonetic: "/laɪk/", priority: 30 },
  ],
  "主要": [
    { zh: "主要", en: "mainly", meaning: "主要地；大体上", partOfSpeech: "adverb", phonetic: "/ˈmeɪnli/", priority: 20 },
    {
      zh: "主要",
      en: "main",
      meaning: "主要的；最重要的",
      partOfSpeech: "adjective",
      phonetic: "/meɪn/",
      priority: 30,
      contextHints: ["主要原因", "主要任务", "主要问题", "主要内容", "主要目标", "主要工作", "主要人员", "主要部分", "主要功能"],
    },
  ],
  "自由": [
    { zh: "自由", en: "freedom", meaning: "自由；自主", partOfSpeech: "noun", phonetic: "/ˈfridəm/", priority: 20 },
    {
      zh: "自由",
      en: "freely",
      meaning: "自由地；不受限制地",
      partOfSpeech: "adverb",
      phonetic: "/ˈfrili/",
      priority: 30,
      contextHints: ["自由下坠", "自由落体", "自由活动", "自由出入", "自由行动"],
    },
  ],
  "发出": [
    { zh: "发出", en: "emit", meaning: "发出；放射", partOfSpeech: "verb", phonetic: "/ɪˈmɪt/", priority: 20 },
    {
      zh: "发出",
      en: "make",
      meaning: "发出；产生",
      partOfSpeech: "verb",
      phonetic: "/meɪk/",
      priority: 30,
      contextHints: ["发出声音", "发出声响", "发出动静", "发出响声", "撞击声", "轰鸣声", "闷响"],
    },
    {
      zh: "发出",
      en: "let out",
      meaning: "发出；喊出",
      partOfSpeech: "verb",
      phonetic: "/lɛt aʊt/",
      priority: 40,
      contextHints: ["发出哀嚎", "发出惨嚎", "发出怒吼", "发出尖叫", "发出呻吟", "发出笑声", "发出哭声"],
    },
  ],
  "机械": [
    { zh: "机械", en: "mechanical", meaning: "机械的；机械般的", partOfSpeech: "adjective", phonetic: "/məˈkænɪkəl/", priority: 20 },
    {
      zh: "机械",
      en: "mechanically",
      meaning: "机械地；呆板地",
      partOfSpeech: "adverb",
      phonetic: "/məˈkænɪkli/",
      priority: 30,
      contextHints: ["机械捶", "机械敲", "机械道", "机械重复", "机械移动", "机械转动", "机械地"],
    },
  ],
  "希望": [
    { zh: "希望", en: "hope", meaning: "希望；期望", partOfSpeech: "verb", phonetic: "/hoʊp/", priority: 20 },
    {
      zh: "希望",
      en: "hope",
      meaning: "希望；期望的事",
      partOfSpeech: "noun",
      phonetic: "/hoʊp/",
      priority: 30,
      contextHints: ["没有希望", "的希望", "一线希望", "最后的希望", "还有希望", "希望是"],
    },
  ],
  "攻击": [
    { zh: "攻击", en: "attack", meaning: "攻击；袭击", partOfSpeech: "verb", phonetic: "/əˈtæk/", priority: 20 },
    {
      zh: "攻击",
      en: "attack",
      meaning: "攻击；袭击行为",
      partOfSpeech: "noun",
      phonetic: "/əˈtæk/",
      priority: 30,
      contextHints: ["的攻击", "受到攻击", "受到了攻击", "遭到攻击", "遭到了攻击", "引来的攻击", "仍是攻击", "攻击力", "一轮攻击"],
    },
  ],
  "计划": [
    { zh: "计划", en: "plan", meaning: "计划；打算", partOfSpeech: "verb", phonetic: "/plæn/", priority: 20 },
    {
      zh: "计划",
      en: "plan",
      meaning: "计划；方案",
      partOfSpeech: "noun",
      phonetic: "/plæn/",
      priority: 30,
      contextHints: ["的计划", "行动计划", "这个计划", "那个计划", "制定计划", "按照计划", "原定计划"],
    },
  ],
  "经历": [
    { zh: "经历", en: "undergo", meaning: "经历；经受", partOfSpeech: "verb", phonetic: "/ˌʌndɚˈɡoʊ/", priority: 20 },
    {
      zh: "经历",
      en: "experience",
      meaning: "经历；阅历",
      partOfSpeech: "noun",
      phonetic: "/ɪkˈspɪriəns/",
      priority: 30,
      contextHints: ["的经历", "自己经历", "这段经历", "那段经历", "过去经历", "个人经历"],
    },
  ],
  "危险": [
    { zh: "危险", en: "danger", meaning: "危险；风险", partOfSpeech: "noun", phonetic: "/ˈdeɪndʒɚ/", priority: 20 },
    {
      zh: "危险",
      en: "dangerous",
      meaning: "危险的；不安全的",
      partOfSpeech: "adjective",
      phonetic: "/ˈdeɪndʒərəs/",
      priority: 30,
      contextHints: ["危险区", "危险品", "危险人物", "危险动作", "危险情况", "很危险", "非常危险", "更加危险", "最危险"],
    },
  ],
  "怀疑": [
    { zh: "怀疑", en: "doubt", meaning: "怀疑；不相信", partOfSpeech: "verb", phonetic: "/daʊt/", priority: 20 },
    {
      zh: "怀疑",
      en: "doubt",
      meaning: "怀疑；疑虑",
      partOfSpeech: "noun",
      phonetic: "/daʊt/",
      priority: 30,
      contextHints: ["的怀疑", "产生怀疑", "表示怀疑", "抱有怀疑", "没有怀疑", "这种怀疑"],
    },
  ],
  "杀人": [
    { zh: "杀人", en: "kill", meaning: "杀人；致人死亡", partOfSpeech: "verb", phonetic: "/kɪl/", priority: 30 },
  ],
  "结束": [
    { zh: "结束", en: "end", meaning: "结束；终止", partOfSpeech: "verb", phonetic: "/ɛnd/", priority: 30 },
  ],
  "赶紧": [
    { zh: "赶紧", en: "quickly", meaning: "赶紧；赶快", partOfSpeech: "adverb", phonetic: "/ˈkwɪkli/", priority: 30 },
  ],
  "男子": [
    { zh: "男子", en: "man", meaning: "男子；男人", partOfSpeech: "noun", phonetic: "/mæn/", priority: 30 },
  ],
  "影响": [
    { zh: "影响", en: "affect", meaning: "影响；作用于", partOfSpeech: "verb", phonetic: "/əˈfɛkt/", priority: 20 },
    {
      zh: "影响",
      en: "influence",
      meaning: "影响；作用",
      partOfSpeech: "noun",
      phonetic: "/ˈɪnfluəns/",
      priority: 30,
      contextHints: ["的影响", "造成影响", "造成了影响", "很大影响", "产生影响", "产生了影响", "受到影响", "没有影响", "影响力"],
    },
  ],
  "后来": [
    { zh: "后来", en: "later", meaning: "后来；以后", partOfSpeech: "adverb", phonetic: "/ˈleɪtɚ/", priority: 30 },
  ],
  "正好": [
    { zh: "正好", en: "just", meaning: "正好；恰好", partOfSpeech: "adverb", phonetic: "/dʒʌst/", priority: 30 },
  ],
  "休息": [
    { zh: "休息", en: "rest", meaning: "休息；歇息", partOfSpeech: "verb", phonetic: "/rɛst/", priority: 20 },
    {
      zh: "休息",
      en: "rest",
      meaning: "休息；休息时间",
      partOfSpeech: "noun",
      phonetic: "/rɛst/",
      priority: 30,
      contextHints: ["的休息", "短暂休息", "休息时间", "休息室", "需要休息"],
    },
  ],
  "因此": [
    { zh: "因此", en: "therefore", meaning: "因此；所以", partOfSpeech: "adverb", phonetic: "/ˈðɛrˌfɔr/", priority: 30 },
  ],
  "安全": [
    { zh: "安全", en: "safe", meaning: "安全的；无危险的", partOfSpeech: "adjective", phonetic: "/seɪf/", priority: 20 },
    {
      zh: "安全",
      en: "safely",
      meaning: "安全地；平安地",
      partOfSpeech: "adverb",
      phonetic: "/ˈseɪfli/",
      priority: 30,
      contextHints: ["安全抵达", "安全到达", "安全返回", "安全离开", "安全护送", "安全通过", "安全度过"],
    },
  ],
  "麻烦": [
    { zh: "麻烦", en: "trouble", meaning: "麻烦；困难", partOfSpeech: "noun", phonetic: "/ˈtrʌbəl/", priority: 20 },
    {
      zh: "麻烦",
      en: "troublesome",
      meaning: "麻烦的；棘手的",
      partOfSpeech: "adjective",
      phonetic: "/ˈtrʌbəlsəm/",
      priority: 30,
      contextHints: ["很麻烦", "更麻烦", "非常麻烦", "十分麻烦", "太麻烦", "麻烦的"],
    },
  ],
  "反抗": [
    { zh: "反抗", en: "resist", meaning: "反抗；抵抗", partOfSpeech: "verb", phonetic: "/rɪˈzɪst/", priority: 20 },
    {
      zh: "反抗",
      en: "resistance",
      meaning: "反抗；抵抗行为",
      partOfSpeech: "noun",
      phonetic: "/rɪˈzɪstəns/",
      priority: 30,
      contextHints: ["的反抗", "任何反抗", "反抗的念头", "进行反抗", "发起反抗", "遭到反抗"],
    },
  ],
};

export function applyCuratedEntryOverrides(entries: Cet4Entry[]): Cet4Entry[] {
  const presentTerms = new Set(entries.map((entry) => entry.zh));
  const overriddenTerms = new Set(Object.keys(CURATED_ENTRY_OVERRIDES));
  const untouched = entries.filter((entry) => !overriddenTerms.has(entry.zh));
  const overrides = Object.entries(CURATED_ENTRY_OVERRIDES)
    .filter(([term]) => presentTerms.has(term))
    .flatMap(([, values]) => values);
  return [...untouched, ...overrides];
}
