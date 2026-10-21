import type { MemberOperationsConfig } from "@/lib/commerce/member-operations";

type Survey = MemberOperationsConfig["surveys"][number];
type Question = Survey["questions"][number];
const single = (id: string, title: string, options: string[], required = false): Question => ({ id, title, type: "SINGLE", required, options });
const multiple = (id: string, title: string, options: string[], required = false): Question => ({ id, title, type: "MULTIPLE", required, options });
const written = (id: string, title: string, required = false): Question => ({ id, title, type: "TEXT", required, options: [] });

// The original IDs and options stay stable for existing clients and saved answers.
// Additional questions are optional: members may skip details they do not wish to share.
export function defaultMemberSurveys(): Survey[] {
  return [
    { id: "PREFERENCES", title: "穿着偏好", enabled: false, questions: [
      single("fit", "你偏好的穿着感受", ["贴身", "适中", "宽松"], true),
      multiple("focus", "你更关注哪些方面", ["透气", "柔软", "支撑", "耐穿"], true),
      single("cut", "你平时更常选择哪种版型？", ["三角", "短平角", "中长平角", "长平角", "没有固定偏好"]),
      single("size", "你通常选择什么尺码？", ["S", "M", "L", "XL", "XXL及以上", "不确定"]),
      single("waist", "腰部包裹感，你更喜欢哪一种？", ["柔软无勒感", "适中包裹", "稳定不易滑落", "没有特别偏好"]),
      multiple("fabric", "你更偏好哪些面料感受？", ["亲肤棉感", "莫代尔或莱赛尔的柔软感", "轻薄速干", "弹性包裹", "愿意尝试不同面料"]),
      multiple("scene", "你主要会在哪些场景穿着？", ["日常通勤", "久坐工作或学习", "运动健身", "户外出行", "居家休息"]),
      multiple("concern", "穿着时，你想改善哪些问题？", ["闷热", "卷边或移位", "勒腰", "摩擦", "支撑不足", "没有明显困扰"]),
      single("frequency", "你通常多久添置一次贴身衣物？", ["约1至3个月", "约4至6个月", "约7至12个月", "没有固定频率"]),
      written("suggestion", "关于舒适度或版型，还有什么想告诉我们？"),
    ] },
    { id: "STYLE_SURVEY", title: "会员风格问卷", enabled: false, questions: [
      single("style", "你偏好的产品风格", ["简洁日常", "运动", "经典"], true),
      written("color", "你喜欢的颜色"),
      single("pattern", "你更偏好哪种图案表达？", ["纯色", "细条纹或小图案", "明显的图案", "没有特别偏好"]),
      multiple("palette", "哪些色系更容易吸引你？", ["黑白灰", "浅色", "大地色", "深色", "亮色"]),
      single("design", "选择新款时，你更看重哪种设计？", ["基础简洁", "运动机能", "细节与质感", "复古经典", "愿意尝试不同设计"]),
      single("branding", "品牌标识，你更喜欢怎样呈现？", ["低调不显标识", "小面积品牌标识", "明显品牌标识", "没有特别偏好"]),
      multiple("occasion", "你希望产品适合哪些生活场景？", ["日常穿搭", "工作或学习", "运动", "旅行", "居家"]),
      multiple("decision", "哪些因素最影响你的购买决定？", ["穿着舒适", "款式设计", "面料品质", "耐用程度", "品牌理念", "价格"]),
      single("budget", "通常会考虑怎样的单件价格范围？", ["50元以下", "50至99元", "100至199元", "200元及以上", "按具体产品决定"]),
      written("expectation", "你还想看到什么颜色、版型或设计？"),
    ] },
    { id: "UNDERWEAR_SURVEY", title: "内裤体验问卷", enabled: false, questions: [
      single("wear", "你日常最常穿的内裤款式", ["三角", "平角", "其他"], true),
      written("experience", "你希望改善哪些穿着体验", true),
    ] },
  ];
}

const legacyQuestions: Partial<Record<Survey["id"], Question[]>> = {
  PREFERENCES: [single("fit", "你偏好的穿着感受", ["贴身", "适中", "宽松"], true), multiple("focus", "你更关注哪些方面", ["透气", "柔软", "支撑", "耐穿"], true)],
  STYLE_SURVEY: [single("style", "你偏好的产品风格", ["简洁日常", "运动", "经典"], true), written("color", "你喜欢的颜色")],
};
function sameQuestions(left: Question[], right: Question[]) {
  return left.length === right.length && left.every((question, index) => {
    const other = right[index];
    return question.id === other.id && question.title === other.title && question.type === other.type && question.required === other.required
      && question.options.length === other.options.length && question.options.every((value, optionIndex) => value === other.options[optionIndex]);
  });
}

/** A read-time upgrade of exact old defaults; no settings, records or rewards are written. */
export function upgradeLegacyMemberSurveys(config: MemberOperationsConfig): MemberOperationsConfig {
  const defaults = defaultMemberSurveys();
  let changed = false;
  const surveys = config.surveys.map(survey => {
    const legacy = legacyQuestions[survey.id];
    if (!legacy || !sameQuestions(survey.questions, legacy)) return survey;
    changed = true;
    return { ...survey, questions: defaults.find(item => item.id === survey.id)!.questions };
  });
  return changed ? { ...config, surveys } : config;
}
