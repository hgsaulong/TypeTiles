export type WordCategory = "corporate" | "communication" | "records" | "accounting" | "technology" | "general" | "stenography" | "medical" | "legal";

export type GreggPrompt = {
  id: string;
  answer: string;
  image: string;
  difficulty: "Easy" | "Normal" | "Hard";
};

export const WORD_BANK: Record<WordCategory, string[]> = {
  corporate: [
  "company", "business", "manager", "employee", "executive", "meeting", "office", "client", "project", "strategy", "management", "partnership",
  "leadership", "organization", "enterprise", "proposal", "contract", "department", "performance", "productivity", "staff", "team", "work",
  "job", "boss", "desk", "firm", "career", "workplace", "supervisor", "policy", "corporation", "administration", "entrepreneurship",
  "professionalism", "accountability", "stakeholder", "deadline", "planning", "budget", "resource", "workflow", "training", "report", "goal",
  "target", "industry", "promotion", "salary", "workforce"
],

communication: [
  "message", "conversation", "discussion", "information", "communication", "speaking", "listening", "writing", "language", "feedback", "presentation", "announcement",
  "interview", "correspondence", "interaction", "dialogue", "expression", "explanation", "question", "response", "talk", "call", "reply",
  "chat", "voice", "note", "read", "write", "speak", "send", "email", "meeting", "letter", "report", "request", "confidentiality",
  "negotiation", "interpretation", "collaboration", "professionalism", "documentation", "clarification", "statement", "speaker", "channel", "contact",
  "briefing", "instruction", "conversation"
],

records: [
  "document", "file", "record", "archive", "folder", "report", "database", "storage", "retrieval", "index", "register", "receipt",
  "certificate", "reference", "history", "transaction", "documentation", "classification", "confidential", "verification", "data", "copy", "form",
  "list", "note", "paper", "log", "name", "date", "filing", "tracking", "preservation", "retention", "confidentiality", "organization",
  "digitization", "disposition", "authentication", "accessibility", "catalog", "entry", "label", "version", "source", "backup", "submission",
  "approval", "identifier", "register"
],

accounting: [
  "account", "balance", "budget", "expense", "income", "revenue", "profit", "loss", "invoice", "payment", "tax", "audit",
  "asset", "liability", "capital", "payroll", "financial", "transaction", "cashflow", "ledger", "cash", "cost", "sale",
  "pay", "bill", "loan", "bank", "debt", "price", "receipt", "accounting", "expenditure", "reconciliation", "depreciation", "receivables",
  "bookkeeping", "auditability", "credit", "debit", "fund", "forecast", "interest", "savings", "finance", "purchase", "earnings",
  "equity", "statement", "currency", "investment"
],

technology: [
  "computer", "software", "hardware", "internet", "network", "database", "system", "program", "application", "website", "server", "security",
  "password", "digital", "technology", "artificial", "intelligence", "cloud", "data", "programming", "file", "mouse", "screen", "click",
  "email", "app", "web", "scan", "keyboard", "printer", "information", "cybersecurity", "automation", "encryption", "integration",
  "accessibility", "infrastructure", "connectivity", "browser", "coding", "developer", "framework", "storage", "networking", "processor", "device",
  "software", "hardware"
],

general: [
  "school", "student", "family", "community", "people", "country", "environment", "education", "health", "knowledge", "experience",
  "important", "different", "information", "development", "opportunity", "responsibility", "success", "activity", "situation", "class", "work",
  "task", "time", "goal", "plan", "skill", "team", "subject", "project", "schedule", "deadline", "practice", "training",
  "productivity", "career", "professionalism", "organization", "leadership", "performance", "cooperation", "efficiency", "competency", "communication", "future",
  "problem", "solution", "progress", "challenge"
],

stenography: [],

medical: [
  "doctor", "nurse", "patient", "clinic", "hospital", "health", "medicine", "symptom", "diagnosis", "treatment", "surgery", "therapy",
  "disease", "infection", "vaccine", "allergy", "fever", "cough", "wound", "injury", "fracture", "bandage", "heartbeat", "pulse",
  "blood", "oxygen", "breathing", "recovery", "prescription", "pharmacy", "emergency", "ambulance", "examination", "laboratory", "specimen", "radiology",
  "anatomy", "skeleton", "muscle", "tissue", "organ", "nutrition", "diabetes", "migraine", "anesthesia", "surgeon", "pediatric", "chronic",
  "wellness", "prevention"
],

legal: [
  "lawyer", "judge", "court", "justice", "legal", "law", "case", "trial", "verdict", "witness", "evidence", "testimony",
  "defendant", "plaintiff", "attorney", "lawsuit", "appeal", "hearing", "sentence", "bail", "contract", "agreement", "clause", "document",
  "affidavit", "notary", "notarize", "signature", "complaint", "petition", "motion", "statute", "regulation", "legislation", "constitution", "rights",
  "liability", "property", "ownership", "inheritance", "probate", "custody", "divorce", "mediation", "arbitration", "prosecution", "defense", "jurisdiction",
  "settlement", "judgment"
],
};

// Verified Gregg shorthand assets and prompt mappings must be supplied before gameplay is enabled.
export const GREGG_PROMPTS: GreggPrompt[] = [];

export const WORD_CATEGORIES = Object.keys(WORD_BANK) as WordCategory[];

export function getWordCategory(value: string): WordCategory {
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "corporate") return "corporate";
  if (normalized === "communication" || normalized === "communicate") return "communication";
  if (normalized === "records") return "records";
  if (normalized === "accounting") return "accounting";
  if (normalized === "technology") return "technology";
  if (normalized === "medical") return "medical";
  if (normalized === "legal") return "legal";
  if (normalized === "steno " || normalized === "greggshorthand") return "stenography";
  return "general";
}

export function getDifficultyKey(difficulty: string): "easy" | "normal" | "hard" | null {
  const normalized = difficulty.toLowerCase();
  if (normalized === "easy") return "easy";
  if (normalized === "normal") return "normal";
  if (normalized === "hard" || normalized === "extreme") return "hard";
  return null;
}

export const DIFFICULTY_WORD_LENGTHS = {
  easy: { minimumLength: 1, maximumLength: 4 },
  normal: { minimumLength: 5, maximumLength: 7 },
  hard: { minimumLength: 6, maximumLength: Number.POSITIVE_INFINITY },
} as const;

export function getWordsForDifficulty(category: WordCategory, difficulty: "easy" | "normal" | "hard"): string[] {
  if (category === "stenography") {
    return GREGG_PROMPTS
      .filter((prompt) => prompt.difficulty.toLowerCase() === difficulty)
      .map((prompt) => prompt.answer);
  }

  const range = DIFFICULTY_WORD_LENGTHS[difficulty];
  const categoryWords = WORD_BANK[category];
  const filtered = categoryWords.filter((word) => word.length >= range.minimumLength && word.length <= range.maximumLength);
  return filtered.length > 0 ? filtered : categoryWords;
}
