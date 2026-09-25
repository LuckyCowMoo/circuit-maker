# Circuit Maker file format (`.cmk.json`)

You are writing circuits for **Circuit Maker**, a browser-based Boolean logic simulator.
A circuit is a single JSON object. Output **only** that JSON object (a Markdown code
fence around it is fine). The user will paste it into Circuit Maker (Ctrl+V) or save it
as a `.cmk.json` file and open it.

This document is the complete specification. Follow it exactly.

---

## 1. Top-level structure

```json
{
  "format": "circuit-maker",
  "version": 1,
  "name": "Half adder",
  "boxes": [],
  "components": [],
  "wires": []
}
```

| Field        | Required | Meaning                                                              |
|--------------|----------|----------------------------------------------------------------------|
| `format`     | yes      | Always the string `"circuit-maker"`.                                 |
| `version`    | yes      | Always `1`.                                                          |
| `name`       | yes      | Human-readable project name.                                         |
| `boxes`      | yes      | Named rectangles that group components (see section 5). May be `[]`. |
| `components` | yes      | Gates, inputs, outputs and markers (see section 3).                  |
| `wires`      | yes      | Connections from an output to an input (see section 4).              |
| `view`       | no       | Camera: `{"x": 0, "y": 0, "zoom": 1}` = world point at screen centre. Omit it and the app frames the whole circuit. |

Put **one object per line** inside each array. It keeps files short and easy to edit.

---

## 2. Coordinates

- Units are pixels at 100% zoom. **x grows to the right, y grows downward.**
- A component's `x`, `y` is the **top-left corner of its body** as drawn (after any
  rotation). Pin stubs stick out 20 units beyond the body (inputs on the left, output on
  the right, unless the part is rotated or flipped).
- Signals flow **left to right**: inputs on the left, outputs on the right.
- Use multiples of **10** for every coordinate so pins line up with the grid.

---

## 3. Components

Every component has `id`, `type`, `x`, `y`. Other fields depend on the type.

```json
{"id":"g1","type":"and","x":200,"y":0,"inputs":2}
```

| Field    | Types                    | Meaning                                                                 |
|----------|--------------------------|-------------------------------------------------------------------------|
| `id`     | all                      | Unique string. Use short, readable ids such as `a`, `sum`, `fa0_x1`.     |
| `type`   | all                      | See the table below.                                                    |
| `x`, `y` | all                      | Top-left of the body.                                                   |
| `inputs` | gates, ribbon port   | Gates: input pin count, 1 or more (default 2, maximum 256). Ribbon port: lane count. |
| `not`    | gates                    | `true` adds a NOT bubble to the output (inverts it).                    |
| `on`     | switch                   | `true` if the switch starts switched on.                                |
| `key`    | switch, button           | Keyboard binding as a `KeyboardEvent.code` (e.g. `"KeyA"`, `"Space"`). Switches toggle on press; buttons stay on while held. |
| `period` | timer                   | Cycle length in seconds, from 0.01 to 3600 (default 5).                   |
| `pulse`  | timer                   | High-time of each pulse in seconds (default 1, capped by `period`).      |
| `name`   | switch, button, timer, bulb, rgb, marker, port | Label shown beside it. Name inputs `A`, `B`, `C`... and outputs `1`, `2`, `3`... or with what they mean (`Sum`, `Carry`). |
| `color`  | marker, bulb             | Marker colour, or the colour a bulb glows. CSS colour, e.g. `"#e5484d"`. |
| `stroke` | gates, switch, button, timer, bulb, rgb | Outline colour. Omit to use the theme colour.               |
| `fill`   | gates, switch, button, timer, bulb, rgb | Interior colour. Bulbs are transparent when omitted.        |
| `rotate` | gates, switch, button, timer, bulb, rgb | Clockwise rotation in degrees: `0`, `90`, `180` or `270`.    |
| `flip`   | gates, switch, button, timer, bulb, rgb | `true` mirrors the part left to right before rotating.       |
| `w`, `h` | switch, button, timer, bulb, rgb | Body size, 20 to 400 (default 40 x 40). Switches and buttons in a circuit should be 120 x 120. |
| `box`    | port                     | Id of the box whose wall the port sits in.                             |
| `dir`    | port                     | `"in"` if the signal enters the box, `"out"` if it leaves.              |
| `inputSide`, `outputSide` | ribbon port | `"cable"` for one ribbon socket or `"wires"` for one pin per lane. |
| `inputSide` | rgb | `"cable"` for one 3-lane socket or `"wires"` for separate R, G and B pins. |

### Types

| `type`   | Pins                      | Behaviour                                                                 |
|----------|---------------------------|---------------------------------------------------------------------------|
| `and`    | `inputs` in, 1 out        | On when **every** input is on. An unconnected input counts as off.        |
| `or`     | `inputs` in, 1 out        | On when **any** input is on.                                              |
| `xor`    | `inputs` in, 1 out        | On when an **odd number** of inputs are on.                               |
| `buffer` | `inputs` in, 1 out        | Copies its input (with several inputs: on when any input is on).          |
| `switch` | 0 in, 1 out               | Toggle input. Click or a bound key toggles it.                            |
| `button` | 0 in, 1 out               | Momentary input: on while the pointer or a bound key is held.             |
| `timer`  | 0 in, 1 out               | Repeating pulse source controlled by `period` and `pulse` (seconds).      |
| `bulb`   | 1 in (input `0`), 0 out   | Output indicator; lights up when its input is on.                        |
| `rgb`    | 3 in, 0 out               | RGB indicator: inputs `0`, `1`, `2` control red, green and blue.         |
| `marker` | none                      | Non-functional navigation flag with a `name` and `color`.                 |
| `port`   | 1 or N in, 1 or N out     | Wire/ribbon connector. Ribbon input and output faces can independently be a cable socket or an array of lane pins. |

Inverted gates are written with `"not": true`. These shorthand types are also accepted
and are converted automatically: `nand`, `nor`, `xnor`, `not` (buffer with a bubble),
`lamp`/`light`/`led`/`output` (bulb), `rgbbulb` (RGB bulb), `clock`/`pulse` (timer),
`toggle`/`input` (switch), `pushbutton` (button),
`label`/`flag` (marker). Prefer the canonical form above.

### Component sizes and pin positions

You never need pin positions to write wires (wires reference ids), but you need sizes
to lay circuits out neatly without overlaps.

**Switch, button:** body `w` x `h` (default 40 x 40). Output pin at `(x + w + 20, y + h / 2)`.

**Bulb:** body `w` x `h` (default 40 x 40). Input pin at `(x - 20, y + h / 2)`.

These positions are for unrotated parts. Rotating turns the whole part, pins included,
about the centre of its body; for `90` and `270` the body's drawn size swaps to `h` x `w`.

**Marker:** body 30 x 40, plus its label to the right (about 10 units per character).

**Gates:**

- Body height `h = max(2, inputs) * 20`.
- Input pin `i` (0-based, top to bottom) is at `(x - 20, y + 10 + 20 * i)`.
  A 1-input gate has its single input at `(x - 20, y + 20)`.
- Output pin is at `(x + w + 20, y + h / 2)`, where `w` is the body width below,
  **plus 10 if the gate has `"not": true`**.

| inputs | h   | `and` w | `or` w | `xor` w | `buffer` w |
|--------|-----|---------|--------|---------|------------|
| 1      | 40  | 50      | 60     | 70      | 40         |
| 2      | 40  | 50      | 60     | 70      | 40         |
| 3      | 60  | 60      | 60     | 70      | 40         |
| 4      | 80  | 60      | 70     | 80      | 50         |
| 5      | 100 | 60      | 70     | 80      | 50         |
| 6      | 120 | 60      | 80     | 90      | 60         |
| 7      | 140 | 60      | 80     | 90      | 60         |
| 8      | 160 | 60      | 90     | 100     | 70         |

General rule: `and` w = 50 if h = 40, else 60. `or` w = min(90, 60 + 10 * floor((h - 40) / 40)).
`xor` w = `or` w + 10. `buffer` w = min(80, 40 + 10 * floor((h - 40) / 40)).

---

## 4. Wires

```json
{"from":"a","to":"g1","input":0}
```

| Field   | Meaning                                                                  |
|---------|--------------------------------------------------------------------------|
| `from`  | Id of the component whose **output** drives the wire (a gate, switch, button, timer or port). |
| `to`    | Id of the component receiving the signal (a gate, bulb, RGB bulb or port). |
| `input` | Which input pin of `to`, counting from 0 at the top. RGB uses 0=red, 1=green, 2=blue. |
| `lane`  | Which output lane of `from`, counting from 0 at the top. Omit for lane 0. Use this when a ribbon port's face is `"wires"`. |
| `cable` | `true` for one ribbon cable between two ribbon ports. Lane i of `from` drives lane i of `to`. `input` is 0. |

Rules:

- Each input pin takes **at most one** wire. An output can drive any number of wires.
- A gate's `inputs` must be greater than every `input` index wired to it.
- Feedback loops are allowed (for latches and flip-flops). A loop with an odd number of
  inversions oscillates.
- Do not specify a wire path. Wires are drawn as curves and bend around parts and boxes
  on their own. Still place boxes and ports so a wire is not forced to weave through a crowd.
- Wire colour comes from the driving component, so every wire from the same output
  shares a colour, including after it passes through ports. Powered wires glow.
- Four or more signals crossing one box wall should be a ribbon cable, not separate wires.
  Fewer than four stay as ordinary wires. See ports in section 5.
- A multi-bit number is always **8 bits**, even when the value would fit in fewer.
  **Bit 0 is the top lane** (lane 0, and input 0). An extra bit such as a carry is its own
  wire or its own port. Do not add it as a 9th lane on an 8-bit cable.

```json
{"from":"a_out","to":"sum_in","input":0,"cable":true}
```

---

## 5. Boxes (grouping and hierarchy)

A box is a named, coloured rectangle that groups everything inside it into a larger
component such as "Full adder" or "7-segment decoder".

```json
{"id":"ha1","name":"Half adder","x":120,"y":-40,"w":240,"h":220,"color":"#0f9d8a"}
```

| Field          | Meaning                                                        |
|----------------|----------------------------------------------------------------|
| `id`           | Unique string (shares the id space with components).           |
| `name`         | Title shown in the top-right corner, or large in the centre when zoomed out. |
| `x`, `y`, `w`, `h` | Rectangle; `w` and `h` at least 60 and 40.                 |
| `color`        | Optional CSS colour. Omit for the theme colour.                |

Membership is purely geometric:

- A **component belongs to a box** when the centre of its body is inside the box.
- A **box is nested inside another box** when it lies entirely inside it.
  Boxes can be nested to any depth.

Guidelines:

- Leave at least **30 units** between the box edge and any body inside it, and about
  **40 units** free along the top edge for the name.
- Switches and buttons live together in an **input box**. Do not leave them floating on their own.
  Make each one **120 x 120** (`"w":120,"h":120`).
- Nested boxes must be fully inside their parent box.
- Sibling boxes must not overlap.
- Take extra care that parts inside a box do not overlap. Bodies need at least 20 units between them.
- Copied blocks share a colour. Every half adder uses one colour; every full adder uses another.
  The same rule applies to any other block you repeat.
- Place boxes and ports so wires do not have to cross a tangle of other boxes and parts.
  Wires will bend around objects, but a short, open path is better than a long dodge.

### Ports (connectors in box walls)

Every wire that crosses a box wall passes through a **port** in that wall. A port can be
labelled. It makes a box read like a chip with named pins.

- **One to three signals** may cross as ordinary wires. You can wire straight across the
  wall and the app will add a port per signal. A named switch or button lends its name to that port.
- **Four or more signals** on one wall are a **ribbon port**: one cable socket on the outside
  of the box, and one pin per lane on the inside. Write the port yourself.

```json
{"id":"a_in","type":"port","x":200,"y":80,"inputs":8,"box":"adder","dir":"in","name":"A","inputSide":"cable","outputSide":"wires"}
```

| `dir` | Outside face | Inside face | Typical `inputSide` / `outputSide` |
|-------|----------------|-------------|-------------------------------------|
| `"in"`  | signal enters the box | fans out to the circuit inside | `"cable"` / `"wires"` |
| `"out"` | signal leaves the box | collects lanes from inside | `"wires"` / `"cable"` |

- `inputs` is the lane count. Lane 0 is the **top** pin and is bit 0 of a number.
- An 8-bit value uses `"inputs":8`. A carry or other extra bit gets its own port, not a 9th lane.
- The ribbon is about `inputs * 16` units tall along the wall. Put it on an edge long enough
  for that, clear of the corners and of every other port. Ports must not overlap.
- Join two ribbon sockets with one cable (`"cable":true`). Inside the box, wire each lane
  with `"lane":0` … `"lane":7` from or to the pin face.
- A port whose outside is unconnected (for example in a copied box) outputs off.
- Saved files include ports. A single-wire port looks like
  `{"id":"p1","type":"port","x":90,"y":10,"box":"ha1","dir":"in","name":"A"}`.

---

## 6. Layout guidelines

- Arrange logic in **columns by depth**: inputs at x = 0, then each stage of gates
  about 150-200 units to the right of the previous one, bulbs in the last column.
- Space rows **60-80 units** apart vertically (more for tall, many-input gates).
- Keep bodies at least 20 units apart. Never overlap components.
- Put related gates in a box. For repeated sub-circuits (e.g. the 8 full adders in an
  8-bit adder), give each copy its own box, offset by a constant amount, and prefix
  ids per copy: `fa0_x1`, `fa1_x1`, ...
- Add a `marker` near the main inputs (e.g. "Inputs") so users can find their way back.
- Give every switch, button and bulb a `name`. They are listed by name in the app's
  inputs and outputs panels.

The half-adder and full-adder examples below are only there to show nesting and wires.
When a circuit has switches, repeated blocks, or four or more signals on a wall, follow
the rules in this section and in section 5 instead of copying those examples' layout.

---

## 7. Example: half adder

```json
{
  "format": "circuit-maker",
  "version": 1,
  "name": "Half adder",
  "boxes": [
    {"id":"half_adder","name":"Half adder","x":120,"y":-40,"w":240,"h":220}
  ],
  "components": [
    {"id":"start","type":"marker","x":0,"y":-100,"name":"Start here"},
    {"id":"a","type":"switch","x":0,"y":0},
    {"id":"b","type":"switch","x":0,"y":80},
    {"id":"sum_gate","type":"xor","x":180,"y":10,"inputs":2},
    {"id":"carry_gate","type":"and","x":180,"y":100,"inputs":2},
    {"id":"sum","type":"bulb","x":420,"y":10},
    {"id":"carry","type":"bulb","x":420,"y":100}
  ],
  "wires": [
    {"from":"a","to":"sum_gate","input":0},
    {"from":"b","to":"sum_gate","input":1},
    {"from":"a","to":"carry_gate","input":0},
    {"from":"b","to":"carry_gate","input":1},
    {"from":"sum_gate","to":"sum","input":0},
    {"from":"carry_gate","to":"carry","input":0}
  ]
}
```

## 8. Example: full adder with nested boxes

```json
{
  "format": "circuit-maker",
  "version": 1,
  "name": "Full adder",
  "boxes": [
    {"id":"full_adder","name":"Full adder","x":100,"y":-60,"w":520,"h":300},
    {"id":"ha1","name":"Half adder 1","x":130,"y":-30,"w":160,"h":150,"color":"#0f9d8a"},
    {"id":"ha2","name":"Half adder 2","x":320,"y":-30,"w":160,"h":230,"color":"#0f9d8a"}
  ],
  "components": [
    {"id":"a","type":"switch","x":0,"y":0},
    {"id":"b","type":"switch","x":0,"y":60},
    {"id":"cin","type":"switch","x":0,"y":160},
    {"id":"x1","type":"xor","x":180,"y":0,"inputs":2},
    {"id":"a1","type":"and","x":180,"y":60,"inputs":2},
    {"id":"x2","type":"xor","x":370,"y":0,"inputs":2},
    {"id":"a2","type":"and","x":370,"y":120,"inputs":2},
    {"id":"o1","type":"or","x":510,"y":70,"inputs":2},
    {"id":"sum","type":"bulb","x":680,"y":0},
    {"id":"cout","type":"bulb","x":680,"y":70}
  ],
  "wires": [
    {"from":"a","to":"x1","input":0},
    {"from":"b","to":"x1","input":1},
    {"from":"a","to":"a1","input":0},
    {"from":"b","to":"a1","input":1},
    {"from":"x1","to":"x2","input":0},
    {"from":"cin","to":"x2","input":1},
    {"from":"x1","to":"a2","input":0},
    {"from":"cin","to":"a2","input":1},
    {"from":"a1","to":"o1","input":0},
    {"from":"a2","to":"o1","input":1},
    {"from":"x2","to":"sum","input":0},
    {"from":"o1","to":"cout","input":0}
  ]
}
```

Here `x1` and `a1` belong to "Half adder 1" because their body centres are inside it;
both half adders are nested in "Full adder" because they lie entirely inside it; `o1`
belongs only to "Full adder".

---

## 9. Checklist before you answer

1. `format` is `"circuit-maker"` and `version` is `1`.
2. Every id is unique across components **and** boxes.
3. Every wire's `from` is a gate, switch, button, timer or port; every `to` is a gate, bulb, RGB bulb or port.
4. No input pin has two wires; every gate's `inputs` covers its highest wired index.
   A ribbon cable uses `"cable":true` and does not also have a separate wire per lane.
5. Coordinates are multiples of 10; no two component bodies overlap, especially inside a box.
6. Switches and buttons are 120 x 120 and sit in an input box. Four or more signals on one
   wall use an 8-bit ribbon when they are a number (bit 0 on top; carry is not a 9th lane).
   Ribbon ports sit on edges long enough for them and do not overlap each other.
7. Each box fully contains its members (with margin) and its nested boxes; sibling
   boxes don't overlap. Repeated blocks share a colour.
8. The circuit actually computes what was asked. Trace a few input combinations.
9. Output only the JSON.
