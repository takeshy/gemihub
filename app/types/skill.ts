export interface SkillWorkflowRef {
  path: string;
  name?: string;
  description: string;
}

export interface SkillMetadata {
  id: string;
  folderId: string;
  skillMdFileId: string;
  name: string;
  description: string;
  workflows: SkillWorkflowRef[];
}

export interface LoadedSkill extends SkillMetadata {
  instructions: string;
  references: string[];
}
