# Exercise illustrations

Drop a file named after the exercise id and it appears at the top of that
exercise's ⓘ panel. Nothing to register — the app requests the file and the
element removes itself if it is not there, so a missing file costs nothing and
the demo-video link still shows.

    images/ring-dip.jpg          for the whole exercise
    images/hip-thrust-L3.jpg     for level 3 only

**A ladder level can have its own picture, and often should.** A floor glute
bridge and a single-leg hip thrust off a chair are not variations of one
movement; they are different exercises that happen to share a progression. The
same goes for a bodyweight squat and a ring-assisted pistol.

Resolution order, most specific first:

1. `image:` on the current ladder rung in `../data/program.js`
2. `image:` on the exercise
3. `images/<id>-L<n>.gif` then `.jpg` — the current level
4. `images/<id>.gif` then `.jpg` — the exercise
5. nothing: the figure removes itself, the video link remains

Ids are the keys in [`../data/program.js`](../data/program.js); levels are
1-indexed to match the `Level 2/5` badge on the card.

## Where the twelve bundled illustrations come from

Nothing is stored in this folder. Twelve exercises carry an `image:` URL in
[`../data/program.js`](../data/program.js), hotlinked from two of your own repos:
[Th0masL/exercises-gifs](https://github.com/Th0masL/exercises-gifs) (ten animated
360×360 GIFs) and
[Th0masL/exercises-dataset](https://github.com/Th0masL/exercises-dataset) (two
180×180 stills). Both are forks, so they cannot disappear from under the app.

The service worker caches them **cache-first** on first view, so they survive
offline and each is fetched from GitHub exactly once —
`raw.githubusercontent.com` is rate-limited at roughly 60 requests an hour and
is not a CDN, and cache-first means it is asked once and never again.

The `<img>` carries `crossorigin="anonymous"`, without which the response is
*opaque* (`status 0`, `ok false`) and the worker silently refuses to cache it.
`raw.githubusercontent.com` sends `access-control-allow-origin: *`, so CORS mode
works and yields real status codes.

> Media **© Gym visual — https://gymvisual.com/**

The credit is decided by **the picture, not the exercise** — `isGymVisual()` in
[`../app.js`](../app.js) matches anything served from the `exercises-*` forks,
plus a short list of their frames saved locally. Levels of one exercise can come
from different sources (hip thrust level 2 is Gym Visual, levels 1 and 3 are
liftmanual), so a per-exercise list would have credited the wrong party. Note that the stills repo states
a **180×180** redistribution limit; the 360×360 animations exceed it.

| exercise | source entry | |
|---|---|---|
| `ring-dip` | ring dips | on rings |
| `ring-row` | suspended row | on rings |
| `ring-fallout` | suspended abdominal fallout | on rings |
| `ring-scap-pull` | scapular pull-up | bar |
| `ring-pullup` | pull-up | bar |
| `ring-chinup` | chin-up | bar |
| `hanging-leg-raise` | hanging leg raise | bar |
| `ring-facepull` | cable rear delt row | cable stack |
| `split-squat` | split squats | |
| `calf-raise` | bodyweight standing calf raise | |
| `pushup` | push-up | still |
| `hip-thrust` | glute bridge two legs on bench | still |

Where a bar stands in for rings the action is identical and recognition is the
point. The face pull is the loosest: a cable stack rather than rings, and
standing rather than leaning back — but the arm path, high elbows and external
rotation are the part people get wrong, and those are shown.

## Stored locally

Ten files actually live in this folder. Five are whole-exercise:

| file | source | |
|---|---|---|
| `ring-leg-curl.jpg` | [liftmanual](https://liftmanual.com/suspender-leg-curl/) | |
| `pike-pushup.jpg` | [liftmanual](https://liftmanual.com/pike-push-up/) | matches level 1 |
| `dead-hang.gif` | smartworkout.app | animated, matches level 2 |
| `ring-facepull.gif` | smartworkout.app | on straps, animated |
| `ring-pullup.gif` | smartworkout.app | **on rings**, animated |

And seven are level-specific, all from [liftmanual](https://liftmanual.com/)
except the bodyweight squat:

| file | level it illustrates |
|---|---|
| `split-squat-L1.gif` | bodyweight squat, two legs |
| `split-squat-L2.gif` | split squat, staggered stance |
| `split-squat-L4.gif` | Bulgarian, rear foot on the 45 cm chair |
| `split-squat-L5.gif` | assisted pistol — the source holds a bed sheet, which is the same job the rings do |
| `hip-thrust-L1.gif` | glute bridge, shoulders and feet on the floor |
| `hip-thrust-L3.gif` | shoulder blades on the chair, feet down |
| `hip-thrust-L4.gif` | as L3, one leg extended |

Split squat level 3 has no file of its own: it points at `split-squat-L4.gif`,
because a rear foot on a 20 cm step and on a 45 cm chair are the same movement
at two heights.

Image containers are **transparent**, not white. The set mixes white line art
with dark-background clips, and a white container put white pillarbox bars
either side of the dark ones; letting the card show through frames both.

The two liftmanual stills are flattened onto white, because the sources are
transparent WebP and JPEG has no alpha.

The dead hang came from an **mp4**, converted to GIF. Worth knowing it earns
almost nothing: measured across the clip, the mean pixel change is **0.10%** and
the peak **0.19%** — it is an isometric hold, so there is nothing to animate. It
costs 164 KB against 13 KB for the still it replaced. Kept because the framing
is tighter and the dark background matches the pull-up beside it, not because
the motion adds information.

The two smartworkout GIFs each replaced a hotlinked approximation — a cable
machine for the face pull, a fixed bar for the pull-up — with the movement
performed on **straps and rings**, which is the actual setup. They are the only
illustrations on a dark background; it suits the app, and the accuracy is worth
the mismatch.

Both sources are 2.4 MB across 91 frames, which is video length for a four-second
loop. Each is resampled to every sixth frame at 360 px wide — **107 and 151 KB** —
and loses nothing at this display size.

Two gotchas when swapping a hotlinked illustration for a local one: an `image:`
URL in `data/program.js` **wins over any local file**, so it has to be removed;
and the id must come out of `GYMVISUAL` in `../app.js`, or the card keeps
crediting Gym Visual for someone else's picture.

They are **not** hotlinked, unlike the twelve above, for a concrete reason:
`liftmanual.com` sends no `access-control-allow-origin` header. With
`crossorigin="anonymous"` the browser would refuse the image outright; without
it, the response is opaque and the service worker cannot cache it, so offline
would break. A local file is same-origin, so neither problem arises — and it
does not lean on a third party's bandwidth.

## Deliberately missing (one)

Four exercises show the video link alone. A picture of the wrong movement is
worse than no picture:

| exercise | why |
|---|---|
| `movement-prep` | a four-part routine; no single frame represents it |

`suspended push-up` was also rejected for `pushup`: it shows hands in the rings,
which is level 5. Levels 1-4 are on the bars, which is where you will be for
months.

## Filling the gaps

**Photograph yourself** — your rings, your height, your ladder level, and it
doubles as a form record.

**AI generation** works for common movements and fails on ring work: image
models are poor at articulated equipment and exact body positions, and produce
confident nonsense. Check every one against a real video before keeping it.

Keep anything you add small; a few hundred KB is plenty at this display size.
