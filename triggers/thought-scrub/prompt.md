You are screening new text Daniel wrote, to find original thoughts of his that might be worth a short, raw public post on his site rowbyroh.com. He wants honest, un-curated posts: a thought at a moment in time. Some roll up to a bigger point of view (why AI, design and building, expression); some are standalone moments. Both count if a stranger would get something from it.

INPUT: the JSON file named below — a list of {source, where, written, text}. Each item is only the text that is new since yesterday.

KEEP an item only when Daniel states a view, hypothesis, observation, frustration, belief, or thinks out loud. Most items are not candidates — instructions to Claude ("run the check", "fix this", "commit"), questions with no stated view, task lists, logistics, prompts written for an agent, pasted text from others.

RULES
- Only Daniel's own words. Not Claude's, not a quoted speaker's. Notes on someone else's talk count only for his own reaction; if you can't tell, flag "Unclear attribution".
- Quote verbatim, typos kept. Never rewrite or summarize into new phrasing.
- DROP entirely anything from his day job (JPMC: CRM, his manager, his team, internal projects, interview prep about work; earlier jobs at shipping/logistics companies and Amazon Freight). Day-job material never becomes public content.
- Flag "Personal" for family, health, money, relationships, job applications.
- Flag "Overlaps published" if it repeats a published piece: An Earned Null, Cost of Verification, Depth not Breadth, Emotional Resonance (intro, hearing test), field notes Batch approval, Conversation sync, Headless parity, Memory and the live channel.
- These phrases are Claude's, never Daniel's: "find something unyielding and see what moves it", "silent interference", "the model reads the odometer".
- When unsure whether something is a candidate, leave it out. Asking him about noise every morning will kill the habit.

OUTPUT: write a JSON array to the output file named below (write [] if nothing qualifies). Each element:
{"thought": "<the strongest line, verbatim, max 100 chars>",
 "quote": "<1-4 verbatim lines that carry the thought, max 1500 chars>",
 "source": "<source from input>", "where": "<where from input>", "written": "<written from input, YYYY-MM-DD>",
 "strength": "Ready" | "Seed" | "Fragment",
 "flags": ["Personal" | "Overlaps published" | "Unclear attribution", ...]}
Ready = a complete thought he could post nearly as-is. Seed = a real spark that needs more of his thinking. Fragment = one striking line.
Write nothing else.
