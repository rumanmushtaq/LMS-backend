# Tutor and student dashboards

**Date:** 2026-09-20
**Status:** Approved, implementation starting

## Problem

`/instructor/dashboard` and `/student/dashboard` are linked from the header nav,
both sidebars, two breadcrumbs, the footer, and a backend email — and neither
page exists. Every signed-in user who clicks "Dashboard" lands on the 404 page.

Login makes it worse: a student is sent to `/instructors`, a tutor to the public
home page. Neither role has a place that answers "what do I need to do now?"

## The constraint that shapes everything

**Every number on these pages must be real.** This codebase has form here: the
existing earnings screen shows a permanent $0 next to a hardcoded 4.8 rating,
and neither is labelled as fake.

Before designing, every candidate widget was classified against the data that
actually exists. What was ruled out, and why:

| Rejected widget | Reason |
| --- | --- |
| Tutor earnings from `GET /instructors/my-earnings` | Always `0`. Reads the `Order` collection, which no code writes. Also returns `averageRating = 4.8` as a literal (`instructors.service.ts:599`) |
| Tutor student roster from `GET /instructors/my-students` | Always `[]`. Same dead collection |
| Certificates earned | `Certificate` is never created by any code path |
| Course progress, completion %, grades | No progress, attendance, grade, quiz, assignment or lesson model exists in any of the 24 schemas |
| Courses enrolled | `CoursesModule` registers a schema and nothing else — no controller, no service |
| Tutor rating / review count | No review model. Seed fiction for three demo tutors, `?? 0` for everyone else |
| Materials revenue | `MaterialPurchase` amounts are mock on main (`pi_mock_…`, status forced to `paid`) |
| Earnings over time | `sellerBalance` is lifetime-only, and no money moves until card collection exists. A chart would be empty for every user |

This product is **scheduling + payments + chat**. It is not a course-progress
product, and the dashboards must not pretend otherwise.

## What each dashboard shows

### Student — "when is my next class, and can I join it?"

- **Hero: the next class**, with a live countdown. When that class goes live the
  hero switches to an on-air state with a Join button.
- **Stat tiles:** upcoming · completed · scheduled hours · materials owned.
  "Scheduled hours" is deliberate — there is no per-student attendance flag, so
  "hours learned" would be a claim the data cannot support.
- **Upcoming classes** list with per-class countdowns.
- **Pending requests** — classes awaiting tutor approval.
- **Unread** messages and notifications.
- **Empty state:** a real call to action to browse instructors, which is where
  login sends students today.

### Tutor — "who is waiting on me, and what am I owed?"

- **Hero: next class / go live**, matching the student hero's shape.
- **Awaiting you:** pending class requests. Real, directly actionable, and today
  buried on a separate page.
- **Stat tiles:** net owed (`/payments/my-balance`) · upcoming · distinct
  students taught · seats sold vs capacity.
- **Onboarding progress** — "step 4 of 6", from the real `onboardingStep` enum.
  The only honest progress bar available in this product. Hidden once complete.
- **Strike warning** when the tutor has missed a class. The platform
  auto-suspends at three (`TUTOR_MISSED_CLASSES_LIMIT`) and currently warns
  nobody.
- **Teaching activity chart:** classes completed per month, last 6 months. This
  replaces the earnings chart specifically because classes have real data today
  and money does not.

## Backend: `GET /api/v1/dashboard/summary`

One endpoint, `JwtAuthGuard`, branching on `req.user.role`. Follows the existing
`AdminService.getDashboardStats` pattern — an exported result interface,
`Promise.all` over independent counts, a thin delegating controller.

This is not for convenience. Three numbers are **unobtainable** from existing
endpoints at any number of round trips:

1. **Total unread messages.** `getConversations` slices to `limit` in memory, so
   summing a page is wrong past 50 conversations.
2. **A tutor's distinct student count.** Requires deduping `students[]` across
   every class; the endpoint that claims to do this is dead.
3. **Monthly activity.** No time-series aggregate exists.

It also fixes a payload problem. `GET /classes` has no pagination and no
projection, and populates four paths — so a dashboard needing three upcoming
classes currently downloads every class the user has ever had, with every
classmate's name and email embedded.

Response shapes contain only fields verified as real:

```
STUDENT → {
  classes: { liveNow, upcoming, pendingApproval, completed, cancelled },
  nextClasses: [ ≤3 × { _id, title, startTime, endTime, tutor, status, liveStatus } ],
  scheduledMinutes,
  unread: { notifications, messages },
  materialsOwned,
  profileCompletenessPercent
}

TUTOR → {
  classes: { liveNow, upcoming, pendingRequests, completed, missed },
  nextClasses: [ ≤3 × { _id, title, startTime, endTime, enrolled, maxStudents, status, liveStatus } ],
  seats: { sold, capacity },
  students: { distinctTotal },
  earnings: { grossMinor, commissionMinor, netMinor, owedMinor, paymentCount, currency },
  activityByMonth: [ 6 × { month, completed } ],
  unread: { notifications, messages },
  materialsPublished,
  onboarding: { step, status, strikes: { missed, limit } },
  profileCompletenessPercent
}
```

`currency` is added to the earnings block from `PlatformSettingsService`.
`my-balance` omits it today, which is a rendering bug waiting to happen.

## Frontend

- `app/dashboard/page.tsx` — role router redirecting to the right dashboard,
  copying the working `app/profile/page.tsx` pattern. This also repairs the
  backend email that links to `/dashboard`.
- `app/instructor/dashboard/` + `views/instructor/dashboard/InstructorDashboardPage.tsx`
- `app/student/dashboard/` + `views/student/dashboard/StudentDashboardPage.tsx`
- `components/dashboard/` — shared `StatTile`, `NextClassCard`, `SectionCard`,
  `DashboardSkeleton`, `DashboardEmpty`, and a `useCountdown` hook.
- Login redirect (`views/Login/useLogin.ts`) sends both roles to `/dashboard`.

### Auth gate

Today **no route protection exists anywhere** — no middleware, no layout guard,
no guard component. Every instructor and student page is reachable by URL, and
the only thing stopping a stranger is that the API 401s.

The dashboards use the `useAuthHydrated` pattern already proven in
`app/profile/page.tsx`. Deciding before the persisted store rehydrates bounces
signed-in users to `/login`, which is why that hook exists.

A general route guard for the rest of the app is out of scope here, but this
establishes the pattern.

### Visual language

Match the house style rather than invent one: frosted `bg-card/60
backdrop-blur-xl border-border/50` panels at `rounded-3xl`, the signature 135°
purple→magenta→cyan gradient hero with soft white blobs, `text-[11px] font-bold
uppercase tracking-wider` eyebrows, restrained framer-motion (fade-and-rise,
no stagger orchestration).

Loading uses skeletons in the shape of the real content, following
`views/shop/index.tsx`, not a centred spinner. Every fetch renders one of four
states — loading, error, empty, data. Most existing pages swallow load errors
and render zeros, which is indistinguishable from a genuinely empty account.

**Charts must not copy `EarningsPage`'s palette.** That page hardcodes
`bg-white`, `text-gray-800` and hex axis colours and is completely broken in
dark mode. New charts drive colour from `var(--primary)` and `var(--border)`.
Note `--primary` changes *hue* between themes (deep purple → luminous cyan), so
both themes need looking at, not assuming.

## Adjacent fixes

Small, and directly under the new pages:

- Both sidebars hardcode **"John Doe / Premium Instructor"** and **"Jane Smith /
  Enrolled Student"** in their footer cards. Wired to the real auth store.
- The header's Dashboard pill sets `highlighted` but the render reads
  `isHighlighted`, so it never gets its active styling.

## Testing

- **Backend:** a Jest spec for the aggregate, following `admin.service.spec.ts`.
  Covers role branching, the distinct-student dedupe, the unread totals, and
  empty-account zeros.
- **Frontend:** no test runner exists, so verification is `tsc --noEmit`, `npm
  run build`, and a real browser pass with the probe tutor and student accounts
  — both roles, both themes, and an account with no classes — with screenshots.

## Out of scope

Fixing the dead endpoints themselves (`my-earnings`, `my-students`,
certificates), the admin panel, a site-wide route guard, and any earnings chart
until card collection exists.
