# Sand Storyboard

A Foundry VTT module for running GM-controlled visual novel-style slideshows, synced to all players in real time via **socketlib**.

---

## Features

- **Image slides** — display any image (Foundry paths or external URLs)
- **HTML slides** — embed arbitrary HTML/CSS content in a sandboxed iframe
- **Captions & speaker names** — styled caption bar with optional speaker tag
- **Crossfade or instant transitions** — per-slide setting
- **GM controls** — Prev/Next buttons + keyboard arrows, the GM is the only one who can advance slides
- **Fully synced** — all connected players see the exact same slide at the same moment via socketlib
- **Drag-to-reorder** slides in the editor
- **Import/Export JSON** — save and reload your slide decks
- **Progress dots** — visible indicator of position in the sequence

---

## Requirements

- Foundry VTT v13
- [socketlib](https://foundryvtt.com/packages/socketlib) (free, auto-installable as a dependency)

---

## Installation

### Option A — Manual (recommended for local/custom modules)

1. Copy the `sand-storyboard/` folder into your Foundry `Data/modules/` directory.
2. Restart Foundry (or reload modules).
3. Enable **Sand Storyboard** in your world's module settings.
4. Enable **socketlib** as well (it will be listed as a dependency).

### Option B — Via manifest URL

If you host `module.json` somewhere, you can paste its URL into
**Setup → Add-on Modules → Install Module → Manifest URL**.

---

## Usage

### Opening the Editor (GM only)

1. Click the **film icon** button in the Token Controls toolbar on the left side of the canvas.
2. The **Sand Storyboard** editor window opens.

### Adding Slides

Click **Image Slide** or **HTML Slide**, then fill in:

| Field | Description |
|-------|-------------|
| **Image URL / HTML** | For images: a Foundry path like `modules/my-module/img/scene.webp` or any URL. For HTML: paste full HTML markup. |
| **Caption** | Narration text shown at the bottom of the screen. |
| **Speaker** | Optional name shown above the caption (styled in gold). |
| **Transition** | Crossfade (smooth) or Instant. |

You can **drag** slides to reorder them.

### Presenting

1. Click **Present to Players** — all connected players immediately see the first slide.
2. Use **Next / Prev** buttons or keyboard **→ / ← / Space / Escape** to control the slideshow.
3. Click **End** (or press **Escape**) to close it for everyone.

### Preview (GM only)

Click **Preview** to open the slideshow locally without broadcasting to players — useful for checking your slides before going live.

### Import / Export

Use **Export** to save your slide deck as a `.json` file.
Use **Import** to reload it in any world.

---

## HTML Slides

HTML slides are rendered in a sandboxed `<iframe>` (`sandbox="allow-scripts allow-same-origin"`).
You can use inline CSS, embedded images (`<img src="...">`), and JavaScript within the frame.

**Example HTML slide content:**
```html
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin:0; background:#1a1a2e; color:#eee; font-family:'Palatino Linotype',serif;
         display:flex; align-items:center; justify-content:center; height:100vh; text-align:center; }
  h1 { font-size:3em; color:#f0c040; text-shadow: 0 0 20px rgba(240,192,64,0.5); }
  p  { font-size:1.3em; max-width:600px; }
</style>
</head>
<body>
  <div>
    <h1>Chapter II</h1>
    <p>The city of Araveth lay in ruins, its towers fallen to shadow...</p>
  </div>
</body>
</html>
```

---

## Keyboard Shortcuts (GM, during presentation)

| Key | Action |
|-----|--------|
| `→` / `↓` / `Space` | Next slide |
| `←` / `↑` | Previous slide |
| `Escape` | End slideshow for everyone |

---

## File Structure

```
sand-storyboard/
├── module.json          ← Foundry manifest
├── scripts/
│   └── main.js          ← All module logic
└── styles/
    └── storyboard.css   ← Viewer & editor styles
```

---

## License

MIT — free to use, modify, and distribute.
