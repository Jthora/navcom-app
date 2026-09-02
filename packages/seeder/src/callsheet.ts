import { readFileSync } from "node:fs";
import { FIELD_QUESTION, needsChecking, type ResourceField, type ResourceRecord } from "@navcom/core";

/**
 * A call sheet: what to ask, and who to ask.
 *
 * ## What this is not
 *
 * It does not produce a single fact about a single place. Every answer comes from whoever
 * picks up the phone. `CLAUDE.md` forbids generating this material and is right to — *"the
 * Medic's kill trigger is confident wrong guidance, and plausible-sounding safety content is
 * worse than none"* — and a fabricated `pets: yes` is somebody turned away at 11pm with a dog
 * and nowhere else to be.
 *
 * So this generates **questions**. The whole tool is a work list and a script.
 *
 * ## Why it is worth having
 *
 * 479 records carry the fields that decide whether somebody gets a bed for **two** of them.
 * The other 477 are `method: website` — scraped names, addresses and sometimes hours. The
 * directory's entire promise is the part that is missing.
 *
 * And the schema already says a phone call counts: `in_person` ranks *high*, **`phone` ranks
 * *medium***, and `website` ranks *low*. Ten records done properly does not need a body
 * outdoors. It needs ten phone calls and an hour, which is a different-sized ask.
 *
 * `needsChecking` already knows what to ask about any record — blanks in `ASK_FIRST` order,
 * then anything gone stale. This points it at a whole region and sorts by where an answer
 * would help most.
 */

/**
 * The words to say, from core.
 *
 * They moved there when the Field Terminal started showing them too: a person on the phone
 * and a person at a laptop should be asking the same question, and two copies would drift
 * onto the half nobody proof-reads.
 */
const QUESTION = FIELD_QUESTION;

/**
 * How much an answer here is worth.
 *
 * Places somebody goes to *sleep* first, because that is the question asked at 11pm with
 * nowhere else to be. Then how many decisive fields are blank — a record missing five of them
 * is one call that fixes five, and a record missing one is a call that fixes one.
 */
const TYPE_WEIGHT: Record<string, number> = {
  overnight: 100,
  shelter: 100,
  emergency: 90,
  daytime: 60,
  warming: 60,
  food: 40,
  medical: 40,
  hygiene: 30
};

export interface Call {
  id: string;
  name: string;
  phone: string | null;
  type: string;
  ask: ResourceField[];
  score: number;
}

function rows(csvPath: string): ResourceRecord[] {
  const csv = readFileSync(csvPath, "utf8");
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = split(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const rec: Record<string, string> = {};
    head.forEach((h, i) => (rec[h] = cells[i] ?? ""));
    return rec as unknown as ResourceRecord;
  });
}

/** Minimal CSV, quotes included, because these files contain commas in addresses. */
function split(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function callsFor(csvPath: string, now: Date, limit: number): Call[] {
  return rows(csvPath)
    .map((r) => {
      // Four rather than three: this is a phone call, not a doorway, and somebody who has
      // already picked up will answer a fourth question.
      const ask = needsChecking(r, [], now, 4);
      const type = String((r as unknown as Record<string, string>)["type"] ?? "");
      const phone = String((r as unknown as Record<string, string>)["phone"] ?? "").trim();
      return {
        id: String((r as unknown as Record<string, string>)["id"] ?? ""),
        name: String((r as unknown as Record<string, string>)["name"] ?? ""),
        phone: phone || null,
        type,
        ask,
        // A place with no number cannot be called, however much it is missing.
        score: phone ? (TYPE_WEIGHT[type] ?? 20) + ask.length * 10 : 0
      };
    })
    .filter((c) => c.score > 0 && c.ask.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function render(slug: string, calls: Call[], now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const out: string[] = [];

  out.push(`# Calls to make — ${slug}`, "");
  out.push(
    "Every answer below comes from the person who picks up. Nothing here guesses, and a field",
    "nobody confirmed stays blank — the directory renders blank as **unknown**, which is honest,",
    "and renders a wrong answer as fact, which is not.",
    ""
  );
  out.push(
    "**Say who you are and why.** *\"I'm a volunteer keeping a list people use at night, and I",
    "want to make sure what we tell them about you is right.\"* Nobody has to answer anything.",
    ""
  );
  out.push(
    "**If they will not say, that is an answer too** — leave it blank rather than guessing, and",
    "write what they told you in `notes` if it is worth knowing.",
    ""
  );
  out.push("---", "");

  calls.forEach((c, i) => {
    out.push(`## ${i + 1}. ${c.name}`);
    out.push(`\`${c.id}\`  ·  ${c.type}  ·  **${c.phone}**`, "");
    for (const field of c.ask) {
      out.push(`- [ ] **${field}** — ${QUESTION[field] ?? `What is the current ${field}?`}`);
    }
    out.push("", "```");
    out.push(`# after the call, record it:`);
    out.push(
      `npm run seed --workspace @navcom/seeder -- record ${slug} ${c.id} \\`,
      `  --by "<your callsign>" --method phone --on ${date} \\`,
      c.ask.map((f) => `  --${f} "<what they said>"`).join(" \\\n")
    );
    out.push("```", "");
  });

  out.push("---", "");
  out.push(
    `${calls.length} calls. Fields left blank stay blank — that is the point of the sheet.`
  );
  return out.join("\n");
}
