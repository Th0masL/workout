# Workout — rings & bodyweight

A local-first, no-build web app for a home program built around Olympic rings, push-up bars and a
10 kg adjustable weighted vest — plus two chairs that were already in the room. **Two or three
sessions a week, alternating A and B, no fixed days.**

It holds the program, tells you what to do next, times the rests and the holds, logs the sets, and
works out what the next session's numbers should be — so there is nothing to decide mid-workout
and nothing to remember between sessions. All state lives in the browser: no backend, no accounts,
no build step.

**Everything you need on day one: the rings and the push-up bars.** The 20 cm sofa chair first
appears around week 5, the 45 cm chair around week 7, and the vest around week 8.

## Run

Open [index.html](index.html) in a browser. That is it.

On a phone, **add it to the home screen**: it is an installable web app, so it launches fullscreen
with no browser chrome, its own icon and the active theme carried into the status bar. The layout is
mobile-first and tap targets are 44 px.

**Opening `index.html` directly from disk works**, but it is the weaker mode: `file://` has no
service worker (so nothing is cached and there is no offline guarantee), the manifest is blocked,
and it cannot be installed to a home screen. Illustrations do render — `crossorigin` is dropped on
`file://`, because a CORS request there is rejected outright and would otherwise kill every image,
local ones included. Serve over https for the real thing.

**It works with no connection.** A service worker caches the app shell, so it opens instantly and
runs offline — useful when the wifi drops mid-session. Your training data was never online anyway;
it lives in localStorage, which the cache never touches.

**Illustrations are precached in the background** after the active worker receives a request from
the page, rather than on first view. The work is attached to that message event with `waitUntil`,
so the browser cannot terminate the worker halfway through. Caching them lazily meant any exercise
whose ⓘ panel you had never opened had no picture offline — patchy in a way that looked like a bug
because it was one. They stay out of the install list so 2.4 MB never delays startup; the **Data**
tab reports whether the set is complete or whether some remote files need another connected retry.

The offline fallback is **limited to navigations**. It used to hand `index.html` to anything that
failed, so an uncached image received HTML with a 200, failed to decode, and vanished silently —
indistinguishable from a missing file. Non-navigations now get a 504.

The worker is deliberately **network-first with a cache fallback**, not cache-first: the small shell files
cost nothing to re-fetch, and it means an edit shows up on the next reload instead of the one after.
The network leg has a 2.5-second deadline, so a weak radio uses the cached screen promptly instead
of behaving worse than a fully offline connection; the request continues in the background and
refreshes the cache if it eventually succeeds.
It also bypasses the browser's own HTTP cache on the network leg — without that, a host which sends
no `Cache-Control` (`python -m http.server`, and plenty of static hosts) lets the browser apply
heuristic freshness and serve stale bytes to the worker, which defeats the whole point. Bump
`VERSION` in [sw.js](sw.js) to force every client to discard its workout cache. Cache cleanup is
restricted to the `workout-program-` namespace, because Cache Storage is shared with every other
app on the same origin. The required shell installs atomically: if any boot file is unavailable,
the previous complete worker stays in charge instead of activating a partial offline app.

**The screen is kept awake for the length of a session**, via the Screen Wake Lock API. Two things
are worth knowing, and the **Data** tab shows the live status so you never have to guess:

- **It needs a secure context.** `https`, `localhost` and `file://` all work. Plain `http://` to a
  LAN address does **not** — the API is simply absent there and the screen will sleep. So serve it
  over https (GitHub Pages is enough) or copy the files onto the phone and open them directly.
- **The spec drops the lock whenever the page is hidden and never restores it.** Switch apps to
  change the music, take a call, and the screen would start sleeping again on your return. The app
  therefore re-claims it on every return to visibility, and again after a reload if a session was
  left running.

## Using it

Everything below exists to answer one question without you having to think about it: **what do I do
next?** One card is marked `NOW`, every wait is written down where it happens, and the app says out
loud what is coming so you can leave the phone on the floor.

Three clocks run:

- **Rest timer** — starts automatically when you log a set, using that exercise's own interval.
  Pinned to the bottom of the screen, beeps and vibrates at zero, with `+30s` and skip. It names
  what is coming, distinguishing the next set from the next exercise (`Next: Push-ups`).

  **Supersets are run by round, not by exercise.** Log the first half and it says *"Ring face pulls
  now"* with no timer at all; log the second and the rest starts, pointing you back at the first for
  round two — `A1 B1 rest A2 B2 rest`. Resting between the halves would defeat the reason for
  pairing them, and it is where the session's time saving comes from.
- **Hold timer** — for the timed exercises (movement prep, dead hang, ring fallouts) the tick button
  becomes **Start**. It first counts you in — five seconds by default, adjustable in Data — because
  when you tap Start you are not in the rings yet, and those seconds would otherwise be logged as
  part of the hold. Beeps on the last three, then a higher tone and "Go". Cancelling during the
  countdown logs nothing at all.

  Then it counts *up*, calls the seconds out as they pass, beeps at the target, and logs whatever
  you actually held. Counting up is deliberate: fail a plank at 22 s against a 30 s target and it
  must record 22, not 30 — and holding 35 s earns the overshoot credit the progression engine gives
  for beating a range.
- **Session elapsed** — in the header, and stored so History shows how long each session really took.

A hold survives closing the tab, logs itself if you start another one, and logs itself if you hit
Finish while it is still running.

### What is on a card

A card answers three questions and nothing else, because everything on screen during a session
competes with the set you are about to do:

| | Element |
|---|---|
| **What to do** | `3 × 6 reps · +2 kg` |
| **Which variation** | `LEVEL 1/4 · Feet on floor, heavy assist` |
| **What to fetch** | equipment chips |

The variation is not supplementary detail — `Push-ups · 3 × 10` is an incomplete instruction when
level 1 is knees-down and level 4 is feet on a 45 cm chair. The `1/4` doubles as the only progress
indicator on the card. Exercises with a single-level ladder show no level line at all.

Three things earn an exception: the `PREP` tag, a `⇄ Inverted rows` tag when an exercise is supersetted
(it changes how you run the session, not just how you perform the movement), and the one-line
caution on ring dips.

Everything else — form cues, the note for the current level, the superset rationale, the full
ladder, rest, range and the demo link — lives behind the ⓘ. Cues in particular were the bulk of the
clutter: useful for the first two sessions, noise for the next fifty.

**The cues are the level's, not the exercise's.** A pistol squat and a bodyweight squat share the
split-squat ladder and nothing else, so "front shin roughly vertical" is the wrong instruction for
one of them. The ladder in the ⓘ badges which rungs re-coach the movement, are done per side, or
carry their own rep range.

Each card lists the **kit it needs at the level you are currently on** — `push-up bars`,
`chair 45 cm`, `vest 2 kg`, or `no equipment`. Not a fixed per-exercise list, because that would be
wrong most of the time: push-ups start on the bars, pick up the sofa chair at level 3, the 45 cm
chair at level 4, and end up in the rings at level 5. A level's own kit replaces the exercise
default rather than adding to it, so level 5 does not still claim you need the bars. Tests assert
every token has a UI label and that the push-up hand-off is exactly that sequence.

One exercise — **ring dips** — carries an amber stripe down the left of its card. It is the
highest-risk movement in the program after a long layoff, and depth is what hurts shoulders, so the
card states the depth cap in amber rather than leaving the stripe to mean something unexplained. A
test asserts the stripe and the caution text can never exist without each other, because a coloured
bar with no legend is noise and a caution with no stripe goes unread.

Supersets **name their partner on the card** — "⇄ Alternate sets with Ring face pulls — one rest
covers both". This went through two wrong versions first: a bare `superset` tag made four
consecutive cards look like one four-way group, and `A1/A2, B1/B2` fixed the grouping but needed a
legend and hid the partner in a tooltip, which does not exist on a phone. Plain words need neither.

Each station renders as a section heading rather than another panel — the exercise cards already
carry borders, so grouping is done with type and space instead of nesting boxes. It carries a
`2 / 4` counter, and the stations needing a ring adjustment are picked out in blue, since those are
the only points in a session where you touch the hardware.

### One set at a time

Within an exercise, only the set whose turn it is has a live button; the rest are dimmed and
disabled. Reported from real use — a mis-tap on the wrong row records a set you have not done, at
numbers meant for later, and a tick appearing in the wrong place is the only clue.

The `disabled` attribute is a hint, not a guarantee — the delegated click handler never sees it —
so the handlers check the turn as well, and an out-of-turn tap does not even start a session. Undo
hands the turn back to the row it reopened; a cut set is stepped over rather than blocking the ones
behind it.

### Two ways to finish a hold

Timed exercises carry **Start** *and* a **✓**. Start runs the clock; the tick logs the number shown
without running anything. Without the second one a mistimed hold could never be corrected — undo
put the row back, but Start was the only way out of it, which means hanging for another thirty
seconds to fix a miscount. The round trip is: undo → adjust with −/+ → ✓.

### Skipping a whole exercise

The ⊘ on a card drops every set it has left, and ↺ puts them back. Cutting them one tap at a time
works but is absurd when the answer is "not today" — and `minSets` makes it impossible anyway.
This ignores that floor deliberately: the floor exists to stop an exercise being *degraded* to one
set, and dropping it entirely is a different decision. Sets already logged are kept.

### Correcting the level by hand

The ⓘ panel carries a **Your level  −  3 / 5  +** stepper. The app's idea of where you are can be
wrong — a ladder gets rewritten, you come back from a break, or it simply started you in the wrong
place — and until this existed the only remedies were resetting all sixteen exercises or editing
the exported JSON.

A level set by hand is a fresh start on that rung: the reps go to the bottom of *its* range and
streaks earned elsewhere do not follow you there. It locks once you have logged a set of that
exercise today, because the session files those sets under the level as it stands at the end, and
moving it afterwards would mislabel the history.

### Where you are

One card is marked **now** — a green edge, a `NOW` chip, and the one set to do
picked out inside it. When the exercise changes the page brings that card into view;
it does not move for every logged set, which would yank the page around under your thumb.

Which card that is comes from the same timeline walk the rest timer uses, so the highlighted
card is always the one the voice just announced. It looks **forward from the last set you
logged, then wraps** — skip the warm-up and the marker moves on with you rather than sitting
on it, but the skipped set is still reachable at the end. Undo is the one exception: reopening
a set puts you back on that set, because that is what undo means.

### Every wait is a step

Rest is most of a session — 150 s between sets of pull-ups against about 18 s of actual pulling.
It used to exist only as a bar at the bottom of the screen, and only once a set had been logged,
so the page read as if the sets ran back to back and there was no way to see how long the next
wait was until it had already started.

Now the waits sit in the sequence, between the set rows and between the cards:

```
1   6 reps                            undo
┃ 2:29   resting · set 2 next        [Skip]
2   −   6 reps   +                       ✓
    ⏱ Rest 150 s
3   −   6 reps   +                       ✓

⏱ Rest 150 s   before Hanging leg raises
```

The one that is running shows the same clock as the bar. A superset says what actually happens —
`⇄ Ring face pulls, then rest 90 s` — because the wait comes after the partner, not after this
set, and "rest 90 s" there would have you standing still through half the round. Tapping a wait
that has not started yet starts it.

### Holds are counted out loud

A hold is the only thing in the program with no reps to count, and you cannot look at a phone
while hanging off the rings. So the seconds get called out as they pass — `"10" … "20 seconds"
… "30"` — and it keeps going past the target until you stop it, because the clock counts up
rather than down and going long is a good thing.

The target itself keeps its own beep and its own announcement, so the same number is never said
twice a beat apart. The interval is a setting (**Count out a hold**, default every 10 s, can be
switched off). It needs a voice; in beep-only mode the marks are silent.

The marks are announced on the *mark*, not on an exact second — a backgrounded tab throttles the
timer, and matching `seconds % 10 === 0` would drop a call whenever a tick was skipped.

### Cutting a set when time is short

Tapping the minus past its floor on a prescribed set drops it: the row stays — the fact that
there was meant to be a third set is worth keeping — but it reads *not doing this one* and
everything downstream treats it as though it was never prescribed. No time in the estimate, no
wait drawn before it, no place in the running order, and **not scored as a miss**. Plus puts it
straight back.

That last part is the one that matters: cutting a set because you are short of time must not
deload you for being busy. Simply leaving a set unlogged is still a miss, because that is a
different thing from deciding in advance not to do it.

The floor is the same `minSets` the time-cap trimmer respects — cutting a main lift to a single
set is a different session, not a shorter one, so the minus stops rather than going to zero.

Two ways to shorten a session, then: **Time today** picks the sets for you by importance, and
this picks them by hand.

### When something breaks

Nothing here should ever fire, but the alternative failure mode is a blank or frozen page with
the reason in a console nobody opens on a phone — at which point there is no way to tell a
rendering bug from lost training data.

`render()`, the tap handler and the one-second timer are each wrapped, with `window.onerror`
behind them. A failure shows a banner naming what broke, states that every logged set is
already in localStorage, and offers **Reload**, **Download a backup** and **Dismiss**. The rest
of the page keeps working — the rest timer carries on counting.

The banner's own buttons are bound directly rather than through the delegated click handler,
because that handler is one of the things that might be broken.

### Sound

Three modes in the **Data** tab: *speak*, *beep only*, or *silent*. The beep is a synthesised
880 Hz tone — no audio file, so it works offline everywhere. Speaking uses the Web Speech API and
the device's own voices, picking an English one explicitly rather than the system default, because
on a phone set to another language the default voice reads the exercise names with the wrong
phonetics.

A **🔊 button sits in the header on every tab** — one tap plays the beep and the spoken sample, and
a toast reports what actually happened ("Beeped, then *Dips, set two*", or "Beeped — no voice
available in this browser"). It is there because sound is the one thing you cannot verify by
looking, and because Bluetooth output needs waking before it behaves.

A **Voice** picker appears in settings listing the English voices your device exposes, and selecting
one speaks a sample immediately. The 🔊 test names the voice actually in use, so "which voice is
this?" is answerable rather than a guess.

The chosen voice is resolved at *speak* time, not just at startup. Firefox frequently has voices
ready before the page asks and then never fires `voiceschanged`, so a startup-only lookup silently
stays null — and with no voice set, speech-dispatcher falls back to its own module default, which
for RHVoice is `Elena+CLB`, a female voice. That was a real bug, and it looked exactly like a
configuration problem. Left on *Automatic* it deliberately avoids **espeak** if anything
else is present — espeak is a formant synthesiser from the 1990s and sounds like one, and on Linux
it is usually first in the list, so without that rule installing a better engine would change
nothing.

On Linux, better engines are one `apt install` away — see [Better speech on Linux](#better-speech-on-linux).

**Speech does not work in every browser, and the app says so instead of failing silently.** The
settings panel checks `getVoices()` and warns in red when the list is empty, and the Test button
reports what actually played. Known state:

| Platform | Beep | Speech |
|---|---|---|
| Android / iOS | ✅ | ✅ out of the box |
| Firefox on Linux | ✅ | ✅ via speech-dispatcher |
| **Chrome on Linux** | ✅ | ❌ Chrome does not bridge the Web Speech API to speech-dispatcher, so `getVoices()` is empty even with it installed |

Speech mode always beeps first, so on Chrome/Linux it degrades to exactly the beep-only behaviour
rather than going quiet.

What it says:

| When | Says |
|---|---|
| Session start | *"Workout A. Rings overhead"* |
| 10 s left of a rest over 25 s | *"Ten seconds"* |
| Rest ends | *"Dips, set 2, 6 reps"* — and *", 2 kilos"* if the vest is on |
| Mid-superset, no rest due | *"Ring face pulls, set 1, 12 reps, now"* |
| Hold count-in | *"Get ready"*, then *"Go"* |
| Every 10 s of a hold | *"10"*, *"20"*, *"30"* … past the target until you stop |
| Hold target reached | *"Twenty seconds"* |

The announcement carries the **numbers**, not just the name — reps or seconds, *per side* where the
level is unilateral, and the vest weight only when there is one. Without them you have to pick the
phone up off the floor to find out what you were just told to do, which is the thing the
announcement exists to save you.

The beep still fires first in speak mode: the tone gets your attention, the words tell you what.
That matters most on the rings, where your hands are busy and the phone is on the floor.

**Bluetooth wake-up.** A Bluetooth link idles between sounds and eats the first few hundred
milliseconds when it wakes — the first beep of a set vanishes and "Dips" arrives as "ips".
Every cue is therefore preceded by an **inaudible 120 Hz tone** that wakes the output, with the real
sound scheduled behind it, giving one continuous signal and no gap to fall asleep in:

```
120 Hz primer (inaudible)  |----------------------|   0 -> 660 ms
880 Hz beep                            |----------|   600 -> 960 ms
speech                                              ^  1010 ms
```

How much lead-in is a setting (**Data → Bluetooth wake-up**, default 600 ms), because hardware
varies enormously — raise it if the first word is still cut, drop it to zero on wired or built-in
speakers. The delay applies even when the primer is skipped, so a run of cues stays evenly spaced.

**Speech queues behind the beep.** Speech goes through the platform rather than the AudioContext,
so it cannot be scheduled on a timeline — it is held back until the warm-up *and* any scheduled tone
have finished, otherwise the tone and the words play over each other.

Diagnosing this is worth recording, because three plausible culprits were all innocent: RHVoice
rendered a complete 1.50 s file, the audio reaching the sink matched it envelope-for-envelope, and
raising `AudioPulseMinLength` changed nothing. Playing the same phrase twice back to back — first
clipped, second complete — is what identified the device rather than the software.

### Better speech on Linux

Firefox routes the Web Speech API through **speech-dispatcher**, which defaults to espeak-ng. It is
intelligible but robotic. Two upgrades, both packaged:

```sh
# Easiest — the espeak-ng-mbrola module is already installed, so this needs no config.
# Diphone concatenation of recorded speech instead of pure formant synthesis.
sudo apt install mbrola mbrola-us1

# Better still — RHVoice, noticeably more natural.
sudo apt install rhvoice rhvoice-english speech-dispatcher-rhvoice
```

Restart Firefox afterwards, then pick the new voice in the app's **Voice** dropdown. Check what
speech-dispatcher can see with `spd-say -L`, and test a voice directly with
`spd-say -o rhvoice "ring dips, set two"`.

None of this affects the phone, where the built-in voices are already good — and the phone is where
the app is meant to live.

### "Show me how"

The ⓘ panel on every exercise — on the Today tab and in the Program tab's reference — opens with a
**Show me how** link to a YouTube search, and shows the query it will run.

Two deliberate choices:

- **A search, not a video id.** A specific video can be deleted or made private and the link dies
  silently; a search URL never rots. It also lets you pick a demo you like rather than mine.
- **The query uses the name the movement is commonly known by, not the name this program uses.**
  Searching "ring leg curl" finds very little; **"TRX hamstring curl"** finds dozens of good demos
  of the identical movement. Same for ring fallouts, which the world calls **"TRX fallout"**. A test
  asserts the leg curl in particular keeps its common-name query, since that is the one where the
  difference matters most.

### Illustrations

Twelve of the sixteen exercises carry an illustration in the ⓘ panel — ten animated 360×360 GIFs
and two stills, all **© [Gym visual](https://gymvisual.com/)**, credited beneath each one. Three of
them (ring dips, ring rows, ring fallouts) are performed **on rings**; the rest substitute a bar or
a cable, where the action is identical and recognition is the point.

They are **hotlinked** from two personal forks rather than committed, and the service worker caches
them **cache-first** — so each is fetched from GitHub exactly once, then served locally forever and
works offline. That matters because `raw.githubusercontent.com` is rate-limited at ~60 requests an
hour and is not a CDN. The `<img>` needs `crossorigin="anonymous"` for this: without it the response
is *opaque* (`status 0`, `ok false`) and the worker silently declines to cache it.

Five more are stored locally rather than hotlinked: two (**ring leg curl**, **pike push-up**)
because their source sends no CORS header, which would either block the image or make it
uncacheable, and three (**ring face pull**, **ring pull-ups**, **dead hang**) because they replaced
approximations — a cable machine and two fixed bars — with the movement performed on straps and
rings. 468 KB for the five, all resampled from clips ten times that size.

### The ring height is a property of the LEVEL

Ring dips are the case that forced this. In a locked-out ring support your hands sit at your hips,
so your **hips are at ring height** — and therefore:

| rings at | feet reach the floor? | feet clear it at the bottom? |
|---|---|---|
| sternum, 135 cm | no — they hang 40 cm up | yes |
| mid-thigh, ~75 cm | yes, heels ~35 cm in front | no |

The two windows do not overlap, so no single height serves both. The assisted levels hang the
rings low and the unassisted ones hang them high, and `station` is carried by the rung rather than
the exercise. The session groups by whatever station each exercise is at *today*, so the dip moves
between blocks on its own as you climb, and the extra ring adjustment it costs disappears by
itself once you no longer need the legs.

That also killed an earlier fix of mine that put the feet on a 45 cm chair with the rings still at
sternum: the vertical drop is 90 cm against a 93 cm leg, so the chair would have to stand directly
under your hips, where your body is.

The harder problem turned out to be making the help **small and controllable**, not making it
large — two earlier attempts of mine failed on exactly that. Feet flat with the knees bent is a
squat with your hands on rings: 99% of the leg's push goes straight up and there is no way to feel
how much you are giving.

What works is starting **seated**. Rings at seated-shoulder height, legs straight out in front,
backside on the floor — that *is* the bottom of a dip, and it has three properties nothing else
had:

- **the floor is the depth stop**, so "no deeper than parallel" enforces itself rather than being
  a rule you have to remember mid-set;
- **the hands stay at your sides**, so the shoulder never sees the extension-plus-internal-rotation
  position that makes bench dips a bad idea after a layoff — which is the whole reason for owning
  rings rather than using a chair;
- **the legs are out in front and nearly flat**, so they can push a little but cannot squat you up.

The progression is the one everybody uses for bench dips — raise the heels, floor → 20 cm sofa →
45 cm chair — except the hands are on rings. Then the rings go back up, the feet come off, and the
**vest takes over from there**.

### Depth is a rung, and it comes before the vest

"Range before load" was the exercise's stated rule and the ladder broke it: the vest arrived while
you were still capped at upper-arm parallel. There was no path from *"stop at parallel"* to
anything deeper — just a permission slip in the Phase 3 notes.

Depth is now the **last rung**, and a rung can carry `minPhase`. Top out at parallel in Phase 2 and
the app holds you there, **banks the promotion**, and says what it is waiting for:

> Next up — **Bodyweight, below parallel** — opens in Phase 3. Earn it before then and it is banked.

The moment Phase 3 opens (18 sessions **and** 6 weeks) it cashes in, the reps reset to the bottom
of the range because a deeper dip is a harder dip, and the depth goes on a centimetre or two per
session. Only once that is owned does weight go on. It is the only gated rung in the program, and
a test asserts that.

The ladder deliberately **stops there**. An L-sit dip was on it briefly and came off:
holding the legs straight does not make the movement harder for the muscles doing the pushing, it
asks for hip-flexor compression and balance instead. As a rung it would have gated the *vest* on a
core skill, so someone with plenty strong dips could stall there and never get to load them.

Where the thing that needs explaining is **geometry rather than movement**, the illustration is a
drawn diagram instead of a clip. Ring dips are the case: the rings sit at sternum height, so in a
locked-out support your feet hang about 40 cm off the floor and no amount of standing on it assists
anything — the help has to come from a chair placed *in front* of you. `images/ring-dip.svg` shows
the ring height, where the feet can actually reach, and what upper-arm-parallel looks like. `.svg`
is in the resolver's chain alongside `.gif` and `.jpg`.

**Every exercise and every ladder level is illustrated except one**, and the levels that differ
enough to be separate exercises carry their own picture rather than sharing one that only matches a
rung you are not on — split squats has five, hip thrusts four. Only `movement-prep` shows the video link alone, and it
should: it is four separate things (getting warm, arm circles, good mornings, wrist rocks) and no
single frame represents that.

The Gym Visual credit is decided by the picture rather than the exercise, because levels of one
exercise now draw from different sources — hip thrust level 2 is Gym Visual, levels 1 and 3 are not.
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) was checked first and was far worse:
public domain, but gym-machine oriented, with exactly **one** genuine match across 873 entries.

Illustrations can be attached **per ladder level**, not just per exercise, because a floor glute
bridge and a single-leg hip thrust off a chair are not variations of one movement — they are
different exercises sharing a progression. A level that names its own picture wins outright; one
that does not falls back to `images/<id>-L<n>.gif`, then to the exercise's own file.

Which of those exist is **generated**, not guessed. `data/images.js` is written from the contents of
`images/` by `node tools/gen-images.mjs`, so the resolver skips straight to the file that is
actually there. Without it the browser had to *ask* for each candidate in turn — four 404s per
exercise, eighteen for a pass over one session — and an exercise with no picture at all still
rendered an `<img>` that fetched four files before deleting itself. A test fails if the generated
list drifts from disk. See [images/README.md](images/README.md).

## The constraint that shapes everything

The pull-up and dip bars are in an awkward spot, so they are out. The rings replace both, but
only at **fixed heights**, because re-rigging mid-session is the friction that kills a home
program:

| Station | Height | Exercises |
|---|---|---|
| Rings overhead | Dead hang | Movement prep, dead hang, scap pulls, pull-ups, chin-ups, hanging leg raises |
| Rings at chest | Sternum | Split squats, face pulls, ring rows, ring dips, ring fallouts |
| Rings on the floor | 20-25 cm | Ring leg curls *(day B only)* |
| Floor | — | Push-ups, pike push-ups, hip thrusts, calf raises |

Sessions render in that order, which is also the order the rings physically travel — **downward
only, never back up**. Day A needs two adjustments, day B three. Both asserted by tests.

**The warm-up is one block, bookended.** It used to be split in half: a "Warm-up" station holding
movement prep, then the dead hang and scap pulls stranded inside "Rings overhead" — which reads as
the warm-up having ended when it had not. Movement prep needs no equipment, so it had no business
owning a station; it now sits at the top of the rings station with the rest of the prep. Day A is
three stations instead of four.

The block is marked at both ends — a **Warm-up** divider above it, a **Working sets** divider below
— and every exercise inside gets a `PREP` tag and a dashed border. One opening marker matters more
than it sounds: without it you can see where the warm-up ends but not that it ever began.

Prep is decided by **position, not purpose**. Ring face pulls exist for shoulder health, but they
are two real working sets in the middle of the session, so they are not marked as prep. Only what
comes before the divider is.

Two of those heights are set by a functional test rather than a number:

- **Overhead** is set once and never touched. Hang the rings so your toes just brush the floor with
  the legs **straight**, and that single height does both jobs: straighten the legs to take weight
  through them while you still need assistance, bend the knees and cross the ankles for a clean full
  hang once you do not. Feet clear the floor either way under bent knees, so it is a true hang under
  full bodyweight — no chair, no band, no adjusting.

  The only thing it costs is the bottom of a **straight-leg** hanging leg raise, which is cut short.
  That is irrelevant at levels 1-2; raise the rings for that exercise alone if it starts to matter.
- **Chest** is whatever passes the dip check: drop to sternum, then confirm that at the *bottom* of
  a dip, knees bent, your feet still clear the floor.

Because the rings never move *to add difficulty*, every exercise instead carries a **ladder** —
an ordered list of difficulty **levels**, each a harder body position than the last: feet walked
further forward, feet on a box, less assistance from the legs. Climbing one level is how an exercise gets
harder; the vest only comes in once the top level is reached.

### Equipment is a capability, not an object

`kit: ["rings"]` named an object, and that hid a distinction that matters: a **dead hang** does not
need rings, it needs *something overhead to hang from* — a park bar does fine. A **feet-assisted**
pull-up does need rings, because it needs that something to be at a height you choose.

So equipment **provides** capabilities and each level **requires** them:

```
rings      hang-high, hang-high-adjustable, grip-chest, dip-support,
           dip-support-adjustable, handles-hanging, handles-low, steady
straps     hang-high, hang-high-adjustable, grip-chest, handles-hanging,
           handles-low, steady        (rings by another name, minus the dip)
high bar   hang-high
low bar    grip-chest
dip bars   dip-support
bench      step-45, steady
box        step-20, step-45
```

A **Where** picker sits above Time today. Switching to *Park* resolves the whole session against
what is there: the chips name the object in front of you (`high bar`, not `rings`), and the rigging
instructions disappear because nothing is rigged.

Stations are named after a rig height — *Rings overhead*, *Rings at chest* — which is a lie in a
place with no rings. The grouping still holds, because it is also the order you do things in, so
away from a rig the station names the **role** instead: *Overhead*, *Chest height*, *At floor
level*. Nothing on screen mentions rings you have not got.

### Where you are is a list of equipment, not a named venue

**There is one source of truth: the equipment you ticked.** A named place is a *button that fills
that list*, not a mode. That distinction is the whole feature — while places were fixed lists in the
program, "home, plus the high bar I just bought" was not expressible at all, and the only remedy was
a commit. Presets that match no ticks show as `Custom` rather than lighting nothing, and tapping a
preset **replaces** the list rather than adding to it, because tapping *Park* has to drop the rings
or the session would still be planned around equipment you walked away from.

Three presets cover the places you go often:

| | equipment | patterns covered |
|---|---|---|
| **Home** | rings, push-up bars, sofa, chair | 14 / 14 |
| **Park** | high bar, low bar, dip bars | 13 / 14 |
| **Gym** | high bar, low bar, dip bars, bench, box | 13 / 14 |

A gym is deliberately modelled as *a park with better furniture*. It adds nothing exotic — no
barbell, no cable stack, no machines — because a bench and a box are all the existing ladders
actually want, and they are the two rungs (`step-20`, `step-45`) that a park cannot supply. Both
lose the same single pattern, knee flexion, for the same reason: nothing there holds your heels.

The gym preset stays conservative on purpose. A dip station is listed because every gym has one; a
suspension trainer is not, because plenty do not, and a preset that assumes one would hand you a
session you cannot do — the failure mode that is worst in practice, since you only find out once
you are standing there.

**Nothing** is not a place so much as a starting point: one tap to clear the list, then tick the two
things that are actually in the hotel room. With nothing ticked you still get a session — movement
prep, split squats, push-ups, calf raises, the things that need no equipment at all — rather than an
error. Tick a high bar and pull-ups appear. Tick the gym preset's five *plus* straps and the last
gap closes: straps are the only thing anywhere that holds your heels, so knee flexion has an answer
again and workout B runs with nothing missing.

A high bar at home is worth spelling out, because it is the case that motivated all this and the
answer is counter-intuitive: it changes **nothing**. `high-bar` provides only `hang-high`, which the
rings already provide along with `hang-high-adjustable`. The session is identical either way. The
gap was never capability, it was expressibility.

Stored as `settings.kit`, a flat array. v3 kept two incompatible answers — a named `place`, plus a
`customKit` that only the placeless *Anywhere* ever read — so the **v3 → v4 migration** resolves a
stored place to the kit it stood for. The dangerous case is an *unset* place: it meant home, and
resolving it to an empty list would silently strip every exercise needing any equipment at all.

### Choosing which exercise trains a pattern

Equipment first, exercise second. Once the room is settled, a card offers the other exercises that
train its pattern **and are doable here** — `substituteFor` answers *what instead*, `alternativesFor`
answers *what else*, which is the same search without the exclusion, so the prescribed exercise
heads its own list and a swap can always be undone.

### The card is a slot, not an exercise

Two things made the app read as exercise-first even after the engine stopped being:

**Names hardcoded equipment the exercise does not require.** With only a high bar ticked, "Ring
chin-ups" already resolved to its bodyweight rung with the kit chip reading `high bar` — the app was
doing the right thing and calling it the wrong name. There was no missing "regular chin-up" option,
because it is the same exercise; a separate one would have split the progression state for no reason.
So eight exercises lost their equipment: `Ring chin-ups → Chin-ups`, `Ring rows → Inverted rows`,
`Ring dips → Dips`, and so on. `Push-ups (on bars)` went too — the bars add range at the upper rungs,
which the ladder already says, and the name claimed a requirement the exercise never had.

### One chip

`.chip` had **no base rule** for a long time and only looked right because `.chip.cap` existed — so
every chip type added later arrived as an unstyled `<button>` with a font-size bolted on, and each
invented its own selected colour: green for equipment, translucent accent for the exercise swap,
another for the gear picker. Three treatments read as three unrelated widgets rather than the same
question asked about different things.

There is one `.chip` now, matching `.pick-btn` — the A/B picker, the session cap, where you are,
what equipment is here, which exercise, which piece of kit are all the same control. One selected
state, shared by every `--on` variant.

The ✓ prefixes went with it. The fill *is* the tick, the controls that predate these never drew one,
and a glyph that appears on selection changes the button's width — so the row reflowed under your
thumb as you tapped it.

Two things fell out of doing this on a real screen rather than in the stylesheet. Where a card asks
`HANG FROM  rings | high bar`, the summary chip below repeated `rings` a line later, so the chips
are now filtered by the capabilities already asked about. And that filtering immediately produced a
worse bug: with every requirement suppressed, the empty list fell through to the "no equipment"
fallback, and a hanging leg raise claimed to need nothing directly under a choice of two things to
hang from. "Needs nothing" is now read from the rung, not from the filtered list.

The **search links** followed: the query names the movement and the app prepends whatever equipment
actually resolved, so a park bar searches `high bar pull ups form tutorial` rather than sending you
to a ring tutorial for an exercise you are not doing.

The same rule reaches the coaching, which is where it actually bites: *"Rings turned out at the top"*
is wrong advice on a fixed bar, and it sat on a rung the bar can do. A test now enforces both —
no name may contain an equipment word if any rung is doable without it, and no cue may assume rings
on a rung that does not need them (`"On rings, …"` is allowed, since it says so). Writing that test
found four more cases than reading for them did, including split squats telling you to steady
yourself on rings when a bench provides the same `steady`.

**And the card never said what it was for.** Every pattern now carries a plain-words reading —
`pull-vertical` → *lats, biceps* — shown under the exercise name. Display only: substitution still
runs on the pattern, because "lats" would happily swap a pull-up for a row and those are not
substitutes. The muscles are the reading; the pattern is the rule.

### Choosing between equipment

With rings and a high bar both up, a chin-up can be done on either — that is a *preference*, not a
constraint, and declaration order was quietly answering "rings" every time. The card now asks, but
the choice is keyed by **capability**, not by exercise:

> HANG FROM  `rings` `✓ high bar`

One answer to *"what do I hang from?"* covers the chin-up, the pull-up, the dead hang, the scap pull
and the leg raise at once, because you do not hang from the rings for one and walk to the bar for
the next. `settings.gear` is `capability → token`, and `capabilities()` takes it as an optional
third argument. A preference can only ever pick between things that are all present and all
sufficient: preferring something you have not ticked, or something that cannot do the job, is
ignored rather than trusted, so a preference can never widen what is possible.

**The question only appears where there is genuinely a choice**, which turns out to be the
interesting part. A *feet-assisted* chin-up needs `hang-high-adjustable` — a height you choose — and
a fixed bar cannot give that. So the chin-up card offers nothing at levels 1 and 2 and offers both
at level 3, where the rung is plain bodyweight and needs only `hang-high`. That is not the feature
failing; it is the ladder being honest about what a bar can do.

### Choosing between exercises

**What the program already schedules is not a free choice**, even where the pattern matches. Chin-ups
and pull-ups are both `pull-vertical`, and either beats nothing where a place can only manage one —
that is `substituteFor`'s job, and it keeps the looser rule deliberately. But a supinated grip pulls
with the elbow flexors in a way a pronated one does not, which is precisely *why* the week puts one
in A and the other in B. Offering them against each other would let you chin twice a week and never
pronate, quietly deleting a movement the week was built around. So `alternativesFor` excludes
anything the program schedules elsewhere.

**Variety went where the week spends its volume**, because that is where a second exercise is free.
Splitting a pattern trained once a week means each variant runs fortnightly, which is too slow for a
target to move; splitting one trained 18 sets a fortnight costs nothing. So the alternatives are:

| pattern | sets / 2 weeks | prescribed | alternative |
|---|---|---|---|
| `pull-horizontal` | 18 | Inverted rows | **Archer rows** — unilateral, no extra kit |
| `push-horizontal` | 15 | Push-ups | **Close-grip push-ups** — triceps and inner chest |
| `core-anti-extension` | 9 | Fallouts | Front plank |
| `legs-knee-flexion` | 9 | Leg curls | **Slider leg curls** — a floor and a towel |

A test enforces the rule rather than leaving it as intent: every pattern holding a choice must be
one the week trains at least nine sets of. `push-dip` deliberately has none — there is no bodyweight
dip variant that is genuinely different rather than just worse, and the rings-or-parallel-bars
question is answered by the gear picker instead.

### Two things the volume table decided

Counting sets per pattern over a two-week block, rather than reasoning about the split, made two
problems obvious that reading the program had not.

**Overhead pressing was trained on one day only** — 9 sets a fortnight against 18 for the dip, and
`data/program.js` already carried a comment calling vertical pressing "the weakest pattern here". A
shoulder that never presses overhead is exactly the one the dip bothers. Pike push-ups now appear on
the pull day too, at two sets: `push-vertical` goes 9 → 15, and it lands on the day that had room —
A was 49 minutes against B's 58, and is now 53 against 56.

**Knee flexion was the last pattern nothing away from home could train.** Not a code problem: the
ring curl needs `handles-low`, which only rings and straps provide. The slider leg curl needs a hard
floor and a towel, which the app does not model as equipment at all — so `needs: []`, and a park, a
gym and an empty hotel room all reach **14 of 14 patterns**. It is unscheduled, so it shows up as a
choice against the ring curl rather than replacing it; the ring version loads the hamstring harder
and stays the default wherever there are handles.

**The choice is sticky, not a rotation**, and that is deliberate. Progression state lives on the
exercise and the engine moves a target by consecutive hits, so splitting a pattern across variants
divides its exposure. The frequency table prices it exactly:

| pattern | sessions/week at 3× | can carry a second variant? |
|---|---|---|
| prehab ×3, pull-vertical, pull-horizontal, push-dip, push-horizontal | 3 | yes — each still gets ~1.5× |
| core-hip-flexion, legs-knee, legs-calf, prehab-rear-delt | 2 | marginal |
| core-anti-extension, legs-knee-flexion, push-vertical, legs-hip | 1 | no — each would run fortnightly |

The program already demonstrates the working version: A does pull-ups, B does chin-ups, each keeps
its own progression and both advance. It works *because* it is fixed.

So the choice is keyed by **workout and slot** (`A:ring-pullup`), never by pattern — a per-pattern
key would collapse that A/B split the moment you swapped either one. Choosing what the workout
already prescribes *clears* the override rather than storing it, so the slot is not frozen against a
later change to the program. Swapping is locked once a set is logged, the same pin as the level
stepper and for the same reason: the session records what you did against the exercise you did it
on. A choice the room cannot honour still falls back to substitution, so the two mechanisms compose.

The choice is stored in `settings.variant`, which surfaced a bug worth recording because the class
of it recurs: **`load()` copies only the keys `DEFAULT_SETTINGS` declares.** A setting written at
runtime but never declared is saved to storage and then silently dropped on the way back in — the
swap worked, and was gone next time the app opened. Its own test checked what had been *written* and
never re-booted, so it passed throughout. There is now a generic guard: every setting the app writes
has to be a setting it can read back. Object and array defaults are also cloned on load, or the
default would *be* the live state and mutating it in place would leave the next load starting from
the last run's data.

That lock note is also what exposed a **latent bug in the DOM patcher**, which had been correct for
weeks only because every keyed node existed in both trees. It is the first *conditional* keyed node:
with no old node to match, it fell through to positional matching and consumed the next unkeyed slot
on its way past. Everything below shifted by one, so `<div class="sets">` was patched into the kit
row and every set row underneath was rebuilt — held references went stale and taps did nothing,
silently. A keyed node with no match is now simply new. Worth noting that the first test written for
this looked its rows up fresh each time and passed throughout; only holding the references across
the log catches it.

**Gaps are reported as PATTERNS, not exercises**, and getting that wrong first is instructive. The
initial version announced *"not possible at park: push-ups, pike push-ups, ring fallouts, ring leg
curls"* — four losses. Two of them were not losses at all, they were mistakes in my own
requirements: a push-up needs no bars (they add range, they are not the exercise) and a pike
push-up is normally done hands-flat on the floor. Requiring them meant a park had no horizontal or
overhead push whatsoever, which is absurd.

What is actually lost is much smaller — and where something else in the pool can train the same
pattern, **it is substituted rather than dropped**. The workout names ring fallouts; a park has no
hanging handles; a front plank needs nothing and trains the same thing, so that is what you get,
with the card saying so:

> **Front plank**  `for Ring fallouts`

Preference is declaration order, so the exercise you would rather do is simply the one written
first. The volume the workout asked for carries over. The *level* does not — a plank ladder and a
fallout ladder are different progressions, and carrying a number between them would be inventing
one.

That leaves a single genuine hole, which is the only thing worth telling you about:

> Nothing here trains **knee flexion**. Everything else is covered, at whatever level this place
> supports.

Workout A in a park loses nothing at all — same eleven exercises, same ~49 minutes, different
equipment throughout.

Your stored level is never touched. The card says where the room has moved you and where you
really are:

> Down to level 3 here — no chair 45 cm. Your level is 5.

**Requirements are not monotonic along a ladder**, which cost me a wrong first implementation. A
toes-down hang needs an adjustable height; a *full* hang needs only a bar. So in a park the easy
rung is the impossible one and the harder rung is the one that works — the search goes down first,
then up, and the card says which:

> Up to level 2 here — no rings for level 1. Your level is 1.

### Movement patterns, not muscles

Every exercise declares a **movement pattern**, and two exercises share one only when either could
genuinely stand in for the other:

```
prehab-warmup   prehab-hang   prehab-scap   prehab-rear-delt
pull-vertical   pull-horizontal
push-dip        push-vertical   push-horizontal
legs-knee       legs-hip        legs-knee-flexion   legs-calf
core-anti-extension   core-hip-flexion
```

Muscles would be the wrong unit. "Lats" would let something swap a pull-up for a row, and those
are not substitutes — you need both, because vertical and horizontal pulling load the scapula
differently. "Abs" would make a hanging leg raise interchangeable with a ring fallout, and one
produces hip flexion while the other resists extension. Only `pull-vertical` holds two exercises,
and that is correct: pull-ups and chin-ups really are the same job with a different grip.

The coarse family — push, pull, legs, core, prehab — is **derived from the prefix**, so adding a
pattern needs no second place to register it.

### What the week actually trained

The History tab shows the last seven days as sets **per pattern**, against what one A and one B
would give you, and names anything that got close to nothing.

This exists because of the first real export. Two sessions, 41 sets logged — a perfectly healthy
number — and every hip-dominant and every overhead set missing, because the three exercises that
provide them sit at the end of workout B and fell off when the clock ran out. A total cannot show
that. Split by pattern it is one line:

> Barely trained: **hip-dominant**, **knee flexion**, **overhead push**.

## The split

Alternating A and B, **2-3 sessions a week, at least a day apart** — no fixed days. Legs are split
by pattern rather than repeated, so each session stays under an hour and neither leg pattern is
trained on consecutive days:

| | Workout A — pull emphasis | Workout B — push emphasis |
|---|---|---|
| Vertical | Pull-ups 3×6-8 | Chin-ups 3×6-8 |
| Horizontal pull | Inverted rows 3×10-12 | Inverted rows 3×10-12 *(one level harder)* |
| Push | Ring dips 3×6-8, push-ups 2×10-12 | Ring dips 3×6-8, push-ups 3×10-12 |
| Vertical push | — | Pike push-ups 3×6-10 |
| Core | Hanging leg raises 3×8-10 | Ring fallouts 3×20-30 s |
| **Legs** | **Knee** — split squats 3×10-15, calf raises 2×12-20 | **Hip** — ring leg curls 3×8-12, hip thrusts 3×10-15 |
| Warm-up | Movement prep 3 min, dead hang, scap pulls | Movement prep 3 min, dead hang, scap pulls |
| Prehab | Ring face pulls 2×12-20 | — |

**A and B alternate automatically** — the app offers whichever you did not do last, starting with A.
An **A / B** picker sits under the session title for the times that is wrong: repeating a session you
cut short, restarting on A after a break, or skipping the day whose equipment you cannot reach. It
is a one-off, not a setting — it disappears once a session is running, and alternation resumes from
whatever you actually complete rather than from what you picked.

24 and 27 sets, estimated at **~49 and ~57 minutes** at the start of Phase 1 — the app computes
this from your actual prescriptions. Use the **Time today** control to cap it; 40 minutes trims a
handful of sets off the least important exercises. Push-ups drop to two sets on the pull day — the chest already took three sets of dips — and the
warm-up runs one set of each. That is where the time for legs came from.

### Am I going to finish?

Mid-session the header answers the question you actually have at minute 35:

```
Workout B · Push emphasis
RPE 5-6 · 3-4 reps in reserve · ~58 min
~29 min left · finishing about 19:42 · running 24% slow
```

It exists because of a real session. Workout B ran out of time, the last three exercises were
simply never done — the hip work and the overhead press, which are the two things that day exists
to provide — and **nothing warned anybody**. The app showed the estimate it made *before* the
session started, and a clock counting up. Neither answers "am I going to finish".

The remainder is walked off the same timeline everything else uses, and **scaled by the pace you
are actually working at**: what the model thought the part behind you would take, against what the
clock says it did. Estimating the rest of a session from a fixed model while running 30% slow is
how you find out you are out of time by running out of time.

Two guards on that. The pace is only computed once there are a couple of minutes of modelled work
behind you — two sets in, the ratio is noise — and it is clamped to 0.6-2, because a 4× projection
off one slow set helps nobody. With a **Time today** cap set, going over turns the line amber:

> Over your 40 min. Cut a set or two now, while there is still something to cut.

### Session length

A **Time today** control on the Today tab caps the session at 30, 40 or 50 minutes, or runs it in
full. It is a per-session choice you can change on the spot, and it persists.

The estimate is arithmetic: work + a rest after every round + a transition per exercise + one ring
adjustment each. Rest dominates — about 60% of the total — which is why supersets matter: members of
a group share one rest per round instead of taking one each, so pairing two 3-set exercises saves
three rests outright.

Checked against two real sessions, comparing like for like (the model run over what was *actually*
done, not the full plan), it came out **6% and 2% high**:

| | sets | model | actual |
|---|---|---|---|
| Workout A | 23 | 45:03 | 42:23 |
| Workout B | 18 | 38:32 | 37:35 |

Close enough to plan around. This paragraph used to claim real sessions run 10-15% *longer*, which
was a guess, and wrong in both direction and size.

Trimming shaves **one set at a time off the least important exercise still above its floor**, so
cuts get spread rather than gutting one movement. Every exercise carries a `trimPriority` (calves
and face pulls go first, the main lifts last) and a `minSets` floor (2 for anything that matters,
1 for accessories). The warm-up is `fixed` and is never touched. If the cap cannot be met even with
everything on its floor, the app says so rather than pretending.

Lowering the cap mid-session drops trailing sets you have not logged yet — never a logged one, and
never one you added by hand with **+ extra set**. Those carry an `extra` flag precisely so the
trimmer leaves them alone; `droppableSets()` in the engine holds that rule and is covered by tests.

The minus button doubles as the way to take a set back off. Held down to its floor, one more tap
**removes** an extra set you added, or **cuts** a prescribed one — the button shows ✕ instead of −
when that is what the next tap will do. See below.

### The warm-up

Every set in this program is a working set — there are no ramp-up sets built in — so the warm-up
is the only thing between cold connective tissue and the first hard rep. After a five-year layoff
that matters more than usual. It runs in two parts:

1. **Movement prep**, 3 minutes, no equipment: two minutes getting warm, arm circles, 10 bodyweight
   good mornings and 10 deep squats, wrist circles and rocking on the push-up bars. It covers the
   things the rest of the session does not — body temperature, hips and hamstrings, wrists and
   elbows. It is marked `progression: "fixed"`, so unlike everything else it never creeps longer.
2. **Dead hang and scap pulls** on the rings at overhead height — shoulder-specific prep at a
   station already set up, and the dead hang is literally the start position of the first working
   set.

The good mornings are not optional garnish: day B's first leg movement is the ring leg curl, which
lands on the hamstrings cold and is the one exercise flagged for cramping.

### No band

Band pull-aparts became **ring scap pulls**, band face pulls became **ring face pulls** (better: no
dead spot at the start, loaded continuously by body angle), and band-assisted pull-ups became a
second **feet-assisted** level, since the overhead ring height is adjustable anyway. The one genuine
loss is **shoulder rotation range**, which pass-throughs trained and a dead hang does not — the face
pulls' external-rotation finish covers part of it. Keep a band in a drawer rather than binning it:
if a shoulder starts complaining once the dips get heavy, it is the easiest rehab tool there is.

Ordering follows the stations, with two exceptions carved out for fatigue and prehab: **split squats sit ahead
of the row/dip pair on day A**, because pull-ups and hanging leg raises are both grip-limited and
ring rows would have made three grip-taxing movements in a row. And **face pulls sit immediately
before the dips**, putting rear-delt prep directly in front of the movement most likely to bother a
shoulder. Tests assert both orderings.

The **ring leg curl** is why day B pays for a third ring position. It trains knee flexion, which
nothing else here touches and which is near-impossible to replicate without rings or a machine.
Paired with the hip thrust for hip extension, the two cover most of what a barbell deadlift would.

**Pike push-ups** are the vertical press. Bodyweight programs routinely omit this pattern entirely
— nothing else in the program trains the shoulder overhead — and the ladder runs all the way to a
handstand push-up, so it does not cap out.

## Progression system

The rules, in full. The app applies all of them automatically — there is nothing to remember or
compute between sessions.

1. **Climb the rep range.** Hit the target on *every* set → the target goes up by one step next
   session (1 rep, or 5 s on timed work), up to the top of the range.
2. **Hold the top.** Hit the top of the range on all sets for **2 consecutive sessions** → the
   load goes up. Beat the top by **2+** and the wait is skipped entirely.
3. **Ladder before vest.** A load increase first advances one level up the exercise's ladder.
   Only when the ladder is topped out does the vest engage — **1 kg** for the first jump, then
   **0.5 kg** at a time, capped at the vest's 10 kg.
4. **Reset the reps.** Every load increase drops the target back to the bottom of the range.
   This is what keeps the work inside the 6-12 hypertrophy window instead of drifting into
   low-rep grinding.
5. **Back off when stuck.** Miss the target **3 sessions in a row** → the load steps back down
   (1 kg of vest, or one ladder level if there is no vest on) and the reps reset. Stalled at the
   easiest level, it says so rather than inventing a negative level.
6. **Phases gate the load.** A phase unlocks only when **both** the session count *and* the
   calendar weeks are met. Load increases earned during Phase 1 are banked and applied the
   moment Phase 2 opens, so nothing is lost by holding back early.

Per-exercise state is five numbers — `{level, vest, target, topOutStreak, failStreak}` — and
`evaluate()` is a pure function of `(exercise, state, logged sets, phase)`. That is the whole
system; [progression.js](progression.js) holds no exercise-specific knowledge, and
[data/program.js](data/program.js) holds no logic.

### Two judgement calls worth knowing about

**Load is judged on the opening set, not the lightest one.** Descending sets — open with the
full vest for low reps, strip weight across the remaining sets — are an explicit technique in
this program. Judging load on the minimum would score every descending-set session as a
failure. Reps still have to be met on *every* set.

**Carrying more than prescribed on every set moves the baseline up.** If you decide mid-session
that 3 kg feels better than the prescribed 2 kg and still hit the reps, the app adopts 3 kg
rather than making you re-earn it.

### What happens when you don't hit the target

Nothing is lowered. The target is held and you get the identical prescription next session —
"repeat until you get it". Two details worth internalising:

- **A miss is judged on your worst set.** Target 8 and you do 8/8/7 → that is a miss, and next
  session is 3×8 again.
- **Three consecutive misses trigger a deload**, and that is the only thing that breaks the
  repeat loop: the load steps down and the reps reset to the bottom of the range.

### How often, and why the app does not care

Nothing keys off the calendar: phases unlock on **sessions completed and weeks elapsed**, never on
weekdays, so training twice a week simply takes longer to clear a gate. That is the correct
behaviour rather than a penalty.

Two sessions a week lands around **11-12 hard sets per muscle group**, inside the range usually
associated with growth, and takes ~80 min/week. Three gets you to ~16-18 sets and ~120 min. Weekly
volume drives growth far more than frequency does, so three is faster only if it actually happens —
and after a five-year layoff the extra recovery at twice a week is worth something on its own.

### Phases

| Phase | Unlocks at | RPE | Load progression |
|---|---|---|---|
| 1 · Reintroduction | start | 5-6 (3-4 RIR) | **Locked** — reps only, no vest, no harder variants |
| 2 · Ramp-up | 9 sessions **and** 3 weeks | 7-8 (2-3 RIR) | On — ladder, then vest from 1 kg |
| 3 · Full programming | 18 sessions **and** 6 weeks | 8-9 (1-2 RIR) | On — vest is the main driver |

The both-conditions rule matters: after a five-year layoff, muscle comes back on the muscle-memory
timeline but tendons and connective tissue come back on the calendar. Nine sessions crammed into
ten days is not a completed reintroduction phase, and the gate refuses to treat it as one.

Coming back from a break, force Phase 1 for a couple of weeks from the **Data** tab rather than
picking up where you left off.

## Three changes to the original plan

**Ring plank → ring fallout.** The original called for a plank with the *feet in the rings at
chest height*, which is not physically possible — feet in sternum-height rings puts you inverted.
It is implemented as *hands* in the rings, feet walked back: the same anti-extension stimulus,
progressed by walking the feet further back, and it loads the shoulders and lats as well.

A feet-in-rings version is now physically available (the straps reach the floor), but the
hands-in-rings version is kept: it sits at a height you are already standing at, and it progresses
continuously by walking the feet back rather than in one huge jump.

**No vertical press.** The original plan trained the shoulder overhead not at all, and neither did
my first several revisions — I wrongly treated it as a gap only dumbbells could fill. **Pike
push-ups** close it with equipment already owned, and the ladder runs to a handstand push-up.
Credit where due: this came from a competing program spec, not from me.

**No lower body.** The program as originally specified trained zero legs and zero hip hinge —
a real gap for "get back into shape and build muscle". Legs are now a first-class part of both
sessions, split by pattern as described above — split squats and calf raises on the pull day,
ring leg curls and hip thrusts on the push day. Trimming push-ups to two sets on day A, and a
one-set warm-up, is what paid for the time.

## Would adjustable dumbbells still be worth buying?

Short answer: **much less than before the leg block went in.** The original analysis said the
money was worth spending because nothing loaded the hamstrings or the hip hinge. Hip thrusts and
split squats close most of that, so the answer is now "optional, and not for a long time" — with
one caveat below.

| Movement pattern | Ring system | What dumbbells add |
|---|---|---|
| Vertical pull | Pull-ups / chin-ups + vest — **excellent** | Nothing. Dumbbells cannot do this at all. |
| Vertical push | Ring dips + vest — **excellent** | Nothing comparable. |
| Horizontal pull | Inverted rows, 5 levels + vest — **good** | Smoother loading, single-arm work |
| Horizontal push | Push-ups, 5 levels + vest — **good** | Floor press, smoother loading |
| Elbow flexion | Chin-ups — **fine** | Direct, smoother loading |
| Shoulder rotation range | Dead hang + face pull finish — **partial** | Nothing; a band is the right tool |
| Hip extension | Hip thrusts to single-leg + vest — **good** | Higher ceiling once the vest runs out |
| Knee-dominant legs | Split squats → ring-assisted pistols + vest — **good** | Higher ceiling, easier to load precisely |
| Knee flexion | Ring leg curls to single-leg — **excellent** | Nothing, without a machine |
| Hinge | Covered indirectly by the thrust/curl pair | A loaded RDL — the clearest remaining gap |
| Overhead press | Pike push-ups → handstand — **decent** | Easier to load, no balance demand |
| **Lateral delts** | Bands only, weak | The whole pattern |

The instinct is that the 10 kg vest is the binding constraint. It mostly is not. At roughly one
load increase every 2-4 weeks per exercise and 0.5 kg steps, 10 kg of vest is around twenty
increments — well over a year of progression, and that is *after* working through the ladders.

What is left is **a properly loaded hinge and lateral delts.** Lateral delts are an accessory. The
hinge is the real one: the leg curl and hip thrust cover the hamstrings at both joints, so what is
missing is the *pattern*, not the muscle — but there is no way to load a hip hinge here.

### When to buy, and what

Train this for **3-6 months first.** The specific signals that it has been outgrown:

- Weighted pull-ups with the full 10 kg vest feel comfortable
- Split squats stop being genuinely hard even at the top ladder level with full vest
- Leg progress stalls while the upper body keeps moving

When those trigger, in priority order:

1. **A pair of heavy adjustable dumbbells — 30 kg+ each, not a 24 kg starter set.** The number
   matters. With no rack, the binding constraint is getting load to the shoulders unassisted, which
   dumbbells solve because you can clean them up yourself. And 24 kg each caps out fast on split
   squats and RDLs — you would be shopping again inside a year. This one purchase closes the hinge
   and the lateral delts at once.
2. **An adjustable bench.** Useful but not top-20%: rings already cover horizontal pushing well. It
   earns its place mainly for heavy dumbbell pressing and as a better, safer hip-thrust platform
   than a kitchen chair. Costs floor space, which is the binding constraint.
3. **A kettlebell.** Largely redundant with heavy dumbbells for squats, presses and rows. Only
   genuinely additive for ballistic work — swings, cleans — because of the offset handle. Worth it
   if conditioning becomes a goal; skip it if the goal stays strength and hypertrophy.

**An ab wheel is not on this list.** With the straps reaching the floor, kneeling in the rings and
rolling out *is* an ab-wheel rollout, and it progresses more finely — a wheel jumps from knees to
feet with nothing in between, while ring fallouts scale continuously by walking the feet back.

## How it is built

Vanilla JavaScript, no framework, no build step, and no runtime dependencies. Open `index.html` and
it runs. The fast Node suites also need no packages; Playwright and axe are development-only tools
for exercising the published app in a real browser.

The shape that has held up through every rewrite: **`data/program.js` holds no logic and
`progression.js` holds no exercise knowledge.** The level model, the timeline, three storage
migrations and per-level coaching have all gone through since, and the program data has needed only
small local edits each time.

### Files

```
index.html                    shell + tab structure
manifest.json                 installable app metadata
sw.js                         offline service worker
icon.svg, icons/*.png         app icons (regenerate: rsvg-convert -w N icon.svg -o icons/icon-N.png)
app.js                        UI, localStorage, session lifecycle, the timers
progression.js                the engine — pure, testable, no DOM
patch.js                      applies rendered HTML without destroying the DOM
audio.js                      beeps, speech, and the rules about when they go out
data/program.js               exercises, ladders, cues, phases, workouts A/B
data/images.js                GENERATED — which illustrations exist locally
tokens.css                    local Nordic Utility semantic design tokens
theme.js                     early Light / System / Dark theme selection
styles.css                    mobile-first Nordic Utility components
tools/gen-images.mjs          regenerates data/images.js and sw.js MEDIA
tests/progression.test.mjs    the rules are right — 213 assertions
tests/ui.test.mjs             the app applies them — 281, through real clicks
tests/dom.test.mjs            the harness itself is honest — 102
tests/audio.test.mjs          when a cue goes out and what it waits for — 54
tests/patch.test.mjs          rendering keeps node identity — 30
tests/dom.mjs                 a DOM small enough to test against, zero deps
tests/harness.mjs             check/section/report, and the crash guard
tests/all.mjs                 runs all five
tests/browser/app.spec.mjs    Chromium flows, offline boot, and axe audits
playwright.config.mjs         mobile browser-test setup and local server
```

### Testing

There are **32 hand-written `save()` calls**. Rather than trust all of them, the suite asserts the
property instead: after any action, booting a second app from nothing but what reached storage has
to show the same thing. Sixteen actions go through it — logging, undoing, cutting, skipping,
capping, picking the workout, moving a level, typing the note, finishing — plus the settings, plus
the two things that are deliberately *not* persisted.

It reports when a case is vacuous, which caught three of them the first time round: the snapshot
was not looking at what the action changed. Verified by deleting one `save()` — it fails with
`note: ""` against `note: "left shoulder fine"`.


Run the fast suites with `node tests/all.mjs` (or `npm test`). No install step is needed for those:
every script `index.html` loads is run
verbatim in a VM context against a minimal document, so there is no second copy of anything to
drift — the test harness even reads its script list out of `index.html`, so a new file cannot be
in the page and missing from the tests. A suite that dies part-way says which section it died in
and how much never ran, rather than leaving a stack trace and no summary.

The split matters. Every bug that ever reached a browser here was in the wiring, not the rules —
a click handler that threw and froze a card, an image that could never load, a quote that closed
an attribute early. `ui.test.mjs` drives the real app through the real markup and clicks real
buttons; each of its cases is a bug that actually shipped.

Run `npm install` once and `npm run test:browser` for the real-browser layer. It uses mobile and
desktop Chromium viewports to verify a persisted workout flow, keyboard tab navigation, an
installed-shell offline reload, and a zero-violation axe scan of all four tabs.

### Everything awkward takes its dependency as an argument

Three things in this app are impossible to test if they reach out to the world directly, so
none of them do:

- **The clock.** `app.js` never calls `Date.now()`; it goes through one `now()` that reads
  `window.CLOCK` when a test provides one. That is the only reason the hold timer, the
  countdown, the rest bar and phase rollover have any coverage — you cannot assert on a
  countdown you have to sit and wait for.
- **The speaker.** `audio.js` takes a device with `tone()` and `speak()`. In a browser that is
  WebAudio and the Web Speech API; in a test it writes down what it was asked to do. The
  Bluetooth priming window, the queueing of speech behind a scheduled tone, and the
  voice-at-speak-time rule were the most-debugged code in the project and had one assertion
  between them until this split.
- **The document.** `tests/dom.mjs` is a small DOM the whole UI suite runs against.

### The harness is tested too

`tests/dom.mjs` is the one thing everything else trusts, and a shim that is subtly wrong does
not fail — it passes, and says the wrong thing. It had already been wrong three times, each
found by hand in a browser rather than by the suite:

- `textContent` was not decoding entities, so a textarea's value could never match its markup
- form state was read off the attribute instead of the property, so a `<select>` looked stuck
- clearing `innerHTML` dropped children without detaching them, so a node the page had thrown
  away still bubbled its clicks to the document

That last one is the worst kind: it made the assertion about held references pass while the
app was broken. `tests/dom.test.mjs` now states each rule as a rule of the *real* DOM, and
marks the places the shim deliberately does less.

The check that matters: revert `render()` to `innerHTML = …` and the suite reports five
failures. Before, it reported none.

### The level is the unit

A level is very nearly its own exercise — a floor glute bridge and a single-leg hip thrust off a
chair share a progression and nothing else. So a ladder rung owns whatever differs from the
exercise, and inherits the rest:

| on a rung | what it does |
|---|---|
| `name`, `note` | what you are doing at this level |
| `kit` | **replaces** the exercise's list — push-ups start on the bars and end up in the rings |
| `image` | levels that look nothing alike get their own picture |
| `perSide` | a level is unilateral or it is not; the exercise is neither |
| `range`, `step`, `rest`, `metric` | when a rung is different enough that inheriting would be wrong |
| `cues` / `addCues` | replace the coaching, or add a caveat to it |

`PR.rung(ex, level)` resolves all of it in one place, and everything downstream reads that
rather than reaching into the exercise. Levelling up lands on the new level's range, and
dropping back lands on the one below's.

The pistol squat is the clearest case: it sits at the top of the split-squat ladder carrying
`range: [6, 10]`, because the 10-15 it used to inherit is not a prescription anyone would write
for a pistol — and its own cues, because "front shin roughly vertical" is not an instruction for
a one-legged squat. The ladder badges which rungs override what, so you can see it coming.

### One session timeline

`PR.timeline(items)` turns a session into an explicit sequence — `adjust, transition, work,
rest, work, rest…`. The estimate is the sum of it and the app walks it to decide what happens
after each set, so "is there a rest between these two?" has exactly one answer. Two independent
models is how the estimate came to count a rest between exercises that the app was not running.

### The entry is a log, not a copy of the plan

A running session stores only what you **did**: which sets are logged, at what, and any number
you deliberately changed. `null` means "follow the plan"; a number means "I changed this";
logging a set freezes both, because from then on they are a record rather than a prescription.

It used to store a frozen copy of the prescription too — level, target, vest, and a number on
every set including the ones not yet done. That is two answers to "what am I doing right now",
and they drift: lower the session cap or cross a phase boundary mid-workout and the untouched
sets kept the old numbers.

### Rendering

Views are rendered as HTML strings, which is simple and worth keeping. Assigning them to
`innerHTML` is not: it rebuilds every node on every tap, which silently detaches any element a
handler is still holding, loses scroll position mid-session, and stacks up listeners on nodes
that survive. `patch.js` walks the new tree against the live one and changes only what differs.

Structural blocks carry ids and cards carry `data-ex` so they are matched by key rather than by
position — logging the first set removes the "tap Start" hint, and without keys everything below
it would shift by one and be rebuilt anyway.

### Editing the program

Editing the program means editing `data/program.js` only — add an exercise, give it a station, a
ladder and a rep range, and drop its id into a workout's `order`. The engine and the UI pick it
up with no other changes.

A workout's order entry can bend the shared prescription for one day without forking the
progression state:

- `levelOffset: 1` — run it a level harder that day (workout B's ring rows: the "feet elevated"
  variant from the original plan)
- `setCount: 2` — run fewer or more sets that day (push-ups on the pull day)

Both are judged correctly when the session is scored, so two sets on day A counts as complete
while two sets on day B does not. The offset moves what you *do* today without moving what you
have *earned* — progression is always judged on the level the state is actually on.

## CI and publishing

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull request:

- **The tests, on node 20 and 22.** 20 is what the deploy workflow pins; 22 is what it gets
  developed on. The pair catches an accidental dependency on a newer built-in, which would
  otherwise only surface at release time.
- **A generated-files check.** `node tools/gen-images.mjs` is re-run and the result diffed against
  what is committed, so adding an illustration and forgetting to regenerate fails with the command
  to fix it rather than with a picture that silently vanishes offline.
- **Real mobile and desktop Chromium passes.** Playwright checks a persisted workout, responsive
  page width, and offline restart, while axe audits Today, History, Program and Data for automated
  accessibility violations.

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) publishes to GitHub Pages on a
**published release**, or on demand from the Actions tab — the same trigger, permissions and
concurrency settings as the other static sites in this account.

Two things it does that those do not:

- **It runs the tests first.** All five suites, no dependencies to install. A release that would
  ship a broken progression engine, a dead click handler, or a generated image list that has
  drifted from disk does not get published.
- **It stamps the service worker's cache name with the commit SHA** instead of appending
  `?v=<sha>` to the script tags. The house pattern would *break offline mode here*: `sw.js`
  precaches `./app.js`, `caches.match` is query-sensitive, and a page asking for
  `./app.js?v=abc1234` would miss every precached entry. Measured on the assembled artifact:
  seven precached files the page never requests, six requested files not in the cache, no overlap.
  The worker is already network-first with the HTTP cache bypassed, which is the problem `?v=`
  exists to solve — so the only thing worth busting is the cache *name*, so that one release can
  never serve a mixture of its own files and the previous one's.

Only what the page serves is uploaded: no README, no `tests/`, no `tools/`. 28 files, 2.7 MB, of
which 2.4 MB is illustrations.

That copy list is written out by hand in the workflow, which makes it the one thing in this repo
that can break **only in production** — add a script to `index.html`, forget to add it there, and
everything local keeps working while the published site does not. So the test suite asserts it:
every file the page loads and every file the service worker precaches must appear in the workflow's
`cp` lines, and nothing in those lines may be missing from disk.

## Data

Everything is in `localStorage` under `workout-program:v1`, stamped with a schema version.
Changing the shape of what is stored means bumping `SCHEMA` in `progression.js` and adding a
step to `migrate()` — which runs before anything reads the data, and tells you on screen what it
changed rather than moving a number silently. Clearing site data wipes it, so
export from the **Data** tab now and then — it downloads a JSON file with every session, and
importing it restores the exact state. Imports are size- and complexity-bounded, migrated, and
structurally validated in memory before they replace the local copy; malformed files and exports
from a newer schema are refused.
Sessions are never overwritten by the app; the only
destructive actions are the two explicit reset buttons.

If browser storage is unavailable or full, a persistent warning appears immediately and offers a
download of the still-live in-memory state. Invalid data already in storage is left untouched and
offered as recovery data while the app opens a safe fresh state in memory.

An in-progress session survives closing the tab: reopen and it picks up with the logged sets
still there.
