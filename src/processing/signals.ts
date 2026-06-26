import type { NormalizedEvent } from "../normalization/normalizedEvent.js";

export interface Signal {
  type: "ENTITY" | "CUE";
  value: string;
  weight: number;
}

const COMMON_CUES = [
  "launch", "recall", "trade", "injury", "opening", "closing", 
  "comeback", "game-winner", "policy change", "lawsuit", 
  "earnings", "review", "reaction", "win", "sweep", "blowout"
];

// Very basic Named Entity Recognition for MVP
export function extractSignals(event: NormalizedEvent): Signal[] {
  const signals: Signal[] = [];
  const titleLower = event.title.toLowerCase();
  
  // Extract cues
  for (const cue of COMMON_CUES) {
    if (titleLower.includes(cue.toLowerCase())) {
      signals.push({ type: "CUE", value: cue, weight: 1.0 });
    }
  }

  // Very rudimentary entity extraction: capitalize words (excluding common stop words at start)
  const words = event.title.split(/[^a-zA-Z0-9'-]+/);
  let currentEntity: string[] = [];
  
  for (const word of words) {
    if (word.length > 1 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
      currentEntity.push(word);
    } else {
      if (currentEntity.length > 0) {
        const entity = currentEntity.join(" ");
        if (entity.length > 2) {
          signals.push({ type: "ENTITY", value: entity, weight: 1.0 });
        }
        currentEntity = [];
      }
    }
  }
  if (currentEntity.length > 0) {
    const entity = currentEntity.join(" ");
    if (entity.length > 2) {
      signals.push({ type: "ENTITY", value: entity, weight: 1.0 });
    }
  }

  // Deduplicate
  const uniqueSignals = Array.from(new Map(signals.map(s => [`${s.type}:${s.value}`, s])).values());
  return uniqueSignals;
}
