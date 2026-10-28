# December 17 talk — AI material

**Event:** AI Innovation Summit, hosted by Gerald "Solutionman" Haman / The SolutionPeople Network,
sponsored by the AI Innovators Network. Zoom + YouTube + LinkedIn, free registration.
**Slot:** 15–18 minutes.
**Audience:** broad and business-leaning — AI practitioners, business leaders, consultants,
entrepreneurs, educators, investors, and curious non-specialists. *Not* a deep practitioner room.
**Working title:** Why Your Recommendation Engine Doesn't Know You.
**Thesis:** the person is the query. Same words, different person, different correct answer.

> Note on reach: "100K+" is the sponsoring LinkedIn communities' *membership*, not expected live
> attendance. The real value is the recording, the LinkedIn promotion into those communities, and
> the connection to Haman's network — reach over months, not on the day.

---

## The two technical ideas that belong in the talk

At 15–18 minutes you can carry two, and both must serve the three-answer demo. Everything else
is a distraction.

### 1. Context engineering beats model choice

The thesis stated technically. Same model, same question, three different answers — because the
prompt carries the diagnosis, the stage, the living situation, and a month of what the family
actually wrote.

The audience's instinct is that a better answer needs a better model. The argument is that it
needs a better-*informed* one. Genuinely contrarian in a room where everyone is benchmarking
models.

### 2. Subtraction

Using what you know to **remove** answers. Knowing someone is in late-stage dementia means
suppressing the driving conversation and the legal paperwork — months past useful, and painful to
read. Everyone frames personalization as "more relevant results." Framing it as "removing answers
that would hurt" is fresher and truer.

This is the line people will quote.

## The honest beat

**Personalization makes errors more confident.** A generic system fails obviously; a personalized
one fails *persuasively*, because the wrong answer arrives wearing the clothes of a tailored one.
Stale stage data produces a fluently wrong answer.

On-thesis, and it buys the room's trust for the conclusion.

*(Save the self-citing-corpus story — 189 of 200 knowledge chunks being CAL's own output — for a
different talk. Strong material, wrong talk.)*

---

## Q&A ammunition — one sentence each, only if asked

**Generate once, cache, refresh monthly.** Four scheduled jobs regenerate the guidance library,
medication guides, progression content and situations. Most people assume an AI product calls the
model on every request; this one mostly doesn't — cheaper, faster, consistent between users, and
auditable. *(`med-refresh`, `guidance-refresh`, `progression-refresh`, `situation-refresh`)*

**Batch API.** Hundreds of destinations rescored with Haiku overnight — submit one day, collect
the next. Roughly half price, no rate-limit fighting, and many people don't know it exists.
*(`scripts/rescore-destinations.js`, claude-haiku-4-5)*

**Human-in-the-loop content.** Source Watch scans WHO, NIA, Lancet, FDA and CDC monthly with web
search, drafts what has changed, and ships nothing without approval. With the principle worth
stating aloud: it must be able to **weaken or retract** guidance, not only add it. Most knowledge
bases only grow. *(`source-watch.js`)*

**Classification as routing, not generation.** The Stawi aspiration classifier returns `unknown`
rather than guessing, and its output is never shown to the traveler — it routes staff behavior.
Where model output surfaces is a design decision, not a technical one.
*(`docs/trip-aspiration-block.md`)*

**Grounding in structured data, not documents.** 14,690 geocoded care facilities; 474 curated
wildlife locations with seasonality. The model reasons over real rows rather than retrieving prose
about them. Different from RAG, and more reliable.

**Claude as a geocoding fallback** when the real geocoders fail. Small, concrete, always lands.
*(`scripts/geocode-claude-fallback.js`)*

---

## What to leave out

**Don't go deep on RAG mechanics.** Commoditized — every AI conference this year has had five
talks on pgvector and chunking — and it invites the corpus-provenance question, which is better
answered on your own terms in a different talk.

**Don't claim validation you don't have.** If the TSA comes up: *"25 pilot participants, formal
validation planned."* Same line as the Stawi summary. That audience contains people who know the
difference, and saying it first costs nothing.

**Don't let it become a product pitch.** An AI audience detects one within ninety seconds. The
talk is about the method; CAL and Stawi are the evidence that it works.

---

## Structure (16 minutes, leaves two minutes of air)

| | |
|---|---|
| 0:00–1:30 | **Cold open.** Two people with nothing in common — a woman choosing the trip of her life; a man awake at 2 a.m. because his mother is frightened and doesn't know him. Both get a recommendation from the same engine. |
| 1:30–3:00 | **Why most recommendation engines can't do this.** Behavioral — *people like you also liked*. Works for films. Fails when what matters is who you are, not what you clicked. |
| 3:00–6:30 | **Domain one: travel.** Assessment, archetype, same destination list producing different top matches. |
| 6:30–11:00 | **Domain two: dementia.** *"She won't get in the car"* — Gloria (early, independent), Margaret (middle, at home with support), Robert (late, memory care). **The centre of the talk.** |
| 11:00–13:30 | **The insight.** What transferred was a shape, not code. Then subtraction. |
| 13:30–15:30 | **The honest problem.** Personalization makes errors more confident. |
| 15:30–16:00 | **Close.** |

## Demo — pre-record it

Screen share is available, but record the demo as a 90-second video and play it from the shared
screen. Removes wifi risk, login fumbling, and — critically — the chance of the circle switcher
putting `eugene` (real data) into a permanent YouTube recording.

⚠️ **Set up a demo login that sees only Gloria, Margaret and Robert.**
`michael.g.emerson@gmail.com` currently also sees `eugene`.

⚠️ **Test the premise first.** Does "she won't get in the car" actually produce three visibly
different answers across the three circles? That is an assumption, not a finding, and the whole
talk rests on it. Worth seeding each demo circle with more journal entries so the answers diverge
more sharply.

## Deadline

Summary/abstract due end of the week of 2026-11-03. Abstract drafted — see conversation; title
and three "what you'll learn" bullets ready.
