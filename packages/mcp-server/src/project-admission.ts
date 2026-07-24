import type { Project } from '@the-vault/core';

export interface ProjectLookup {
  getProject(name: string): Project | null;
}

export function requireTypedProjectForAgentWrite(
  projects: ProjectLookup,
  projectName: string,
): Project {
  const project = projects.getProject(projectName);

  if (!project) {
    throw new Error(
      `Project "${projectName}" does not exist. Call vault_create_project first and explicitly choose project_type "work_project" or "brain_context".`,
    );
  }

  if (project.projectType === 'unclassified') {
    throw new Error(
      `Project "${projectName}" is unclassified. Classify it as "work_project" or "brain_context" before an agent writes to it.`,
    );
  }

  return project;
}
