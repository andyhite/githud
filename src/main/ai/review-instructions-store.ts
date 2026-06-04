import { existsSync, readFileSync, writeFileSync } from 'fs'
import { reviewInstructionsFilePath } from '../paths'
import { DEFAULT_REVIEW_INSTRUCTIONS } from './review-instructions-default'

// The live review-voice system prompt. App-owned and user-editable; falls back
// to the vendored snapshot of the andy-code-review skill until the user edits it.
export function loadReviewInstructions(): string {
  const path = reviewInstructionsFilePath()
  if (!existsSync(path)) return DEFAULT_REVIEW_INSTRUCTIONS
  try {
    const text = readFileSync(path, 'utf8')
    return text.trim() ? text : DEFAULT_REVIEW_INSTRUCTIONS
  } catch {
    return DEFAULT_REVIEW_INSTRUCTIONS
  }
}

export function saveReviewInstructions(text: string): void {
  writeFileSync(reviewInstructionsFilePath(), text)
}

// Reset to the vendored default by writing it back; returns the default text.
export function resetReviewInstructions(): string {
  writeFileSync(reviewInstructionsFilePath(), DEFAULT_REVIEW_INSTRUCTIONS)
  return DEFAULT_REVIEW_INSTRUCTIONS
}
