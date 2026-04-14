
graph TD
    subgraph Users["👤 Users"]
        Traveler["Traveler"]
        Planner["Travel Planner"]
        Admin["Admin"]
    end

    subgraph Frontend["Frontend (Vercel Hosting)"]
        SQ["Squarespace\nMarketing Site"]
        ASSESS["transformational-profile.html\nTravel Assessment"]
        PORTAL["portal.html\nTraveler Portal"]
        JOURNAL["journal.html\nJournal Entry"]
    end

    subgraph Auth["Authentication"]
        AUTH0["Auth0\nSPA Login"]
    end

    subgraph API["API Layer (Vercel Serverless Functions)"]
        subgraph Profile["Profile & Trips"]
            AT["airtable-traveler\nTraveler profile CRUD"]
            TR["trips\nTrip management"]
            TP["trip-places\nPlaces per trip"]
            TA["trip-action\nStart / End trips"]
        end
        subgraph AI["AI Features"]
            DG["dest-guide\nDNA Guide generation"]
            IR["integration-report\nPost-trip synthesis"]
            PG["place-guide\nPlace detail guide"]
        end
        subgraph Comms["Communications"]
            JN["journal\nJournal entries + daily SMS"]
            SE["send-email\nTransactional emails"]
            MK["marketing\nMarketing emails"]
        end
        subgraph Other["Other"]
            PT["partner\nPartner invites"]
            ST["stripe\nPayments"]
            PR["promo\nPromo codes"]
            WR["workshop-responses\nWorkshop data"]
        end
    end

    subgraph External["External Services"]
        AIRTABLE["Airtable\nDatabase (17 tables)"]
        CLAUDE["Anthropic Claude API\nAI content generation"]
        TWILIO["Twilio\nSMS journal reminders"]
        EMAIL["Email Provider\nTransactional + marketing"]
        STRIPE["Stripe\nSubscription payments"]
        ACUITY["Acuity Scheduling\nWorkshop bookings"]
        PLAUSIBLE["Plausible\nPrivacy-friendly analytics"]
        MAPBOX["Mapbox\nMapping / geocoding"]
    end

    subgraph Cron["Scheduled Jobs (Vercel Cron)"]
        C1["Daily 12pm — Trip reminders"]
        C2["Hourly — Journal SMS send"]
        C3["1st of month 9am — Monthly journal email"]
        C4["Daily 10am — Marketing emails"]
    end

    Traveler --> SQ
    Traveler --> ASSESS
    Traveler --> PORTAL
    Traveler --> JOURNAL
    Planner --> PORTAL
    Admin --> PORTAL

    SQ --> ASSESS
    ASSESS --> AUTH0
    PORTAL --> AUTH0
    AUTH0 --> PORTAL

    ASSESS --> AT
    PORTAL --> AT
    PORTAL --> TR
    PORTAL --> TP
    PORTAL --> TA
    PORTAL --> DG
    PORTAL --> JN
    PORTAL --> PT
    PORTAL --> ST
    JOURNAL --> JN

    AT --> AIRTABLE
    TR --> AIRTABLE
    TP --> AIRTABLE
    TA --> AIRTABLE
    DG --> AIRTABLE
    JN --> AIRTABLE
    WR --> AIRTABLE

    DG --> CLAUDE
    IR --> CLAUDE
    PG --> CLAUDE
    JN --> CLAUDE

    JN --> TWILIO
    SE --> EMAIL
    MK --> EMAIL
    TA --> SE

    ST --> STRIPE
    STRIPE --> ST

    PORTAL --> MAPBOX

    ASSESS --> PLAUSIBLE
    PORTAL --> PLAUSIBLE
    JOURNAL --> PLAUSIBLE
    SQ --> PLAUSIBLE

    C1 --> TA
    C2 --> JN
    C3 --> JN
    C4 --> MK
```

---

## Layer Summary

| Layer | Technology | Purpose |
|---|---|---|
| Marketing site | Squarespace | Public-facing pages, blog, SEO |
| Frontend app | HTML/CSS/JS on Vercel | Assessment, portal, journal |
| Authentication | Auth0 | Login, session management |
| API | Vercel Serverless Functions (Node.js) | All backend logic |
| Database | Airtable | All traveler, trip, and journal data |
| AI | Anthropic Claude | DNA Guides, journal reflections, integration reports |
| SMS | Twilio | Daily journal reminders during trips |
| Email | Email provider | Transactional + marketing emails |
| Payments | Stripe | Annual/premium subscriptions |
| Scheduling | Acuity | Pre-trip and integration workshop bookings |
| Analytics | Plausible | Privacy-friendly usage tracking |
| Mapping | Mapbox | Destination geocoding and maps |
| Cron jobs | Vercel Cron | Automated reminders and email sends |

---

## Key Data Flows

**New Traveler**
Squarespace → Assessment → Auth0 login → Profile saved to Airtable → Portal access

**DNA Guide**
Portal → dest-guide API → Claude AI → Guide displayed → Query saved to Airtable → Confirmation email sent

**Active Trip**
Portal (start trip) → trip-action API → Email sent → Daily Twilio SMS → Journal entry → Claude reflection → Airtable

**Subscription**
Portal → Stripe checkout → Stripe webhook → Airtable profile updated → Features unlocked
```
