# Circuit Maker

Build and simulate Boolean logic circuits in the browser. Drag in gates, wire them up and flip switches — the circuit runs live.

## Features

- **Gates:** AND, OR, XOR and buffer, each with 1 to 256 inputs and an optional NOT bubble (so NAND, NOR, XNOR and NOT are one click away). Outline and fill colours can be changed after placing.
- **Inputs and outputs:** switches (toggle), buttons (held while pressed) and light bulbs.
- **Wiring:** drag from pin to pin. Drop a wire on empty space to pick a new part that is placed and connected for you. Wires are curved, each has its own dark hue, and they glow in that hue when on.
- **Real-time simulation:** event-driven, so only the parts of a circuit that change get re-evaluated. Circuits with tens of thousands of gates stay responsive, and latches and oscillators behave as they should.
- **Markers:** named, coloured pins. When a marker is off-screen an arrow at the edge points to it; click the arrow to fly there. If nothing is on screen, an arrow points to the nearest part.
- **Boxes:** named, coloured, resizable groups that can be nested. Moving a box moves everything inside it. Zoomed in, a box becomes a light background with its name in the corner; zoomed out or near the edge of the screen, it turns into a solid block with a large centred name. Duplicating a box places the copy in the nearest free space.
- **Infinite canvas:** pan in any direction; zoom is limited to a sensible range.
- **Themes:** Paper (the default: black on white), Midnight, Blueprint and Solar.
- **Files:**
  - Save the whole document or only the selection as a project (`.cmk.json`), SVG or PNG.
  - Open a project, or add one into the current project (for example, dropping a saved adder into a bigger calculator).
  - Work is also autosaved in the browser.
- **LLM-friendly format:** projects are plain, readable JSON. [`docs/CIRCUIT_FORMAT.md`](docs/CIRCUIT_FORMAT.md) explains the format in full and can be given to an LLM as a system prompt. You can paste circuit text straight onto the canvas with Ctrl+V; code fences, surrounding prose and aliases like `nand` or `led` are all accepted.

## Controls

| Action | How |
| --- | --- |
| Place a part | Drag it from the toolbar, or click it then click the canvas |
| Wire | Drag from one pin to another |
| Pan | Right or middle drag, Space + drag, or the hand tool |
| Zoom | Mouse wheel or pinch |
| Select | Click, Shift+click, or drag a marquee on empty space |
| Toggle a switch / press a button | Click it |
| More or fewer inputs | `+` / `-` |
| Toggle NOT bubble | `N` |
| Duplicate | Ctrl+D |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Copy / cut / paste | Ctrl+C / Ctrl+X / Ctrl+V |
| Save project | Ctrl+S |
| Fit everything in view | `F` |
| Delete | Delete or Backspace |

## Running locally

Requires Node 22 (the version the deploy workflow uses).

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # simulator, file format and layout tests
npm run build    # production build in dist/
```

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` tests, builds and publishes the site on every push to `main`.

1. Create an empty repository on GitHub (for example `circuit-maker`).
2. Push this project to it:
   ```bash
   git remote add origin https://github.com/<you>/circuit-maker.git
   git push -u origin main
   ```
3. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. The site will be live at `https://<you>.github.io/circuit-maker/` once the workflow finishes.

The build uses relative asset paths, so it works under any repository name without changes.

## Project layout

```
src/model/    types, geometry, gate shapes, themes, document helpers
src/sim/      event-driven simulator
src/io/       file format, SVG/PNG export, downloads
src/editor/   editor state and interaction, canvas renderer
src/ui/       React toolbar, panels and context menu
examples/     example circuits (also used by the tests)
docs/         file format guide for people and LLMs
```
