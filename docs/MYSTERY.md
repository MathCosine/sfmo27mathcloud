# Mystery Dive: how the online version works

Everything below is enforced by the database, not the page, so a student can't change it by editing their browser.

## The rules

- Every team's submarine starts at **200** and sinks continuously at **0.1 points a second** (both are settings;
  at 0.1/s a team that never answers hits the bottom after 33 min 20 s of a 45-minute round).
- Every question gets **one try per team**. All questions are visible at once and scroll like a normal test.
- A right answer is a **hit**. The team spends it straight away:
  - **Patch the hull:** +20 to your own score, or
  - **Torpedo** another team: −10 to theirs. Everyone sees who fired at whom (a setting can hide the attacker).

  A team can't submit another answer until it spends its hit, so nobody can stockpile torpedoes for the last
  minute. Any teammate can spend it.
- **Rock Bottom:** the moment a score reaches 0 the team is at Rock Bottom. It can still answer and fire torpedoes,
  but its score can never rise again (patches and positive events do nothing), and it scores 0 for the round
  unless a **Salvage** brings it back. Teams at Rock Bottom can't be torpedoed (a setting allows it).
- The final score is each team's depth when the round closes.

## Events (Mystery console)

Each one opens a short form first, so you can change the numbers, the targets and the message before firing.

| Event | Effect |
| --- | --- |
| **NUKE** | −100 to the teams you pick (starts with the leader picked) |
| **Non-trivial's Salvage** | Every team at Rock Bottom goes back to 10. Nobody else is touched. |
| **Riptide** | Everyone sinks ×2 for 60 s |
| **Calm waters** | Nobody sinks for 60 s |
| **Thermal vent** | Everyone *rises* at the sinking speed for 30 s (not teams at Rock Bottom) |
| **Kraken** | −40 to one random team still afloat |
| **Depth charge** | −15 to everyone |
| **Leak** | The teams you pick sink ×3 for 90 s |
| **Supply drop** | Patches are worth ×2 for 2 min |
| **Torpedo frenzy** | Torpedoes do ×2 damage for 2 min |
| **Shields up** | The teams you pick take no torpedo damage for 2 min |
| **Rescue sub** | +25 to the three deepest teams still afloat |
| **Shark attack** | −25 to the top three |
| **Message only** | A banner on every screen; changes nothing |
| **Custom event** | Any of: add/take points, set a score, a timed multiplier on sinking speed, patch value, torpedo damage dealt or damage taken, or a Salvage. Targets: everyone, picked teams, N random, top N, or the N deepest afloat. Timed effects last a number of seconds, or until you end them. |

Effects stack by multiplying: Riptide (×2) during a Leak (×3) sinks a leaking team ×6. **Active effects** lists
what's running, with **End now**. **Adjust** on any team adds, takes or sets points by hand, for appeals; it is
logged but not shown to students.

Untick "Show it on students' screens" to run an event quietly. **Pause** freezes everyone; **Reopen** after a close
doesn't count the closed time.

## How scores are kept

Each team's depth is stored as a snapshot: a score at a moment. Between snapshots it falls by the sinking speed
times every multiplier active at the time. Multipliers only ever start or end *now*, so the past never changes.
Every patch, torpedo and event locks the teams it touches (always in the same order, so two teams torpedoing each
other can't deadlock), works out their exact depth at that instant, applies the change and saves a new snapshot.
If a team drifted to zero between snapshots, the database records the exact second it hit Rock Bottom.

Students' screens fetch the board every two seconds and animate the sinking in between, so the numbers move
smoothly but always come back to what the database says. Changing the sinking speed mid-round pins every team's
depth first, so nobody jumps.

The tests in `tests/db.test.ts` check all of this: sinking, one try per question, hits, torpedoes, armor,
multipliers over exactly their window, Rock Bottom, Salvage, drifting to zero at the right second, pause, close and
reset.
