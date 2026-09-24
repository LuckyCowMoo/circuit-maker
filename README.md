# Circuit Maker

Build and simulate Boolean logic circuits in the browser. Drag in gates, wire them up and flip switches — the circuit runs live.

## Features

- **Gates:** AND, OR, XOR and buffer, each with 1 to 256 inputs and an optional NOT bubble (so NAND, NOR, XNOR and NOT are one click away; you can also drag the NOT bubble from the toolbar onto a gate). Gates can be rotated and flipped, and outline and fill colours can be changed after placing.
- **Inputs and outputs:** switches (toggle), buttons (held while pressed) and light bulbs. They can be resized and reshaped (long thin bulbs make display segments), and they stay visible above boxes when zoomed out. New inputs are labelled A, B, C … Z, AA, AB …; new bulbs 1, 2, 3 …. Collapsible lists either side of the toolbar show every input and output, where you can toggle, press, rename and find them.
- **Wiring:** drag from pin to pin. Drop a wire on empty space to pick a new part that is placed and connected for you. Wires are curved, run right up to the part they connect to, and each has its own dark hue; they glow in that hue when on, and the switch or button driving them lights up in the same colour. Free pins show a short stub.
- **Real-time simulation:** event-driven, so only the parts of a circuit that change get re-evaluated. Circuits with tens of thousands of gates stay responsive, and latches and oscillators behave as they should.
- **Markers:** named, coloured pins. When a marker is off-screen an arrow at the edge points to it; click the arrow to fly there. If nothing is on screen, an arrow points to the nearest part.
- **Boxes:** named, coloured groups that can be nested. Click inside one to select it; drag any edge or corner to resize it (boxes around it grow to fit). Moving a box moves everything inside it. Zoomed in, a box becomes a light background with its name in the corner; zoomed out or near the edge of the screen, it turns into a solid block with a large centred name that avoids the parts shown on top. Duplicating a box places the copy in the nearest free space.
- **Box connectors:** every wire through a box wall passes through a connector in the wall that you can label and slide along it, so a box reads like a chip with named pins. Copy a box and its connectors come with it, ready to be wired up; delete the wire on one side of a connector and the other side stays attached.
- **Examples:** grouped, with previews: logic gates, adders, an 8-bit adder and subtractor, 4-bit multiplier, divider, modulus and comparator, latches, a memory cell, D flip-flop, 8-bit register, 4-bit counter, 7-segment and 3-digit displays, a multiplexer and a decoder. Picking one adds it to the current project.
- **Infinite canvas:** pan in any direction; zoom is limited to a sensible range.
- **Themes:** Paper (the default: black on white), Midnight, Blueprint and Solar.
- **Files:**
  - Save the whole document or only the selection as a project (`.cmk.json`), SVG or PNG.
  - Open a project (in a new tab), or add one into the current project (for example, dropping a saved adder into a bigger calculator). A new blank project also opens in a new tab.
  - Work is autosaved in the browser, separately for each tab.
- **LLM-friendly format:** projects are plain, readable JSON. [`docs/CIRCUIT_FORMAT.md`](docs/CIRCUIT_FORMAT.md) explains the format in full and can be given to an LLM as a system prompt. You can paste circuit text straight onto the canvas with Ctrl+V; code fences, surrounding prose and aliases like `nand` or `led` are all accepted.

## Controls

| Action | How |
| --- | --- |
| Place a part | Drag it from the toolbar, or click it then click the canvas |
| Wire | Drag from one pin to another |
| Pan | Two-finger drag on a touchpad, right or middle drag, Space + drag, or the hand tool |
| Zoom | Pinch, or the mouse wheel |
| Select | Click, Shift+click, or drag a marquee on empty space |
| Resize a box | Drag an edge or corner |
| Resize a switch, button or bulb | Select it and drag a corner handle |
| Toggle a switch / press a button | Click it |
| Rotate / flip | `R` (Shift+`R` the other way) / `M` |
| More or fewer inputs | `+` / `-` |
| Toggle NOT bubble | `N`, or drag the NOT bubble onto a gate |
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
src/ui/       React toolbar, panels, input/output lists and context menu
src/examples/ built-in example circuits, generated in code
examples/     example circuit files (also used by the tests)
docs/         file format guide for people and LLMs
```
