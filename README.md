# Galaxy_System

Astra is an interactive 3D galaxy with six synthetic solar systems, gravitational orbits, and volumetric nebula effects.

## Run locally

Install **Node.js 20 or newer** and Git, then run:

```sh
git clone https://github.com/FanZhu1998/Galaxy_System.git
cd Galaxy_System
npm start
```

Open **http://127.0.0.1:4173** in a modern browser with WebGL 2 enabled. The same commands work on Windows, macOS, and Linux. Press Ctrl+C in the terminal to stop the server.

**No `npm install`, build step, account, API key, or CDN connection is required.** The rendering library and icons are included locally. If npm is unavailable, run `node scripts/serve.mjs` instead.

Use the local server instead of double-clicking `index.html`: browser module loading and the sandboxed iframe need the supplied HTTP headers. After cloning, the editable application works without internet access.

## Explore

- Choose a solar system or click one of the labeled stars.
- Drag to rotate; scroll or pinch to zoom. Camera buttons provide the same controls.
- Pause the model, change its time rate, or show orbital paths.
- Select a planet to inspect its orbit, distance, and speed.

## Edit the source

| File | Purpose |
| --- | --- |
| `index.html` | Outer page and sandboxed iframe |
| `src/galaxy.html` | Application markup and Content Security Policy |
| `src/galaxy.js` | Three.js scenes, nebula shaders, GPU orbits, controls, and animation scheduling |
| `src/physics.js` | Gravitational constants, galactic rotation, and the Kepler solver |
| `src/systems.js` | Stellar masses and planetary system definitions |
| `src/base.css` | Shared typography, form controls, and theme tokens |
| `src/galaxy.css` | Galaxy-specific layout and colors |
| `scripts/serve.mjs` | Dependency-free local HTTP server |
| `test/` | Physics, server, and original-export checks |
| `vendor/` | Pinned third-party source and license files |
| `gravity-galaxy.html` | Original self-contained export, preserved unchanged; this older launch path still uses CDNs |

Edit the files under `src/`, then refresh the browser. No build is needed. The original export is a separate snapshot and is not regenerated when source files change.

Run the checks with:

```sh
npm run check
npm test
```

The local server binds to `127.0.0.1` by default. Set `PORT` to use another port. The application remains inside an `allow-scripts` iframe without `allow-same-origin`; static assets have CORS headers so modules can load from that isolated origin.

## Model and rendering

Stars follow circular test-particle orbits in a fixed Hernquist-plus-halo potential with a central point mass. Planets follow Keplerian ellipses around their host stars. Bodies are enlarged for visibility, and galactic and planetary views use separate accelerated clocks. Systems are fictional; planet interactions, gas dynamics, and relativity are not simulated.

Nebulae use a cached density texture and a lower-resolution emission-and-dust layer. Stellar motion runs on the GPU. Animation targets 30 fps, reduces cloud resolution on sustained slow frames, and stops rendering while paused with a settled camera or while offscreen.

## Troubleshooting

- **Port already in use:** stop the other server, or choose another `PORT`.
- **WebGL error:** enable browser hardware acceleration and update the browser or graphics driver. WebGL 2 support is required.
- **Blank page after opening a file directly:** start the local server and use the HTTP URL above.

The project uses the [MIT license](LICENSE). Included third-party code retains its own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
