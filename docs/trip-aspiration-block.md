# Stawi · The Trip Block — capturing aspiration

A short module taken **per trip**, alongside the Traveler Style Assessment rather than inside it.

The TSA measures something stable — how a person likes to travel — which is why a yearly retake
produces a meaningful trend. Aspiration is not stable. The same person books for Refinement this
year and, after a divorce or a diagnosis, for Metamorphosis next. Keeping them separate protects
the TSA's trend and lets the trip block be asked fresh every time.

The whole block is **one question**. It is Pine's own instrument, so we are using the framework's
native capture rather than inventing a parallel one.

---

## 1 · At booking

> ### What would you like to be different?
>
> Some people book a trip knowing exactly what they're after. Most don't. Either is fine — you
> can change this any time before you arrive, and we'll ask again.
>
> **I want to go from** `________________`
> **to** `________________`
>
> *A few from other travelers:*
> - *from curious about photography · to someone who knows what they're doing with a camera*
> - *from running on empty · to actually rested*
> - *from never having traveled alone · to someone who can*
> - *from stuck in the same rut · to clear about what comes next*
>
> `[ Save ]`  `[ I'm not sure yet — ask me later ]`

**Design notes**

- Two fields, not a text area. The two-box shape does the work: it forces a *from* and a *to*,
  which is what makes the answer classifiable and what makes the six-month comparison possible.
- The examples deliberately span all four aspiration types without naming them. Never show a
  traveler the taxonomy.
- **"I'm not sure yet" is a first-class answer**, not a skip link. Michael's own draft notes that
  aspirations are often unknown even at check-out; a form that punishes vagueness will collect
  politeness instead of truth.
- Nothing downstream blocks on this being filled in.

## 2 · Through the pre-trip months

This is what the pre-trip journaling is *for*. Each monthly prompt opens by offering the sentence
back:

> **Last time you said:** *"I want to go from running on empty to actually rested."*
>
> `[ Still right ]`  `[ Change it ]`  `[ I've thought of something better ]`

For a traveler who chose "not sure yet," the same slot asks the question again, more softly each
time:

> You weren't sure yet what you were hoping for. No rush — but if something has come into focus
> since, this is a good place to put it.

Every version is kept. The drift from the first answer to the last is itself interesting, and at
six months it is worth showing them.

## 3 · At arrival

The current version is locked for the stay and surfaced to the property. The traveler sees:

> **What you told us you were after:** *"from running on empty to actually rested."*
> We've shared this with the team so they know how to help. You can change it any time.

## 4 · Classification — internal only

The aspiration type and brand role are **never shown to the traveler.** "You are a Metamorphosis"
is alienating and slightly absurd. It is a routing signal for the property, nothing more.

Classification runs on the X→Y statement plus any pre-trip journal entries.

```
You classify a traveler's stated aspiration against Joseph Pine's four transformation types,
from The Transformation Economy. Return JSON only.

The four types, by how much of the person changes:

  refinement    (enhancing identity)  — desiring enhancement of an aspect of oneself
  ambition      (expanding identity)  — getting significantly better at a dimension of self
                                        through skills, knowledge or capabilities
  cultivation   (enriching identity)  — developing an unrealized attribute
  metamorphosis (altering identity)   — changing one's identity in a significant way

The brand's role follows the type:
  refinement -> Expert      (you know the thing; teach it to me)
  ambition -> Coach         (push me further at something I already do)
  cultivation -> Counselor  (help me find the part of myself I haven't met)
  metamorphosis -> Alchemist (help me become someone else)

Rules:
- If the statement is empty, "not sure", or too vague to distinguish between types, return
  type "unknown". Do NOT guess. An unknown is more useful to a property than a wrong label.
- Judge the DISTANCE between the from-state and the to-state, not the activity named.
  "curious about photography -> experienced travel photographer" is ambition.
  "tired -> rested" is refinement, even though it sounds modest.
  "who I was before the accident -> someone new" is metamorphosis.
- staff_note is one sentence a front-desk person can act on, naming what posture to take and
  what to avoid. No jargon. Never use the words transformation, aspirant, or the type name.

Return:
{
  "type": "refinement|ambition|cultivation|metamorphosis|unknown",
  "role": "Expert|Coach|Counselor|Alchemist|null",
  "confidence": "high|medium|low",
  "staff_note": "…"
}
```

**Worked examples**

| Traveler's words | Type | Role | staff_note |
|---|---|---|---|
| curious about photography → knows what they're doing with a camera | ambition | Coach | Push them — they want to be stretched, not shown around. Offer the harder hike for the better light. |
| running on empty → actually rested | refinement | Expert | Protect their quiet. Don't fill the schedule, and don't ask them to join things. |
| never traveled alone → someone who can | cultivation | Counselor | Encourage, don't escort. Small wins on their own are worth more than company. |
| *(blank)* | unknown | null | They haven't said what they're after. Ask gently on day two, not at check-in. |

## 5 · What the property sees

One line on the pre-arrival brief, under the traveler's name:

> **Hoping for:** *"from running on empty to actually rested"*
> **How to help:** Protect their quiet. Don't fill the schedule, and don't ask them to join things.

Their words first, the instruction second. The staff member never needs to know the framework to
act correctly on it — which is the point of Shift 5, *from travel brands to transformation
guides*, made operational.

## 6 · Month six

The whole reason for capturing it in the traveler's own words:

> Six months ago you said you wanted to go **from running on empty to actually rested.**
>
> Where are you now?

No rating scale. Their sentence, returned, and room to answer. That is "measured by meaning, not
satisfaction" made into something you can actually show a general manager.

---

## Open questions

1. **Does the X→Y statement go to the property verbatim, or paraphrased?** Verbatim is more
   powerful and slightly more exposing. Probably ask the traveler at arrival.
2. **Re-classify after the pre-trip journaling, or only once?** Re-classifying is better and
   costs one model call. The risk is the staff brief changing shape late.
3. **What happens when the four types are wrong for wildlife travel specifically?** Pine's
   framework is general. Worth watching whether safari travelers cluster into one or two types,
   which would make the distinction less useful than it looks.
