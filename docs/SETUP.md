# Going live

About 30 minutes the first time. At the end you have:

- the portal at **https://compete.sfmathopen.org**, rebuilt whenever the code changes;
- a Supabase database holding the roster, problems, answers and staff accounts;
- you as the first admin, ready to invite proctors.

Nothing here touches sfmathopen.org or mathcloud.sfmathopen.org: you only add one new DNS record.

```
 student or proctor's browser
        │
        ├──► Cloudflare Pages          the site itself (static files, free, no bandwidth cap)
        │      compete.sfmathopen.org
        │
        └──► Supabase                  the database, every rule, and staff sign-in
               Postgres functions      sign-in, timing, grading, Mystery Dive scoring
```

The browser only ever holds Supabase's *publishable* key, which is meant to be public. Every table is closed to
it; the browser can only call the database functions in `supabase/migrations/0001_sfmo.sql`, and each one checks who is
calling and whether the round is open, by the database's own clock.

---

## 1. Create the Supabase project

1. <https://supabase.com> → sign in with GitHub → **New project**.
2. Name `sfmo27-online`, a strong database password (keep it somewhere safe), region **West US (North California)**.
   Free plan is fine to start.
3. When it's ready: **Project Settings → API Keys**. Copy the **Project URL**
   (`https://abcd1234.supabase.co`) and the **publishable** key (`sb_publishable_…`). Never put the *secret* key
   anywhere in this project; it isn't needed.

## 2. Load the database

1. In Supabase: **SQL Editor → New query**.
2. Open [`supabase/migrations/0001_sfmo.sql`](../supabase/migrations/0001_sfmo.sql) on GitHub, click **Raw**, copy
   everything, paste it into the editor, **Run**. You should see "Success. No rows returned".

It's safe to run again: after any update to that file, paste and run it again. Your roster, problems and answers
stay.

## 3. Staff sign-in settings

In Supabase, **Authentication**:

- **Sign In / Providers → Email**: leave Email enabled. Turn **Confirm email** *off*. Supabase's built-in mailer
  only sends to members of your Supabase team, so proctors would never get the confirmation. This is safe: an
  account on its own can do nothing; staff access needs an invite code from an admin (or the SQL in step 6).
- **URL Configuration**: **Site URL** `https://compete.sfmathopen.org`, and add
  `https://compete.sfmathopen.org/**` under **Redirect URLs**. (Password-reset links come back here.)

Students don't use Supabase accounts at all: they sign in with their student ID and registration email, checked
against the roster you import.

## 4. Put the site on Cloudflare Pages

1. <https://dash.cloudflare.com> (a free account is enough) → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick **MathCosine/sfmo27mathcloud** and the branch to deploy (`main` once this work is merged).
3. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. **Environment variables** (Production):

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your publishable key |
   | `NODE_VERSION` | `22` |

5. **Save and Deploy**. In a minute you get an address like `sfmo27-online.pages.dev`. Open it: you should see the
   sign-in page with your schedule on the right, and no "Demo" bar.

Without the two Supabase variables the site builds as the in-browser demo instead. That's handy for showing
people, but nothing is saved anywhere.

## 5. compete.sfmathopen.org

1. In Cloudflare, the Pages project → **Custom domains → Set up a custom domain** → `compete.sfmathopen.org` →
   Continue. Cloudflare shows a CNAME to add.
2. sfmathopen.org's DNS is at **Spaceship** (the same place `mathcloud.sfmathopen.org` was added). Spaceship →
   **Domain list → sfmathopen.org → DNS records → Add record**:

   | Type | Host | Value | TTL |
   | --- | --- | --- | --- |
   | CNAME | `compete` | `sfmo27-online.pages.dev` (your Pages address) | Automatic |

3. Back in Cloudflare, wait until the domain shows **Active** (usually a few minutes). HTTPS is set up for you.

Prefer another name? `online.`, `test.` or `portal.sfmathopen.org` all work the same way; use the same name in
step 3's URL settings.

## 6. Make yourself the first admin

1. Open **https://compete.sfmathopen.org/#staff** → **Create an account** with your email and a password.
2. It says you're not on the staff list yet and shows one line of SQL. In Supabase's **SQL Editor**, run it:

   ```sql
   select sfmo_make_admin('you@example.com');
   ```

3. Reload the staff page. You're in.

## 7. Invite proctors

**Staff & invites → Invite someone** makes a one-time code (valid two weeks). Send it with the address. They open
`/#staff`, create an account, and enter the code. Proctors can run rounds, announce, fire Mystery Dive events and
sign students out; admins can also edit problems, the roster and settings, and reset things.

## 8. Load the contest

1. **Event settings**: date, time zone, welcome text, default Zoom link, contact email.
2. **Teams & students → Import CSV**: export your registration sheet (one row per student: team number, team name,
   student ID, name, email; a Zoom link column per team is optional). Columns are matched by their headers; you
   can change any match before importing. Import again any time: existing IDs are updated.
3. **Rounds & problems**: open each round. **Paste from a spreadsheet** takes two columns, problem and answer
   (plus points and set for Guts). Write maths as `$x^2$`. In the answer box list every accepted form separated by
   `|`. Plain numbers already match any equal value (`0.375`, `3/8` and `6/16` are the same answer).
   **Preview as a student** shows exactly what they'll see.
4. **Mystery Dive → Settings**: starting score, sinking speed, patch and torpedo values. The page tells you how
   long a team that never answers takes to hit Rock Bottom. See [MYSTERY.md](MYSTERY.md).

## 9. Rehearse

Do one full run with a few staff on phones and laptops: start the Practice round, sign in as a student (add
yourself to the roster), run a short Mystery Dive with a couple of events, hand in Guts sets, then **Reset & clean
up → Clear all answers**. Tell students to try the Practice round the week before.

---

## Proctoring

What the portal does on its own, set per round under **Rounds & problems → Settings → Proctoring**:

- **Full screen** (on for individual rounds): students start the round with an "Enter full screen" button. Leaving
  full screen hides the problems behind a "Return to full screen" screen and logs how long they were out. Phones
  that can't go full screen are allowed, and flagged.
- **Zoom check-in** (on for team rounds): before the problems appear, each student ticks "in my team's Zoom room",
  "camera on", "microphone on". The database won't send the problems or take answers until they have.
- **One device per student** (Event settings): signing in somewhere new signs the old device out, with a message
  saying why, so a login can't be handed to someone else mid-round.
- Problem text can't be selected, copied or right-clicked (attempts are logged), and the student's ID and name are
  watermarked faintly behind it.
- Leaving the tab is logged on every round.

What proctors do, on the **Proctoring** page (updates every 3 seconds): every student by team, whether they're
online, which round they're on, whether they're in full screen and the tab is in front, whether they've checked in,
and their recent flags. "Needs a look" filters to the ones that aren't right. **Hold** a student or a whole team
when a camera or microphone is off in Zoom: their screen locks with your message ("turn your camera on in Zoom"),
the database refuses their answers, and it unlocks by itself when you press **Release**.

A browser can't see into Zoom, so the camera and microphone rule rests on the check-in plus proctors watching the
room, with holds as the enforcement.

## Contest day

**Before:** Supabase on **Pro** for the month (daily backups, never pauses; about $25). Check **Control room**:
every round has problems and no "without a key" warning. Set **Sign-in** open in Event settings.

**Running a round:** Control room → **Start now** (or **Schedule** it to open by itself). Everyone's clock is the
database's, so it ends at the same moment for everyone; students with extra time (set per student in Teams &
students) keep going on individual rounds.

| Something goes wrong | Do this |
| --- | --- |
| Zoom or the internet drops for everyone | **Pause**: nobody can change answers, nobody sinks, and the clock resumes with the time that was left. |
| A few minutes lost to a hiccup | **+5 min** on the round. |
| You closed too early | **Reopen** for a few minutes. In the Mystery Dive nobody sinks for the time it was shut. |
| A student's wifi drops | Nothing to do: answers wait on their device and send themselves when it's back. The corner shows "Reconnecting". |
| A student's camera or microphone is off | Proctoring → **Hold** (the student or the team), then **Release** when it's fixed. |
| A student is on two devices, or someone else is using their login | Signing in on a new device already signs the old one out. Teams & students → **Sign out**, or **Pause** to block them until you unpause. |
| A clarification | Control room → **Announce**: a banner on every screen within seconds, everywhere or only in one round. |
| An answer that isn't in the key is actually right | Results → **To review** → **Accept**: everyone who gave it is regraded. |
| A Mystery Dive score needs fixing | Mystery console → the team's **Adjust**. |
| Bad rehearsal data | Reset & clean up → **Clear all answers**, or **Reset** on a single round. |

Every staff action is in **Activity log**, and every tab switch is in **Tab switches**.

**Projector / stream:** `/#board-mystery` and `/#board-guts`. Staff can always open them; turn on "Anyone with the
link can open the projector boards" in Event settings to share them.

---

## Updating the site

Push to the deployed branch and Cloudflare rebuilds in about a minute. If the change touched
`supabase/migrations/0001_sfmo.sql`, run it again in the SQL Editor (step 2). It only replaces functions and adds
what's missing.

## Limits worth knowing

- **Load:** students' pages ask for updates every 2 s in the Mystery Dive, 4 s in Guts and 15 s otherwise, through
  ordinary requests (no live sockets, so Supabase's connection limits don't apply). 150 students in a Mystery Dive
  is about 75 small requests a second, which Postgres handles easily; Pro's larger compute gives headroom.
- **Pausing:** free Supabase projects pause after a week with no requests. The **Keep Supabase awake** GitHub
  workflow pings it every three days once you add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as repository variables
  (Settings → Secrets and variables → Actions → Variables). Not needed on Pro.
- **Backup host:** if Cloudflare is ever a problem, **Actions → Deploy to GitHub Pages → Run workflow** publishes the
  same site to GitHub Pages (same two variables). Point the `compete` CNAME at `mathcosine.github.io` instead and
  set the custom domain in the repository's Pages settings.
