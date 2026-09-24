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
| `inputs` | gates                    | Number of input pins, 1 or more (default 2, maximum 256).               |
| `not`    | gates                    | `true` adds a NOT bubble to the output (inverts it).                    |
| `on`     | switch                   | `true` if the switch starts switched on.                                |
| `name`   | switch, button, bulb, marker, port | Label shown beside it. Name inputs `A`, `B`, `C`... and outputs `1`, `2`, `3`... or with what they mean (`Sum`, `Carry`). |
| `color`  | marker, bulb             | Marker colour, or the colour a bulb glows. CSS colour, e.g. `"#e5484d"`. |
| `stroke` | gates, switch, button, bulb | Outline colour. Omit to use the theme colour (recommended).          |
| `fill`   | gates, switch, button, bulb | Interior colour. Omit to use the theme colour (recommended).         |
| `rotate` | gates, switch, button, bulb | Clockwise rotation in degrees: `0`, `90`, `180` or `270`. Default `0` (output pointing right). |
| `flip`   | gates, switch, button, bulb | `true` mirrors the part left to right (before rotating).             |
| `w`, `h` | switch, button, bulb     | Body size, 20 to 400 (default 40 x 40). Use long thin bulbs for display segments. |
| `box`    | port                     | Id of the box whose wall the port sits in.                             |
| `dir`    | port                     | `"in"` if the signal enters the box, `"out"` if it leaves.              |
| `inputSide`, `outputSide` | ribbon port | `"cable"` for one ribbon socket or `"wires"` for one pin per lane. |

### Types

| `type`   | Pins                      | Behaviour                                                                 |
|----------|---------------------------|---------------------------------------------------------------------------|
| `and`    | `inputs` in, 1 out        | On when **every** input is on. An unconnected input counts as off.        |
| `or`     | `inputs` in, 1 out        | On when **any** input is on.                                              |
| `xor`    | `inputs` in, 1 out        | On when an **odd number** of inputs are on.                               |
| `buffer` | `inputs` in, 1 out        | Copies its input (with several inputs: on when any input is on).          |
| `switch` | 0 in, 1 out               | Toggle input. The user clicks it to flip it on/off.                       |
| `button` | 0 in, 1 out               | Momentary input: on only while the user holds it down.                    |
| `bulb`   | 1 in (input `0`), 0 out   | Output indicator; lights up when its input is on.                        |
| `marker` | none                      | Non-functional navigation flag with a `name` and `color`.                 |
| `port`   | 1 or N in, 1 or N out     | Wire/ribbon connector. Ribbon input and output faces can independently be a cable socket or an array of lane pins. |

Inverted gates are written with `"not": true`. These shorthand types are also accepted
and are converted automatically: `nand`, `nor`, `xnor`, `not` (buffer with a bubble),
`lamp`/`light`/`led`/`output` (bulb), `toggle`/`input` (switch), `pushbutton` (button),
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
| `from`  | Id of the component whose **output** drives the wire (a gate, switch, button or port). |
| `to`    | Id of the component receiving the signal (a gate, bulb or port).          |
| `input` | Which input pin of `to`, counting from 0 at the top. Bulbs only have input `0`. |

Rules:

- Each input pin takes **at most one** wire. An output can drive any number of wires.
- A gate's `inputs` must be greater than every `input` index wired to it.
- Feedback loops are allowed (for latches and flip-flops). A loop with an odd number of
  inversions oscillates.
- Wires are drawn automatically as curves; there is nothing to route.
- Wire colour comes from the driving component, so every wire from the same output
  shares a colour, including after it passes through ports. Powered wires glow.
- Wires may go straight from a part outside a box to a part inside it. The app splits
  them at the box wall with a port (section 5).

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
- Keep the box's input switches and output bulbs **outside** it, so it reads like a
  chip with wires going in and coming out.
- Nested boxes must be fully inside their parent box.
- Sibling boxes must not overlap.

### Ports (connectors in box walls)

Every wire that crosses a box wall passes through a **port**: a small connector in the
wall, pointing in or out, that can be labelled and slid along the wall. They make a
box behave like a chip with named pins.

- **You don't need to write ports.** Wire parts directly across walls and the app adds
  them when the file is opened, one per signal per wall (a signal used by several
  parts inside a box enters through a single port).
- If the source of a wire is a named switch or button, the port takes its name.
- Saved files include the ports. A port is written as
  `{"id":"p1","type":"port","x":90,"y":10,"box":"ha1","dir":"in","name":"A"}`
  and is snapped onto the nearest point of its box's wall. Wires then run to and from
  the port (`input` `0`), not directly across the wall.
- A port whose outside is unconnected (for example in a copied box) outputs off.

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
3. Every wire's `from` is a gate, switch, button or port; every `to` is a gate, bulb or port.
4. No input pin has two wires; every gate's `inputs` covers its highest wired index.
5. Coordinates are multiples of 10; no two component bodies overlap.
6. Each box fully contains its members (with margin) and its nested boxes; sibling
   boxes don't overlap.
7. The circuit actually computes what was asked. Trace a few input combinations.
8. Output only the JSON.
