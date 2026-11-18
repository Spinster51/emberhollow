# Emberhollow

A browser action RPG: pick a class, explore an open world by climbing and gliding, and grind for gear.
Built with Three.js + TypeScript + Vite. The full plan is in [docs/DESIGN.md](docs/DESIGN.md).

## Run it

```bash
npm install
npm run dev
```

Open the printed local URL and click the game to capture the mouse.

## Controls (milestone 1)

| Action | Keys |
|---|---|
| Move / look | WASD / mouse, scroll to zoom |
| Jump, climb-jump, open/close glider | Space |
| Jump off a wall | S + Space while climbing |
| Dodge-roll / sprint | Shift tap / Shift hold |
| Climb | walk into a wall |
| Toggle help | H |

## Test

```bash
npm test
```

Builds the game and drives it in headless Chromium (walk, jump, roll, climb, mantle, vault, glide, fall damage).

## Status

Milestone 1 (moving around) is done, using a placeholder blocky character. See the build order in the design doc.
