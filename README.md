# GM Storyboard

A Foundry VTT module for running GM-controlled visual novel-style slideshows, synced to all players in real time via **socketlib**.

---

## Features

- **Image slides** — display any image (Foundry paths or external URLs) with thumbnail previews in the editor
- **HTML slides** — embed arbitrary HTML/CSS content in a sandboxed iframe
- **Captions & speaker names** — multi-line caption bar with optional speaker tag and typewriter reveal effect
- **Transitions** — a variety of standard and sand-themed canvas particle transitions
- **Ken Burns effect** — slow zoom or pan animations on image slides
- **Per-slide audio** — attach a looping audio file to any slide
- **Ambient particles** — continuous particle overlays per slide (snow, rain, embers, dust, fireflies)
- **Multiple decks** — create, rename, and delete separate storyboard decks
- **GM controls** — Prev/Next/End buttons + keyboard arrows, with progress dots
- **Fully synced** — all connected players see the exact same slide via socketlib, with late-join support
- **Sidebar toggle** — open Foundry's sidebar during a presentation (chat, journals, etc.) without leaving the slideshow
- **Drag-to-reorder** and **duplicate** slides in the editor

---

## Requirements

- Foundry VTT v13
- [socketlib](https://foundryvtt.com/packages/socketlib) (free, auto-installable as a dependency)

---

## Installation

Paste the following manifest URL into **Setup → Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/YourUser/sand-storyboard/releases/latest/download/module.json
```

---

## Usage

### Opening the Editor (GM only)

1. Select the **Journal Notes** tool group in the left toolbar, then click the **film icon** in the sub-toolbar.
2. The **GM Storyboard** editor window opens.

### Adding Slides

Click **Image Slide** or **HTML Slide**, then fill in:

| Field | Description |
|-------|-------------|
| **Image URL / HTML** | For images: a Foundry path or any URL (use the folder icon to browse). For HTML: paste full HTML markup. |
| **Caption** | Multi-line narration text shown at the bottom of the screen. |
| **Speaker** | Optional name shown above the caption (styled in gold). |
| **Transition** | Choose from standard or sand-themed particle transitions. |
| **Ken Burns** | (Image slides only) Slow zoom or pan animation. |
| **Ambient** | Continuous particle overlay on the slide. |
| **Audio** | Audio file that loops for the duration of the slide. |
| **Typewriter** | Enable to reveal caption text character-by-character. |

You can **drag** slides to reorder them, or click the **clone icon** to duplicate a slide.

### Presenting

1. Click **Present to Players** — all connected players immediately see the first slide.
2. Use **Next / Prev** buttons or keyboard **arrow keys** to control the slideshow.
3. Click **End** (or press **Escape**) to close it for everyone.
4. Players who join mid-presentation automatically sync to the current slide.

### Sidebar Access

During a presentation, click the **chevron tab** on the right edge of the screen to open Foundry's sidebar (chat, combat tracker, journals, etc.). Click again to close it. Works for both GM and players. Foundry windows opened from the sidebar appear above the storyboard.

### Preview (GM only)

Click **Preview** to open the slideshow locally without broadcasting to players — useful for checking your slides before going live.

### Multiple Decks

Use the dropdown at the top of the editor to switch between storyboard decks. The **+** button creates a new deck, the **pen** icon renames it, and the **trash** icon deletes it.

---

## Keyboard Shortcuts (GM, during presentation)

| Key | Action |
|-----|--------|
| `→` / `↓` | Next slide |
| `←` / `↑` | Previous slide |
| `Escape` | End slideshow for everyone |

---

## License

MIT — free to use, modify, and distribute.
