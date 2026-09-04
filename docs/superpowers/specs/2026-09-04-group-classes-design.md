# Group Classes — Design

**Date:** 2026-09-04
**Status:** Approved

## Problem

The platform only supports 1-to-1 private tutoring. A class is created by
`requestClass()` with exactly one student (`students: [requester]`), and no
UI ever calls the existing `enroll` endpoint. Tutors cannot teach several
paying students in one live session.

The streaming layer is already group-capable — chat, notifications and the
HLS access token all iterate the `students` array — so this work adds only
the *joining* half.

## Workflow

1. Student asks the tutor about the group class and its price **in the
   existing chat**. No new code.
2. Tutor creates a group class (seat limit + price) and shares its **invite
   link**.
3. The link shows the student the topic, time, price and seats remaining.
4. Student pays. Payment success — not a public endpoint — enrols them.
5. Only paid students are ever in `students[]`.
6. A student may **leave**. Leaving frees their seat for someone else.
7. Leaving is **permanent**: that student can never rejoin this class.

## Decisions

| Question | Decision |
|---|---|
| Refund on leave | None automatic. The leave is recorded; refunds stay a manual admin action. Money is never moved by this feature. |
| Who may use the link | Anyone holding it may pay and join while seats remain. No per-student approval. |
| Tutor removing a student | Allowed, and permanent — same effect as the student leaving. |

## Schema

`ClassSession` gains:

- `visibility: 'private' | 'group'` (default `private`, so every existing
  class behaves exactly as before)
- `maxStudents: number` (default 1)
- `price: number` (default 0)
- `inviteToken: string | null` — random, unique, indexed
- `leftStudents: ObjectId[]` — the permanent-exit list

`Order` gains `classId` — today it references only `courseId`, so a class
purchase cannot be recorded.

## Concurrency

Both membership changes are single atomic queries. Read-then-write would let
two students take the last seat.

Join:
```
findOneAndUpdate(
  { _id, visibility: 'group', status: SCHEDULED,
    students: { $ne: student }, leftStudents: { $ne: student },
    $expr: { $lt: [{ $size: '$students' }, '$maxStudents'] } },
  { $push: { students: student } })
```
`null` means full, already joined, previously left, or not joinable.

Leave / remove:
```
findOneAndUpdate(
  { _id, students: student },
  { $pull: { students: student }, $addToSet: { leftStudents: student } })
```

## Payment integration

Seats are granted by money, never by a request. The payments module already
exposes `FulfilmentRegistry` and a `RevenueArea.CLASSES`, so the two halves
hang off that seam and payments never imports classes:

- `GroupClassCheckoutService.startSeatPurchase` — prices the seat
  (`toMinorUnits` against the platform currency), names the tutor as seller,
  and calls `PaymentsService.startPayment`.
- `GroupClassFulfilment.onPaid` — the ONLY caller of `join`. Registered for
  `RevenueArea.CLASSES` on startup.

`GroupClassService.join` is therefore unreachable from any route: there is no
"enrol me" endpoint for a group class.

**Known gap:** two students can both pass checkout for one remaining seat and
both pay. The second `join` fails after the money moved, and with no automatic
refunds that is a manual correction. `startSeatPurchase` checks seats first to
narrow the window, and the fulfilment handler deliberately lets the failure
throw so it is logged rather than lost.

## Access control

The pre-existing `POST /classes/:id/enroll` adds the caller to the roster with
no payment. It is correct for a private class and a free-seat giveaway on a
group one, so it now refuses group classes.

**Bug fixed as part of this work:** `LiveHlsService.assertPlayable` verifies
only the token's class id, while `mintPlaybackToken` checks enrolment just
once at mint time. A 6-hour token therefore keeps working after a student
leaves. `assertPlayable` must re-check current enrolment.

## Endpoints

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/classes/group` | tutor | create a group class, returns invite link |
| GET | `/classes/invite/:token` | student | public preview + seats left |
| POST | `/classes/:id/purchase` | student | start payment for a seat |
| POST | `/classes/:id/leave` | student | leave permanently |
| DELETE | `/classes/:id/students/:studentId` | tutor | remove permanently |
| GET | `/classes/:id/roster` | tutor | enrolled + departed lists |

## Out of scope

Refund automation, waiting lists, recurring batches, per-student invite
links, partial-attendance tracking.
