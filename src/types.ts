// Shared TypeScript types for job-pilot

export interface JobRow {
  url: string;
  company: string;
  role: string;
  notes: string;
}

export interface JobDescription {
  url: string;
  company: string;
  role: string;
  rawText: string;
  skills: string[];
  requirements: string[];
  niceToHave: string[];
  culture: string[];
  atsType: "greenhouse" | "lever" | "ashby" | "workday" | "unknown";
}

export interface Contact {
  name: string;
  email: string;
  title: string;
  linkedin?: string;
  source: "hunter" | "duckduckgo" | "linkedin_scrape";
  confidence: "high" | "medium" | "low";
}

export interface OutreachResult {
  contact: Contact;
  emailDraft: string;
  linkedinNote: string;
  emailSent: boolean;
  emailError?: string;
}

export interface TailorResult {
  tailoredLatex: string;
  pdfPath: string;
  keyChanges: string[];
}

export interface ApplicationResult {
  success: boolean;
  screenshotPath?: string;
  error?: string;
  skippedReason?: string;
}

export interface RunLog {
  timestamp: string;
  job: JobRow;
  jobDescription?: Partial<JobDescription>;
  tailorResult?: Partial<TailorResult>;
  applicationResult?: ApplicationResult;
  contacts?: Contact[];
  outreachResults?: OutreachResult[];
  durationMs: number;
  error?: string;
}

export interface Config {
  keys: {
    anthropic: string;
    hunter: string;
    gmail_user: string;
    gmail_app_password: string;
  };
  candidate: {
    name: string;
    email: string;
    phone: string;
    linkedin: string;
    github: string;
    experience_years: number;
    visa: string;
    target_roles: string[];
  };
  settings: {
    review_threshold: number;
    runs_completed: number;
    headless_after_review: boolean;
    default_model: string;
    output_dir: string;
    logs_dir: string;
    resume_base: string;
    max_contacts_per_job: number;
  };
  outreach: {
    email_subject_template: string;
    follow_up_days: number;
  };
}

export interface PipelineOptions {
  dryRun: boolean;
  skipApply: boolean;
  skipOutreach: boolean;
  company?: string;
  verbose: boolean;
}
