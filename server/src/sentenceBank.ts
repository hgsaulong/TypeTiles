export type PracticeFormat = "word-phrase" | "full-sentence";
export const SENTENCE_BANK = {
  corporate: [
    "Draft the board meeting agenda and distribute it to all directors.",
    "The corporate secretary recorded precise minutes of the meeting.",
    "Adhere to corporate governance policies and regulatory standards.",
    "Executive assistants coordinate high-level schedules for senior officers.",
    "Strategic planning sessions align corporate goals across departments.",
    "Prepare the annual corporate report for the upcoming stockholders' meeting.",
    "Executive etiquette and diplomacy are vital in international trade.",
    "Non-disclosure agreements protect sensitive corporate information.",
    "Organizers ensured corporate travel itineraries were fully confirmed.",
    "Sound leadership and compliance drive sustainable corporate success.",
  ],
  communication: [
    "Please review the attached memo before our team meeting.",
    "Effective communication builds strong relationships with clients.",
    "She sent a clear follow-up email to clarify the contract terms.",
    "Always maintain a professional tone in written correspondence.",
    "Promptly respond to customer inquiries with complete information.",
    "Good active listening skills are essential for office leaders.",
    "Active listening helps resolve workplace conflicts efficiently.",
    "The executive manager delivered a persuasive project proposal.",
    "Please draft a polite reply to the client's urgent request.",
    "Clear verbal instructions help prevent workplace misunderstandings.",
  ],
  records: [
    "File all client documents according to the alphabetic system.",
    "Proper document organization improves overall office efficiency.",
    "Ensure confidential records are securely locked in cabinets.",
    "Archives must be regularly updated to prevent data loss.",
    "Indexing files correctly speeds up the retrieval process.",
    "The administrative assistant digitized all paper records today.",
    "Cross-referencing files helps locate misplaced documents quickly.",
    "Retain all financial records according to company policy.",
    "Backup digital files to prevent accidental loss of information.",
    "Systematically purging old files keeps the database clean.",
  ],
  accounting: [
    "The accountant balanced the ledger before the end of the day.",
    "Verify all numbers on the invoice before releasing payment.",
    "Petty cash vouchers must be signed by the department supervisor.",
    "Accurately calculate employee overtime pay for this period.",
    "The quarterly balance sheet shows a steady increase in profit.",
    "Track all daily business expenses carefully in the spreadsheet.",
    "Discrepancies in the audit report were resolved immediately.",
    "Accounts payable should be settled before the due date.",
    "Generate a monthly budget summary for executive review.",
    "Financial statements require double-checking for exact accuracy.",
  ],
  technology: [
    "Master keyboard shortcuts to increase your daily typing speed.",
    "Always log out of your workstation when leaving your desk.",
    "Learn to use spreadsheet functions to automate data analysis.",
    "Regularly update software applications to keep systems secure.",
    "Cloud storage allows seamless file sharing across departments.",
    "Use strong passwords to protect sensitive company databases.",
    "The IT support desk helped fix the network connection issue.",
    "Digital presentation software helps convey complex ideas clearly.",
    "Ergonomic equipment reduces physical fatigue during long hours.",
    "Automated workflows save time on repetitive administrative tasks.",
  ],
  general: [
    "Punctuality and dedication reflect a strong work ethic.",
    "Organize your daily workload to meet every critical deadline.",
    "Professionalism in the workplace leads to career growth.",
    "Teamwork and collaboration make office tasks much easier.",
    "Adaptability is key when facing sudden operational changes.",
    "Continuous learning improves administrative skills over time.",
    "Maintain a clean and orderly desk for better focus.",
    "Prioritize high-importance tasks every morning before noon.",
    "Respect company policies and uphold ethical standards daily.",
    "Time management skills help maintain a good work-life balance.",
  ],
} as const;

export function getCategorySentences(category: string): readonly string[] {
  const key = category.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SENTENCE_BANK, key)
    ? SENTENCE_BANK[key as keyof typeof SENTENCE_BANK] : [];
}

export function practiceFormatLabel(format?: string): string {
  return format === "full-sentence" ? "Full Sentence" : "Word / Phrase";
}
