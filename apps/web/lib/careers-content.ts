export type TalentRole = {
  id: string; zh: string; en: string; youth?: boolean; creative?: boolean;
  tags: [string, string]; intro: [string, string]; duties: [string[], string[]]; evidence: [string, string];
};

export const talentRoles: TalentRole[] = [];

export const talentRoleIds = [...talentRoles.map(role => role.id), "open-introduction"];
export const getTalentRole = (id: string) => talentRoles.find(role => role.id === id);
