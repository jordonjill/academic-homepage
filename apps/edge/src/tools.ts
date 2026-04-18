import type {
  AwardEntry,
  ContactCard,
  EducationEntry,
  ProfileCore,
  ProjectEntry,
  PublicationEntry,
  SkillGroup,
  ToolName,
  WorkExperienceEntry
} from "@academic-homepage/shared";

import type { Env } from "./env.ts";

async function getKvJson<T>(
  env: Env,
  key: string
): Promise<T> {
  if (!env.PROFILE_KV) {
    throw new Error("content unavailable. required content store is unavailable.");
  }

  const value = await env.PROFILE_KV.get<T>(key, "json");
  if (value !== null) {
    return value;
  }

  throw new Error("content unavailable. required content store is unavailable.");
}

function normalizeLimit(limit: unknown, fallback = 5) {
  const parsed = Number(limit ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

export function describeToolEvent(name: ToolName) {
  switch (name) {
    case "get_profile":
      return "loading profile...";
    case "get_education":
      return "loading education...";
    case "get_work_experience":
      return "loading work experience...";
    case "get_projects":
      return "loading projects...";
    case "get_publications":
      return "loading publications...";
    case "get_awards":
      return "loading awards...";
    case "get_skills":
      return "loading skills...";
    case "get_contact":
      return "loading contact info...";
    default:
      return "loading data...";
  }
}

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_profile",
      description: "Get the core profile summary for the owner of the homepage.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_education",
      description: "Get education entries, optionally capped by limit.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_work_experience",
      description: "Get work experience entries, optionally capped by limit.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_projects",
      description: "Get all projects or one project by projectId.",
      parameters: {
        type: "object",
        properties: {
          projectId: {
            type: "string"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_publications",
      description: "Get publications, optionally capped by limit.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_awards",
      description: "Get awards and honors, optionally capped by limit.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_skills",
      description: "Get grouped skill areas and high-level strengths.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_contact",
      description: "Get public contact information.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  }
] as const;

export async function executeTool(
  env: Env,
  name: ToolName,
  args: Record<string, unknown>
) {
  switch (name) {
    case "get_profile": {
      const profile = await getKvJson<ProfileCore>(env, "profile:core");
      return { profile };
    }
    case "get_education": {
      const limit = normalizeLimit(args.limit, 10);
      const entries = await getKvJson<EducationEntry[]>(env, "education:list");
      return { entries: entries.slice(0, limit) };
    }
    case "get_work_experience": {
      const limit = normalizeLimit(args.limit, 10);
      const entries = await getKvJson<WorkExperienceEntry[]>(
        env,
        "work_experience:list"
      );
      return { entries: entries.slice(0, limit) };
    }
    case "get_projects": {
      const projectId = typeof args.projectId === "string" ? args.projectId : null;
      if (projectId) {
        if (!env.PROFILE_KV) {
          throw new Error("content unavailable. required content store is unavailable.");
        }

        const project = await env.PROFILE_KV.get<ProjectEntry | null>(
          `project:${projectId}`,
          "json"
        );

        return {
          project
        };
      }

      const entries = await getKvJson<ProjectEntry[]>(env, "projects:list");
      return { entries };
    }
    case "get_publications": {
      const limit = normalizeLimit(args.limit, 5);
      const entries = await getKvJson<PublicationEntry[]>(env, "publications:list");
      return { entries: entries.slice(0, limit) };
    }
    case "get_awards": {
      const limit = normalizeLimit(args.limit, 10);
      const entries = await getKvJson<AwardEntry[]>(env, "awards:list");
      return { entries: entries.slice(0, limit) };
    }
    case "get_skills": {
      const groups = await getKvJson<SkillGroup[]>(env, "skills:list");
      return { groups };
    }
    case "get_contact": {
      const contact = await getKvJson<ContactCard>(env, "contact:card");
      return { contact };
    }
    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}
