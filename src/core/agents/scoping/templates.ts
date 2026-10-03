// Category templates (spec §8.3): default milestones and objective acceptance criteria.
import type { AcceptanceCriterion, Category } from "@/core/contracts";

export interface MilestoneTemplate {
  title: string;
  description: string;
  share: number; // relative weight for splitting the budget
  hoursFromNow: number;
  criteria: AcceptanceCriterion[];
}

export const CATEGORY_TEMPLATES: Record<Category, MilestoneTemplate[]> = {
  delivery: [
    {
      title: "Pickup",
      description: "Collect the goods at the pickup point.",
      share: 40,
      hoursFromNow: 2,
      criteria: [
        { id: "c1", text: "Photo of the goods at the pickup point showing the expected quantity", evidenceType: "photo", check: "ai_visual" },
        { id: "c2", text: "Photo GPS within 150 m of the pickup point", evidenceType: "geo", check: "deterministic", params: { maxDistanceM: 150 } },
      ],
    },
    {
      title: "Drop-off",
      description: "Deliver the goods and get recipient confirmation.",
      share: 60,
      hoursFromNow: 4,
      criteria: [
        { id: "c1", text: "Photo of the goods at the drop-off location", evidenceType: "photo", check: "ai_visual" },
        { id: "c2", text: "Drop-off GPS within 150 m of the delivery address", evidenceType: "geo", check: "deterministic", params: { maxDistanceM: 150 } },
        { id: "c3", text: "Photo taken within 90 minutes of the due time", evidenceType: "timestamp", check: "deterministic", params: { withinMinutesOfDue: 90 } },
        { id: "c4", text: "Recipient name typed as confirmation", evidenceType: "text", check: "ai_text" },
      ],
    },
  ],
  digital_deliverable: [
    {
      title: "Deliverable",
      description: "Upload the finished file.",
      share: 100,
      hoursFromNow: 48,
      criteria: [
        { id: "c1", text: "File is a PDF or PNG", evidenceType: "file", check: "deterministic", params: { mimeTypes: ["application/pdf", "image/png"] } },
        { id: "c2", text: "Document contains every required section", evidenceType: "file", check: "ai_text", params: { requiredSections: [] } },
        { id: "c3", text: "Content is original (no plagiarism flag)", evidenceType: "file", check: "ai_text" },
      ],
    },
  ],
  onsite_service: [
    {
      title: "Before",
      description: "Document the site before starting work.",
      share: 30,
      hoursFromNow: 2,
      criteria: [
        { id: "c1", text: "Before photo of the work area", evidenceType: "photo", check: "ai_visual" },
        { id: "c2", text: "Photo GPS within 150 m of the service address", evidenceType: "geo", check: "deterministic", params: { maxDistanceM: 150 } },
      ],
    },
    {
      title: "After",
      description: "Complete the work and document the result.",
      share: 70,
      hoursFromNow: 6,
      criteria: [
        { id: "c1", text: "After photo of the same area showing the completed work", evidenceType: "photo", check: "ai_visual" },
        { id: "c2", text: "Photo GPS within 150 m of the service address", evidenceType: "geo", check: "deterministic", params: { maxDistanceM: 150 } },
        { id: "c3", text: "Checklist of completed tasks typed by the worker", evidenceType: "text", check: "ai_text" },
      ],
    },
  ],
};

/** Known places for the demo's hero vertical (Indore). Used by the offline stub and as hints to the model. */
export const KNOWN_PLACES: { match: RegExp; label: string; lat: number; lng: number }[] = [
  { match: /vijay\s*nagar/i, label: "Vijay Nagar, Indore", lat: 22.7533, lng: 75.8937 },
  { match: /rajwada/i, label: "Rajwada, Indore", lat: 22.7186, lng: 75.8553 },
  { match: /palasia/i, label: "Palasia, Indore", lat: 22.7246, lng: 75.8839 },
  { match: /bhawarkuan|bhanwarkuan/i, label: "Bhawarkuan, Indore", lat: 22.6928, lng: 75.8676 },
  { match: /pune/i, label: "Pune", lat: 18.5204, lng: 73.8567 },
  { match: /indore/i, label: "Indore", lat: 22.7196, lng: 75.8577 },
];
