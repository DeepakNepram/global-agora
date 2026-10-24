# Accessibility

What the app promises a reader who does not use a mouse, does not see
colour, does not want motion or does not see the screen, and how each
promise is checked. Prompt 5.1 set the bar: WCAG 2.2 AA, and the app fully
usable without the globe. The choices behind it are in
[`DECISIONS.md`](DECISIONS.md) (2026-10-24).

## Three ways to see the stories

The switch at the start of the filter row picks one, and the choice stays
on the device (`agora.view.v1`).

| View      | When                               | What it is                                                                                                                     |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Globe** | By default                         | The 3D globe (`src/ui/GlobeCanvas.tsx`).                                                                                       |
| **Map**   | The device asks for reduced motion | A flat equirectangular map on a 2D canvas (`src/ui/flatmap/`), drawn only when something changes. No WebGL context is created. |
| **List**  | Chosen                             | Every story the globe draws, as rows (`src/ui/list/`).                                                                         |

**The list is a view, not a fallback.** It holds the same stories as the
globe at the scrubber's time:

- the scrubber and Play drive it;
- the filters apply, and it says how many stories they leave out;
- it orders newest first or most covered, 50 rows at a time, with Show more.

**Each row reads as one sentence:** headline, then category, place, age
and number of sources, with commas.

**The globe behind the list** pauses and takes no input. It mounts only
when it is first wanted, so a reader who keeps to the list never loads its
textures.

**Choosing a place** from the list's search brings the map or globe back
and goes there.

## The keyboard

### On the globe and the map

The globe and the map are one tab stop each, an application that handles
its own keys:

| Key             | Does                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab / Shift+Tab | The next or previous pin in view, nearest the centre first. Each is read out. Past the last pin, Tab leaves for the next control, so it is never a trap. Shift+Tab from the first pin returns to the whole view. |
| Enter / Space   | Opens the focused story, or zooms into the focused cluster. With no pin focused, opens the story nearest the centre.                                                                                             |
| Arrows          | Turn the globe; move the map by a tenth of its frame.                                                                                                                                                            |
| + / −           | Zoom.                                                                                                                                                                                                            |
| Home            | Back to the resting view, centred on the reader's home city if they set one.                                                                                                                                     |
| Escape          | Steps an open story sheet down, else leaves the focused pin.                                                                                                                                                     |

**Which pins are in a round:** pins under the search bar, the scrubber or
an open sheet are not visible, so Tab skips them. So does a pin the filters
leave out.

**When the round starts again:** it holds while the camera is still and the
same pins are drawn. It starts again from the centre when either changes
(`src/ui/globe/usePinFocus.ts`).

**What a focused pin shows:** a ring follows it, accent inside a dark edge.

**What is read out:** each stop is announced in a polite live region:

- a story: its headline, category, place and age, and its place in the round ("3 of 41");
- a cluster: its size, main category and place, and that Enter zooms in.

### In the list

- **Up, Down, Home and End** move between rows; Tab still works too.
- **A row opens** the same sheet a pin does.
- **Closing the sheet** returns focus to the row, scrolled clear of the
  scrubber and the sheet.
- **Show more** moves focus to the first new row.

### Sheets and panels

|                                     | Modal | On opening, focus goes to                                      | On closing, focus returns to                    |
| ----------------------------------- | ----- | -------------------------------------------------------------- | ----------------------------------------------- |
| Story sheet                         | No    | The headline                                                   | The pin, the list row or the globe it came from |
| Library                             | No    | The selected tab (arrow keys move between tabs)                | The button that opened it                       |
| Sign-in, setup, account, onboarding | Yes   | The heading, or the least destructive choice of a confirmation | The opener                                      |
| Discussion panel                    | Yes   | The debate's question                                          | Discuss                                         |
| A post's menu                       | No    | Its first item                                                 | Its button; it also closes when focus leaves it |

**How the modals behave:**

- **Tab is trapped** (`src/ui/focus/focusTrap.ts`).
- **The rest is inert**, so neither Tab nor a screen reader's reading cursor
  reaches it. Behind any modal, that is the header, the footer and the skip
  link. Behind an account or onboarding sheet, it is also the view, the
  search bar, the scrubber, the story sheet and the library.
- **Account sheets** opened from inside a discussion stay usable above it.
- **Escape** closes or steps down everything.

## Reduced motion

With `prefers-reduced-motion: reduce`, there are:

- no camera flights;
- no inertia;
- no pulsing pins;
- no cluster bloom, and no glow;
- no sliding.

The globe becomes the flat map, and every "fly to" lands at once. The time
scrubber's Play still plays, because the reader asked for it.

The development panel's "Force full motion" brings the globe back, for
checks.

## Colour

**Never the only cue.** Each news category has a shape as well as a hue
(`src/core/categoryShapes.ts`), on every pin, on the map, and beside the
category's name in labels. The filter chips are the legend.

| Category | Shape                     |
| -------- | ------------------------- |
| World    | ● circle                  |
| Conflict | ▲ triangle                |
| Politics | ■ square                  |
| Business | ◆ diamond                 |
| Science  | ✖ cross                   |
| Climate  | ▼ triangle, pointing down |
| Tech     | ★ star                    |
| Health   | ✚ plus                    |

**Other places colour is backed up:**

- Cluster orbs carry their main category's shape on the rim.
- Discussion sides are always named next to their colour.
- A cast vote, a chosen side and a chosen post kind show a check mark.
- A post that arrives live says "New".
- Selected tabs and chips invert.

**Contrast** is audited in [`../tests/contrast.test.ts`](../tests/contrast.test.ts):

- every pair the app draws, from the theme tokens and Tailwind's palette;
- translucent colours blended over what they sit on;
- anything over the globe checked over sunlit cloud, the worst case.

| Kind                               | WCAG   | Minimum |
| ---------------------------------- | ------ | ------- |
| Text                               | 1.4.3  | 4.5:1   |
| What identifies a control or state | 1.4.11 | 3:1     |

A text colour the audit does not list fails the test, so a new pair cannot
ship unaudited.

## The checks

| What                                                                             | Where                        | Runs                                       |
| -------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| Contrast audit                                                                   | `tests/contrast.test.ts`     | `npm run test`, in CI's verify job         |
| axe-core, WCAG 2.2 A and AA and best practice, 17 states at 1280×800 and 390×844 | `tests/e2e/a11y.spec.ts`     | `npm run test:e2e`, CI's accessibility job |
| Keyboard paths and focus                                                         | `tests/e2e/keyboard.spec.ts` | the same                                   |

**What the browser checks run against:** the production build, in
Chromium, with software WebGL. The network is answered by
`tests/e2e/fixtures`: 120 stories, story details, and a stand-in for
Supabase. So they need no database or Worker.

**Any axe violation fails the build.**

**To run them locally:**

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

## Not covered by the checks

**Real screen readers.** No assistive technology runs in CI. Worth trying
by hand before a release:

- **NVDA or JAWS with Chrome on Windows.** Check that:
  - Tab through the globe's pins reads each one;
  - the list reads its rows as sentences;
  - each sheet's heading is read on opening;
  - the discussion's live posts are announced politely.
- **VoiceOver on an iPhone, and TalkBack on Android.** The globe and the
  map are not reachable by swiping (a canvas), and their labels point to
  the list, which is. Check that:
  - the switch works;
  - the list reads;
  - a story opens and closes back to its row.
- **200% zoom and 320 px width.** Nothing should be lost or need
  scrolling sideways.
