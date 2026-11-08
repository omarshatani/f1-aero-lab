@AGENTS.md

## Claude Code Notes

- `AGENTS.md` (imported above) is the single source of truth for coordinate conventions, module responsibilities, keyboard bindings, and verification steps.
- Before modifying 3D deformation or GLTF loading, read `docs/ARCHITECTURE.md`.
- Before modifying FIA 2026 legality volumes or CFD aero equations, read `docs/CFD_AND_REGULATIONS.md` and check `.agents/skills/`.
- Always verify changes with `npm run build` (`tsc && vite build` with strict `noUnusedLocals` / `noUnusedParameters`).
