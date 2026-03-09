export interface SkillWorkflowRef {
  path: string;
  name?: string;
  description: string;
  fileId?: string;
  inputVariables?: string[]; // variables used but not initialized by any node
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
