import type {
  CanonicalQuestion,
  ProfileData,
  SiteContentData,
  SiteSnapshot
} from "./types.ts";

function hasText(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildSiteSnapshot(site: SiteContentData): SiteSnapshot {
  return {
    aboutLines: site.about.filter(hasText),
    contactLines: [
      `email: ${site.contact.email}`,
      ...(site.contact.github ? [`github: ${site.contact.github}`] : [])
    ]
  };
}

export function buildKvSeedMap(
  profile: ProfileData,
  canonicalQuestions: CanonicalQuestion[]
): Record<string, unknown> {
  const seedMap: Record<string, unknown> = {
    "profile:core": profile.profile,
    "education:list": profile.education,
    "work_experience:list": profile.workExperience,
    "projects:list": profile.projects,
    "publications:list": profile.publications,
    "awards:list": profile.awards,
    "skills:list": profile.skills,
    "contact:card": profile.contact,
    "canonical_questions:list": canonicalQuestions
  };

  for (const project of profile.projects) {
    seedMap[`project:${project.id}`] = project;
  }

  return seedMap;
}
