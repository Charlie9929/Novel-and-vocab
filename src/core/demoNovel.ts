import type { LocalNovel } from "./types";

/** Fingerprint of the retired built-in Journey-to-the-West demo. */
export const LEGACY_DEMO_FINGERPRINT = "demo-builtin-v1";

/**
 * Keep a small, self-contained demo in the public app bundle. The longer
 * locally drafted AI-novel export is intentionally not a build dependency:
 * it may remain on the author's machine and must never be uploaded just to
 * make the demo button work on a clean deployment checkout.
 */
const DEMO_TEXT = `第一章 退潮的蓝门

林遥回到海岬镇，打开了外婆留下的灯塔看守屋。屋顶漏雨，窗框生锈，桌上却整齐放着一叠按日期排好的明信片。她本来只想卖掉房子，清完东西就回城，却在最低潮时看见礁石间露出一扇蓝色木门。

门上刻着一句话：未寄出的信，在这里等下一次退潮。林遥摸了摸外套内袋里那封写了十六年、从未寄出的信，第一次觉得自己或许可以把故事重新打开。

第二章 地址已经改变

蓝门后是一间安静的邮局。周砚告诉她，邮局不改变过去，只把信送到收信人愿意面对关系的时刻。林遥没有立刻投递旧信，而是沿着堤岸去找父亲留下的旧地址。

她在船坞里见到林岑。两个人隔着十六年的沉默站了很久，谁也没有先道歉。林遥终于问出那句藏了多年的话：你当时是不是也不想走？

第三章 寄给现在的人

林岑没有打开旧信，只把它收进工具箱，说自己会帮忙修好灯塔的屋顶。林遥看着潮水漫过蓝门的位置，明白有些信不必寄回过去；只要有人肯听，它就已经抵达了现在。

她回到看守屋，重新整理那些明信片。这一次，她没有急着把房子挂牌，也没有急着离开。窗外潮声渐远，桌上的灯亮了起来。`;

export function makeDemoNovel(): LocalNovel {
  return {
    fileName: "潮汐邮局 · 五库试读.txt",
    fileSize: new Blob([DEMO_TEXT]).size,
    lastModified: Date.now(),
    fingerprint: "demo-builtin-v2-tide-post-office",
    text: DEMO_TEXT,
  };
}
