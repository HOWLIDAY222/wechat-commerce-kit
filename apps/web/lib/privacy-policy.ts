import privacyPolicyContent from "@/content/privacy-policy-v2.json";
import { applyCurrentBrandName } from "@/lib/brand";
import type { SiteSection } from "@/lib/site-builder";

export const PRIVACY_POLICY_VERSION = "1.0-demo";
export const PRIVACY_POLICY_EFFECTIVE_DATE = "2026-10-21";
export const PRIVACY_POLICY_CONSENT_VERSION = `privacy-v${PRIVACY_POLICY_VERSION}-${PRIVACY_POLICY_EFFECTIVE_DATE}`;
export const PRIVACY_POLICY_SOURCE_PARAGRAPH_COUNT = 8;

type PolicyParagraph = {
  level: number | null;
  numId: number | null;
  sourceIndex: number;
  style: string;
  text: string;
};

type PolicyGroup = {
  id: string;
  paragraphs: PolicyParagraph[];
  title: string;
};

const policyParagraphs = privacyPolicyContent.paragraphs as PolicyParagraph[];

export function hasCurrentPrivacyConsent(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const input = value as { crossBorderConsent?: unknown; privacyConsentVersion?: unknown };
  return input.crossBorderConsent === true && input.privacyConsentVersion === PRIVACY_POLICY_CONSENT_VERSION;
}

export function getPrivacyPolicySourceParagraphs() {
  return policyParagraphs.map((paragraph) => ({ ...paragraph }));
}

export function buildPrivacyPolicySections(): SiteSection[] {
  const [title, metadata, ...content] = policyParagraphs;
  if (!title || !metadata) throw new Error("PRIVACY_POLICY_SOURCE_INCOMPLETE");

  return [
    {
      id: "privacy-hero",
      type: "hero",
      visible: true,
      sortOrder: 0,
      eyebrow: `隐私政策 · V${PRIVACY_POLICY_VERSION}`,
      title: applyCurrentBrandName(title.text),
      body: applyCurrentBrandName(metadata.text),
      action: { label: "浏览商品", pageKey: "shop" },
      features: [],
    },
    ...buildPolicyGroups(content).map((group, index) => ({
      id: group.id,
      type: "contentGrid" as const,
      visible: true,
      sortOrder: (index + 1) * 10,
      title: group.title,
      columns: 1 as const,
      items: buildPolicyItems(group),
    })),
  ];
}

function buildPolicyGroups(paragraphs: PolicyParagraph[]) {
  const groups: PolicyGroup[] = [{ id: "privacy-general", paragraphs: [], title: "总则" }];
  for (const paragraph of paragraphs) {
    if (paragraph.style === "Heading 1") {
      groups.push({
        id: `privacy-part-${paragraph.sourceIndex}`,
        paragraphs: [],
        title: applyCurrentBrandName(paragraph.text),
      });
      continue;
    }
    groups.at(-1)?.paragraphs.push(paragraph);
  }
  return groups.filter((group) => group.paragraphs.length > 0);
}

function buildPolicyItems(group: PolicyGroup) {
  const items: Array<{ body: PolicyParagraph[]; id: string; title: string }> = [];
  let current = {
    body: [] as PolicyParagraph[],
    id: `${group.id}-details`,
    title: "详细内容",
  };

  for (const paragraph of group.paragraphs) {
    if (paragraph.style === "Heading 2") {
      if (current.body.length > 0) items.push(current);
      current = {
        body: [],
        id: `privacy-clause-${paragraph.sourceIndex}`,
        title: applyCurrentBrandName(paragraph.text),
      };
      continue;
    }
    current.body.push(paragraph);
  }
  if (current.body.length > 0) items.push(current);

  return items.map((item) => ({
    id: item.id,
    title: item.title,
    body: item.body.map(formatPolicyParagraph).join("\n"),
  }));
}

function formatPolicyParagraph(paragraph: PolicyParagraph) {
  const text = applyCurrentBrandName(paragraph.text);
  if (paragraph.style === "Heading 3") return `§ ${text}`;
  if (paragraph.numId !== null) return `• ${text}`;
  return text;
}
