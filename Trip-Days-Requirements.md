# MyJourneys — Trip Days Feature Requirements

*Last updated: April 25, 2026*

---

## Vision

Traditional trip planning documents (PDFs, Word docs) are dead the moment they're created — beautiful narratives but frozen in time, hard to navigate, and useless once the trip starts. The Trip Days feature turns the itinerary into a **living document** that evolves before, during, and after the trip.

- **Before**: Planner or owner builds the day-by-day structure
- **During**: Traveler journals, logs sightings, notes what actually happened
- **After**: The plan becomes a trip memoir — the original itinerary layered with real experiences, photos, and ratings

---

## Data Model

### Trip Days Table
Each row is one day of a trip. A Trip has a one-to-many relationship to Trip Days. Days run from departure day through return day.

| Field | Type | Notes |
|---|---|---|
| Trip ID | Text | Parent trip record ID |
| Day Number | Integer | 1, 2, 3… |
| Date | Date | Derived from trip start date + day number |
| Starting Location | Text | Often same as previous day's ending location |
| Ending Location | Text | Often same as starting location |
| Place ID | Text (optional) | Place record ID for this day (e.g. Kidepo Valley NP) |
| Lodging ID | Text (optional) | Lodging record ID — null for travel/departure days |
| Meal Plan | Multi-select | B / L / D — which meals are included |
| Slot 1 | Long text | JSON activity object — see Activity Slot structure |
| Slot 2 | Long text | JSON activity object |
| Slot 3 | Long text | JSON activity object |
| Slot 4 | Long text | JSON activity object |
| Slot 5 | Long text | JSON activity object (overflow / optional) |
| Day Notes | Long text | Planner or owner narrative for the day |
| Journal Entry | Long text | Added by traveler during/after the trip |

**Key design decisions:**
- Slots are generic (Slot 1–5), not pre-labeled by time of day. Each slot's JSON includes a `label` field set by the planner (e.g. "Morning", "Transfer", "All Day", "Evening")
- All slots are optional — a pure transfer day may use just Slot 1 with label "All Day"
- A day with no lodging is valid (e.g. overnight flight, last day driving home)
- All ID fields are plain text strings, consistent with the rest of the app (no Airtable linked record fields)

**Auto-generation on trip creation:**
When a trip is created, the system prompts: *"Would you like to create a day-by-day itinerary for this trip?"*
- **Yes** → system generates one Trip Days record per day (start date through end date), pre-populated with Trip ID, Day Number, and Date. All slots start empty.
- **Not Now** → trip saves normally. Itinerary can be started later from the trip detail page.

---

### Activity Slot Structure
Each slot (Slot 1–5) stores a JSON object. The `label` field is planner-defined. Each slot can hold one of the following activity types:

| Type | Fields |
|---|---|
| **Text / Free Form** | Title, description, start time, duration |
| **Transfer** | From, To, Mode (Road / Air / Boat), duration, notes |
| **Passion Activity** | Linked from AI-generated Passion Hub activity list for the destination |
| **Get Your Guide** | Link, activity name, booking reference |
| **Ticketmaster** | Link, event name, date/time |
| **OpenTable** | Link, restaurant name, reservation time |
| **Empty** | Slot intentionally left open |

Each slot holds **one activity** (no stacking within a slot). If multiple things happen in a morning, the planner uses the description field to capture the sequence.

---

### Lodging Table
A separate object — too rich to be a field on a Day. Planner writes once, reuses across multiple trips.

| Field | Type | Notes |
|---|---|---|
| Name | Text | e.g. Amuka Safari Lodge |
| Location | Text | City / region / park |
| Type | Select | Hotel / Lodge / Tented Camp / Guesthouse / Cruise / Other |
| Description | Long text | Rich narrative — planner-written or AI-assisted |
| Amenities | Text | Pool, Wi-Fi, restaurant etc. |
| Image URL | Text | |
| Check-in Date | Date | Set per trip — same lodge can be used on multiple trips |
| Check-out Date | Date | System auto-populates lodging across day records in the range |
| Trip ID | Text | Parent trip record ID |

**Multi-day lodging:** When a lodge is created with check-in/check-out dates, the system automatically links it to all Day records in that date range. Updating the check-out date automatically updates all affected Days.

---

### Place (Simplified)
Place is simplified — it is just a location, not a dated event on a trip.

| Field | Type | Notes |
|---|---|---|
| Name | Text | e.g. Kidepo Valley National Park |
| Country | Text | |
| Description | Long text | What this place is / why visit |
| Type | Select | City / National Park / Region / Island / etc. |
| Passions | Multi-select | Relevant passions for this place |

Places connect to Days (a day is spent at a Place). A Place can appear across many trips and many days.

**Future scope:** Trip Planners build a personal library of Places with their own descriptions and recommended activities.

---

## Real-World Day Examples (from Uganda Safari reference)

**Day 1 — Travel + Activity Day**
- Starting location: Entebbe Airport
- Morning: Mabamba Swamp — Shoebill stork excursion (boat) → Passion: Birding
- Transfer: Road, Mabamba to Ziwa, 2-3 hours
- Afternoon: Ziwa Rhino Sanctuary — rhino tracking on foot → Passion: Wildlife & Safari
- Ending/Lodging: Amuka Safari Lodge, Ziwa Rhino Sanctuary
- Meal plan: L, D

**Day 2 — Pure Transfer Day**
- Starting location: Ziwa Rhino and Wildlife Ranch
- All-day: Road transfer to Kidepo Valley NP, 6-7 hours (doubles as game drive)
- Ending location: Kidepo Valley National Park
- Lodging: TBD at destination
- Meal plan: L (packed lunch on road)

---

## The Living Document Advantage
Unlike a static PDF itinerary:
- Traveler sees the plan slot by slot each morning of the trip
- Journal entries, photos, and wildlife sightings are added in real time
- After the trip, the itinerary becomes a memoir — plan + what actually happened
- Sightings logged during the trip feed the community wildlife database (future)
- Planner can update lodging or activities remotely and travelers see changes immediately

---

## Design Decisions (Resolved)

1. **Activity assignment** — Claude auto-generates a suggested day plan tied to the traveler's **archetype**. A Transformational Traveler in Kidepo gets different suggestions than a Cultural Explorer. Connects the DNA assessment directly to the daily schedule. Planner or owner can accept, edit, or replace suggestions.

2. **Two Places in one day** — each time slot belongs to one Place. A **Transfer** is its own slot type spanning from Place A to Place B. Example: Morning slot → Ziwa Rhino Ranch; Transfer slot → Ziwa to Kidepo (6-7 hrs road); Afternoon/Evening slots → Kidepo Valley NP.

3. **Planner approval flow** — planner fills in days, trip owner reviews and approves before days are locked. Owner stays in control; planner does the heavy lifting.

4. **Group travel** — families and friends connect to a shared trip itinerary. Each person has their own access level. Everyone contributes journal entries and moments. One living document the whole group takes home.

---

## Open Questions

1. **Planner Lodge Library** — future scope; planner writes lodge descriptions once and reuses across client trips. When does this become a priority?

2. **Two Places in one day (UI)** — when a day spans two Places, how does the portal visually represent the transition? Does each slot show its Place, or is it shown as a timeline?

3. **Group travel permissions** — when friends/family are connected to a shared trip, can they edit slots or only add journal entries? Who resolves conflicts if two people edit the same slot?

---

## Why
Customers want more than a list of places. They want a structured, day-by-day plan that is operational during the trip and becomes a keepsake after. Current static PDF documents from travel planners are beautiful but frozen — MyJourneys can do significantly better.

---

## Build Sequence

1. Create Trip Days and Lodging Airtable tables
2. Add day-by-day view to portal (read-only, planner-populated first)
3. Add owner/traveler ability to edit slots
4. Add transfer as a first-class activity type
5. Add Passion Hub activity linking to slots
6. Add journal entry + photo upload per day (during-trip mode)
7. Add Get Your Guide / Ticketmaster / OpenTable slot types
8. Add AI-suggested day plan generation from DNA Guide + Passion Hub
9. Add group travel — shared itinerary with role-based access
10. Future: Planner lodge library and place library
