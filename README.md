# Living Investigation Board

A browser-based, cinematic 3D investigation workspace built with React, React Three Fiber, Three.js, Zustand, GSAP, and a custom Verlet rope solver.

## What is implemented

- True 3D cork board, wooden frame, depth, PBR lighting, shadows, filmic tone mapping, bloom, vignette, and atmospheric dust.
- Low-FOV perspective camera with inertial Miro/Figma-style pan and zoom.
- Upload PNG, JPEG, WebP, GIF, and PDF files. PDF uploads render the first page as a board preview.
- 3D evidence objects: photographs, documents, sticky notes, suspect cards, location cards, press clippings, fingerprints, and investigator notes.
- Multi-select with Shift/Ctrl/Cmd click, group dragging, duplication, deletion, JSON import/export, local persistence, undo, and redo.
- Physical evidence strings rendered as dynamic tube geometry—not SVG, Canvas, CSS borders, or line primitives.
- Each rope uses 53 particles with Verlet integration, iterative distance constraints, gravity, damping, sag, overshoot, oscillation, growth animation, and sleeping.
- Rope materials: red yarn, twine, cotton, nylon, and blue thread.
- Metadata-ready graph model for confidence, timestamps, labels, tags, sources, and future AI annotations.

## Live demo

After the GitHub Pages workflow completes, the project will be available at:

https://alina65888.github.io/living-investigation-board/

## Run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Tests:

```bash
npm test
```

## Interaction

- Drag the background to pan.
- Use the wheel or trackpad to zoom.
- Drag evidence to move it; connected ropes physically follow and settle.
- Shift/Ctrl/Cmd-click to select multiple items.
- Choose the link tool, then click two evidence cards to grow a physical rope between them.
- `V`: select mode. `C`: connection mode. `Delete`: remove selection. `Ctrl/Cmd+D`: duplicate.
- `Ctrl/Cmd+Z`: undo. `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y`: redo.

## Architecture

- `domain/`: serializable evidence graph and metadata contracts.
- `store/`: Zustand document state, selection, transactions, history, persistence, import/export.
- `physics/`: decoupled custom Verlet/PBD rope solver.
- `components/scene/`: rendering engine, board, evidence objects, camera, dynamic tube geometry, rope renderer.
- `components/ui/`: upload, creation tools, inspector, history controls, status UI.
- `utils/`: PDF preview, file serialization, procedural cork and wood textures.

## Production scaling path

The included CPU solver is intentionally readable and modular. For several hundred simultaneously active ropes, retain the graph/store API and replace only the solver/renderer backends:

1. Pack rope particles into texture or storage buffers.
2. Solve constraints in WebGPU compute passes or ping-pong WebGL textures.
3. Generate camera-facing ribbon/tube vertices in the vertex shader.
4. Use visibility culling, distance LOD, adaptive particle counts, sleeping islands, and fixed-step worker simulation.
5. Instance evidence backings and pins; atlas paper materials and thumbnails.
6. Persist binary assets in object storage and board operations in an append-only collaborative event log.

The current implementation already sleeps settled ropes, updates geometry in place, avoids line primitives, and keeps physics decoupled from React state.
