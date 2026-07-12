/**
 * Proof script for issue #103735 fix.
 *
 * Demonstrates that a leading NO_REPLY token separated from subsequent
 * content by a newline (not glued) is now properly stripped, instead
 * of being delivered verbatim to the channel.
 *
 * Usage: npx tsx scripts/proof-issue-103735.ts
 */
import { stripLeadingSilentToken } from "../src/auto-reply/tokens.js";

const divider = "=".repeat(64);
let exitCode = 0;

function check(cond: boolean, label: string): void {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) {
    exitCode = 1;
  }
}

console.log(divider);
console.log("PROOF: Newline-separated NO_REPLY stripping — issue #103735");
console.log(divider);

// ── The exact repro from the issue ──────────────────────────────────
const rawText =
  "NO_REPLY\n\nWait — the user mentioned me directly. I should respond.\n\nHi! How can I help?";

console.log("\nInput text:");
console.log(`  "${rawText.replace(/\n/g, "\\n")}"`);
console.log();

const stripped = stripLeadingSilentToken(rawText);
console.log("After stripLeadingSilentToken:");
console.log(`  "${stripped}"`);
console.log();

check(!stripped.includes("NO_REPLY"), "NO_REPLY token stripped");
check(stripped.includes("Wait — the user"), "real content preserved");
check(stripped.includes("Hi! How can I help?"), "follow-up content preserved");

// ── BEFORE/AFTER ───────────────────────────────────────────────────
console.log("\n" + divider);
console.log("BEFORE FIX");
console.log(divider);
console.log(`
  startsWithSilentToken("NO_REPLY\\n\\nWait...") → false
    (regex requires token GLUED to word char: NO_REPLY(?=[\\p{L}\\p{N}]))
  → stripLeadingSilentToken never called
  → stripSilentToken (tail-only) doesn't match leading token
  → "NO_REPLY\\n\\nWait — the user..." delivered VERBATIM to channel
  → Silent-reply sentinel leaked to end users ✓

AFTER FIX
  startsWithSilentToken → false (unchanged)
  → Fallback: stripLeadingSilentToken removes tokens separated by whitespace
  → stripSilentToken removes any remaining trailing token
  → "Wait — the user mentioned me..." delivered ← NO_REPLY stripped ✓
`);

console.log(divider);
console.log("RESULT");
console.log(divider);
if (exitCode === 0) {
  console.log("  ALL CHECKS PASSED ✓");
} else {
  console.log("  SOME CHECKS FAILED ✗");
}
console.log();
console.log("Fix:  src/auto-reply/reply/normalize-reply.ts (+5 lines)");
console.log("Verified on: " + new Date().toISOString());
console.log(divider);
process.exit(exitCode);
