export interface ProfileCore {
  name: string;
  nativeName: string;
  role: string;
  organization: string;
  current: string;
  focus: string;
  summary: string;
  keywords: string[];
  location: string;
}

export interface EducationEntry {
  id: string;
  institution: string;
  degree: string;
  field: string;
  period: string;
  focus: string;
  honors: string[];
}

export interface WorkExperienceEntry {
  id: string;
  company: string;
  role: string;
  period: string;
  summary: string;
  details: string[];
}

export interface ProjectEntry {
  id: string;
  name: string;
  period: string;
  summary: string;
  tags: string[];
  details: string[];
}

export interface PublicationEntry {
  id: string;
  title: string;
  venue: string;
  year: number;
  summary: string;
  notes: string;
}

export interface AwardEntry {
  id: string;
  title: string;
  issuer: string;
  year: number;
  summary: string;
}

export interface SkillGroup {
  category: string;
  items: string[];
}

export interface ContactCard {
  email: string;
  github: string;
}

export interface SiteContentData {
  about: string[];
  contact: ContactCard;
}

export interface ProfileData {
  profile: ProfileCore;
  education: EducationEntry[];
  workExperience: WorkExperienceEntry[];
  projects: ProjectEntry[];
  publications: PublicationEntry[];
  awards: AwardEntry[];
  skills: SkillGroup[];
  contact: ContactCard;
}

export type ToolName =
  | "get_profile"
  | "get_education"
  | "get_work_experience"
  | "get_projects"
  | "get_publications"
  | "get_awards"
  | "get_skills"
  | "get_contact";

export interface ToolHint {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface CanonicalQuestion {
  id: string;
  intent:
    | "profile"
    | "education"
    | "work_experience"
    | "projects"
    | "publications"
    | "awards"
    | "skills"
    | "contact";
  question: string;
  toolHints: ToolHint[];
}

export interface SiteSnapshot {
  aboutLines: string[];
  contactLines: string[];
}

export interface ConversationTurn {
  user: string;
  assistant: string;
}

export interface AskRequest {
  message: string;
  sessionId?: string;
  history?: ConversationTurn[];
}

export interface MetaEventPayload {
  requestId: string;
  matchedIntent: string | null;
  remainingDailyQuota: number;
  semanticScore?: number | null;
}

export interface ToolEventPayload {
  name: ToolName;
  message: string;
}

export interface ErrorEventPayload {
  code:
    | "bad_request"
    | "unsupported_language"
    | "rate_limited"
    | "banned"
    | "semantic_reject"
    | "abuse_blocked"
    | "llm_error";
  message: string;
}

export type SseEvent =
  | {
      event: "meta";
      data: MetaEventPayload;
    }
  | {
      event: "token";
      data: {
        text: string;
      };
    }
  | {
      event: "tool";
      data: ToolEventPayload;
    }
  | {
      event: "error";
      data: ErrorEventPayload;
    }
  | {
      event: "done";
      data: {
        requestId: string;
      };
    };
