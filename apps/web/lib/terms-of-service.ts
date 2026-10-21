import termsContent from "@/content/terms-v2.json";
import { applyCurrentBrandName } from "@/lib/brand";
import type { CardGridSection, SiteSection } from "@/lib/site-builder";

export const TERMS_VERSION = "1.0-demo";
export const TERMS_EFFECTIVE_DATE = "2026-07-18";
export const TERMS_SOURCE_PARAGRAPH_COUNT = 13;
export const TERMS_SOURCE_TABLE_COUNT = 0;
export const TERMS_SOURCE_TABLE_CELL_COUNT = 0;

type TermsParagraph = {
  type: "paragraph";
  level: number | null;
  numId: number | null;
  sourceBlockIndex: number;
  sourceParagraphIndex: number;
  style: string;
  text: string;
};

type TermsTable = {
  type: "table";
  sourceBlockIndex: number;
  sourceTableIndex: number;
  headers: string[];
  rows: string[][];
};

export type TermsSourceBlock = TermsParagraph | TermsTable;

type TermsGroup = {
  id: string;
  blocks: TermsSourceBlock[];
  title: string;
};

const sourceBlocks = termsContent.blocks as TermsSourceBlock[];

export function getTermsSourceBlocks() {
  return structuredClone(sourceBlocks);
}

export function getTermsSourceParagraphs() {
  return sourceBlocks.filter((block): block is TermsParagraph => block.type === "paragraph").map((paragraph) => ({ ...paragraph }));
}

export function getTermsSourceTables() {
  return sourceBlocks.filter((block): block is TermsTable => block.type === "table").map((table) => structuredClone(table));
}

export function buildTermsSections(): SiteSection[] {
  const openingParagraphs = sourceBlocks.slice(0, 9);
  if (openingParagraphs.some((block) => block.type !== "paragraph")) throw new Error("TERMS_SOURCE_OPENING_INVALID");
  const [brand, title, subtitle, ...metadata] = openingParagraphs as TermsParagraph[];
  if (!brand || !title || !subtitle || metadata.length !== 6) throw new Error("TERMS_SOURCE_INCOMPLETE");

  return [
    {
      id: "terms-hero",
      type: "hero",
      visible: true,
      sortOrder: 0,
      eyebrow: applyCurrentBrandName(brand.text),
      title: applyCurrentBrandName(title.text),
      body: [subtitle.text, ...metadata.map((paragraph) => paragraph.text)].map(applyCurrentBrandName).join("\n"),
      action: { label: "浏览商品", pageKey: "shop" },
      features: [],
    },
    ...buildGroups(sourceBlocks.slice(9)).map((group, index) => ({
      id: group.id,
      type: "contentGrid" as const,
      visible: true,
      sortOrder: (index + 1) * 10,
      title: group.title,
      columns: 1 as const,
      items: buildItems(group),
    })),
  ];
}

function buildGroups(blocks: TermsSourceBlock[]) {
  const groups: TermsGroup[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph" && block.style === "Heading 1") {
      groups.push({
        id: `terms-part-${block.sourceParagraphIndex}`,
        blocks: [],
        title: applyCurrentBrandName(block.text),
      });
      continue;
    }
    const current = groups.at(-1);
    if (!current) throw new Error(`TERMS_GROUP_MISSING_AT_BLOCK_${block.sourceBlockIndex}`);
    current.blocks.push(block);
  }
  return groups;
}

function buildItems(group: TermsGroup): CardGridSection["items"] {
  const items: CardGridSection["items"] = [];
  let current = {
    body: [] as TermsParagraph[],
    id: `${group.id}-details`,
    title: "详细内容",
  };

  const flush = () => {
    if (current.body.length === 0) return;
    items.push({
      id: current.id,
      title: current.title,
      body: current.body.map(formatParagraph).join("\n"),
    });
    current = { body: [], id: `${group.id}-details-${items.length + 1}`, title: "详细内容" };
  };

  for (const block of group.blocks) {
    if (block.type === "table") {
      flush();
      items.push({
        id: `terms-table-${block.sourceTableIndex}`,
        title: block.headers.map(applyCurrentBrandName).join(" · "),
        body: block.rows.map((row) => row.map(applyCurrentBrandName).join(" · ")).join("\n"),
        table: {
          headers: block.headers.map(applyCurrentBrandName),
          rows: block.rows.map((row) => row.map(applyCurrentBrandName)),
        },
      });
      continue;
    }
    if (block.style === "Clause Title" || block.style === "Heading 2") {
      flush();
      current = {
        body: [],
        id: `terms-clause-${block.sourceParagraphIndex}`,
        title: applyCurrentBrandName(block.text),
      };
      continue;
    }
    current.body.push(block);
  }
  flush();
  return items;
}

function formatParagraph(paragraph: TermsParagraph) {
  const text = applyCurrentBrandName(paragraph.text);
  if (paragraph.style === "Legal Notice") return `! ${text}`;
  if (["List Bullet", "List Number", "TOC Entry"].includes(paragraph.style) || paragraph.numId !== null) return `• ${text}`;
  return text;
}
