# SFMO 2027 Online

The testing portal for the online division of the San Francisco Math Open: students sign in with their ID and
email and take the **Individual** round, the live **Mystery Dive** and **Guts** with their team; proctors run the
rounds, fire Mystery Dive events and watch the boards. Registration stays wherever it is now: you import the roster.

**Going live:** [docs/SETUP.md](docs/SETUP.md) (Supabase + Cloudflare Pages at `compete.sfmathopen.org`).
**Mystery Dive rules and events:** [docs/MYSTERY.md](docs/MYSTERY.md).

## Try it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Without Supabase settings the whole thing runs in your browser: the real database
functions in PGlite, twelve demo teams, and bot teams playing the live rounds. The **Demo** bar (bottom left)
switches between a student, the director and a proctor, opens the projector board, and can **drop the
connection** to show what students see in an outage.

## What's in it

**Students**
- Sign in with student ID + registration email (no passwords). Sessions are random tokens stored only as a hash;
  repeated wrong guesses for one ID are slowed down.
- Home: the day's schedule in the event's time zone, live countdowns, their team and who's online, the Zoom link,
  announcements.
- Tests that scroll like a paper: answers save as you type, show "Saved", and wait on the device through a dropped
  connection (even a reload) until they reach the server. Maths previews as you type.
- Timing by the database clock: problems arrive only when the round opens, and saves after the deadline (plus a
  few seconds' grace) are refused by the database. Extra time per student for accommodations.
- Guts: shared answers for the team, hand in a set to open the next, live board.
- Mystery Dive: live depth, sonar, standings, attack feed, proctor events as banners, one try per question,
  patch or torpedo after each hit.
- Leaving the test tab is logged (and, by default, the student is told).

**Staff** (`/#staff`, Supabase accounts + invite codes)
- Control room: start, schedule, pause, +5 min, close, reopen and reset each round; announcements; who's online.
- Mystery console: 13 one-click events plus custom ones, active effects, per-team adjustments, full log.
- Rounds & problems: create rounds of any type, edit rules and timing, paste problems from a spreadsheet, preview.
- Teams & students: CSV import with column matching, edit, extra time, sign out, pause a student.
- Results: scores, per-problem stats, review answers not in the key (accepting one regrades everyone), CSV export.
- Tab switches, Staff & invites, Event settings, Activity log, Reset & clean up.

## Commands

| | |
| --- | --- |
| `npm run dev` | Dev server (demo mode unless `.env.local` has Supabase settings) |
| `npm test` | Database rule checks on PGlite (sign-in, permissions, timing, Guts, every Mystery Dive rule) and answer matching |
| `npm run build` | The site, in `dist/` |
| `npm run build:demo` | The self-contained demo, in `dist-demo/` |
| `./scripts/test-pg.sh` | Loads the migration into a real local Postgres, as Supabase would |

## Where things live

```
supabase/migrations/0001_sfmo.sql   the whole backend: tables, rules, every function the site calls
src/lib/api.ts                      calling the backend, server clock, connection state
src/lib/outbox.ts                   answers waiting to be saved
src/lib/answers.ts                  what counts as the same answer
src/pages/student/                  sign-in, home, Individual/Guts, Mystery Dive
src/pages/staff/                    the staff screens
src/pages/Projector.tsx             the projector boards
src/demo/                           the in-browser demo and its bots
tests/                              database tests
```
