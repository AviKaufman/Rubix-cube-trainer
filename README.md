# Rubik's Cube Trainer

A true 3D Rubik's Cube trainer built with Vite + Three.js. This experience is designed to live as a subpage of **avi-kaufman.com** and includes a guided, step-by-step beginner method.

Hosted at: **https://avi-kaufman.com**

## Features
- True 3D cube rendering with drag-orbit controls
- Manual face turns (buttons + keyboard shortcuts)
- Shuffle, reset, and full solve
- Guided tutorial with step-by-step “Apply Algorithm”
- Deterministic step solvers for the beginner method

## Tech Stack
- **Vite** (development/build)
- **Three.js** (3D rendering)
- **TypeScript**
- **cubejs** (solver utilities)

## Getting Started
```bash
npm install
npm run dev
```

### Build / Preview
```bash
npm run build
npm run preview
```

## Usage
1. Click **Shuffle 25** to randomize the cube.
2. Use **Apply Algorithm** to progress through the tutorial steps.
3. Use **Solve** for a complete solve from any state.

## Credits
- Step-by-step algorithms follow a standard beginner method.
- Full-solve capability uses `cubejs`.
- Built with assistance from OpenAI Codex.

## License
Private project for avi-kaufman.com. All rights reserved.
