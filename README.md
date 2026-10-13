# Climbing Beta Studio

A 2.5D bouldering beta editor that uses a wall photo as its background. It helps climbers explain movement remotely by correcting route holds, arranging key poses, reviewing forgiving quasi-static load estimates, and exporting an MP4 video.

This is not a climbing safety assessment or a measurement of a person's ability. A single photo cannot provide true depth, friction, or force data. Values in the interface are labeled as estimated loads, and the model parameters can be adjusted.

## Run locally

Requires Node.js 22 or later. Server-side video export also requires FFmpeg and a local installation of Edge/Chrome or Playwright Chromium.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The project includes an interactive sample wall. Manual editing, playback, saving, and video export work without AI configuration.

To create a production build:

```bash
npm run build
npm start
```

The frontend and backend are then served from `http://localhost:3001`. To run with Docker:

```bash
cp .env.example .env
docker compose up --build
```

## DeepSeek visual recognition

Set these server-side variables in `.env`:

```dotenv
DEEPSEEK_API_KEY=your_server_key
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

The default model, `deepseek-flash`, supports image input. The app sends a base64-encoded image through DeepSeek's OpenAI-compatible Chat Completions API. The API key is read only by the Fastify server and is never included in the browser bundle. When you click **Analyze holds with DeepSeek**, a compressed copy of the current photo and the route color samples are sent to the configured DeepSeek API. The response is validated with Zod, and every suggested hold is marked as pending confirmation. If the key is missing, the request times out, or the response has an invalid format, the interface reports the error and manual editing remains available.

## Workflow

1. Upload a JPG, PNG, or WebP image. The browser corrects its orientation and creates a working copy with a maximum dimension of 2400 px.
2. Use **Sample color** to record one or more route colors. You can run AI recognition or use **Add hold** to add faded or missed holds manually.
3. In route setup mode, confirm each hold's route membership, shape, use direction, friction, outline, and load capacity. Select the clearly labeled **Set start holds** tool, then click one or two holds. A single hold means both hands start matched on it. In this mode, you can move holds without accidentally moving the climber.
4. In **Settings**, enter the wall height, angle, and climber parameters. For advanced calibration, use **Four-point calibration** to select the four corners of a rectangle with known dimensions.
5. Click **Start demonstration**. The app automatically places the hands, shoulders, and hips based on the start holds and wingspan, then saves the starting pose as the first keyframe. Drag hands or feet to target holds, or drag them to an empty area to release them. Drag the hips or shoulders to adjust the center of mass.
6. After completing each movement, click **Capture keyframe** in the timeline. Only captured keyframes are included in the video. After editing a selected frame, you can update it or capture a new frame. Before export, the app warns you if the current working pose has not been captured.
7. Playback interpolates between captured keyframes and checks intermediate poses at 60 Hz. Select **Export** to create a 720p or 1080p MP4.

On desktop, use mouse dragging and the scroll wheel to zoom. On phones, tap with one finger to select and use two fingers to zoom; select **Move canvas** to drag the view. Changes are saved automatically to IndexedDB. You can also export a `.climbbeta.zip` project containing the photo and JSON data.

## Mechanics model

- The center of mass is estimated from a simplified mass distribution across the hips, shoulders, and limb endpoints.
- Bone segment lengths remain fixed. Unreachable movements are not saved to the project.
- Each contact uses a three-ray friction-cone approximation. A projected-gradient solver estimates non-negative contact forces that minimize the residual force and torque.
- Slopers, side pulls, underclings, and footholds use different primary force directions, friction values, and load limits.
- Core load is estimated from the gravitational moment relative to the wall and lateral forces at the upper-body contacts. The model does not treat the balanced net moment of the whole body as core load.
- Uncalibrated projects return **Unable to determine**. Solver residual and estimated load are used separately to classify a pose as normal, a warning, or a reversible fall.
- During a hold change, the body uses damped elastic interpolation and briefly sags according to the remaining support. If failure persists beyond the project threshold, the preview releases the contacts and accelerates the climber downward under gravity.

The model aims to make movement demonstrations consistent and explainable. It does not predict injury risk and cannot replace on-site protection or professional instruction.

## Video export

When the browser supports WebCodecs AVC encoding, Mediabunny uses the shared Canvas renderer to create an H.264/MP4 file. Otherwise, the server-side fallback renders frames with Playwright Chromium and encodes them with FFmpeg as H.264 in an `yuv420p` MP4. Both paths use a frozen motion track; neither records mouse input, editing time, or the surrounding screen UI.

Server-side export jobs report progress, support cancellation and retry after failure, and are periodically cleaned up. A single video can be up to 120 seconds long. Configure the runtime paths and retention period with:

```dotenv
FFMPEG_PATH=ffmpeg
CHROMIUM_EXECUTABLE_PATH=
EXPORT_TTL_MINUTES=30
```

## Verification

```bash
npm run check          # 12 editing, mechanics, motion-track, and DeepSeek adapter tests, plus TypeScript and production build
npm run test:e2e       # 4 browser workflows across desktop and mobile viewports
npm run test:e2e:production # Run the same workflows against an already running production service on port 3001
npm start              # Start the server in another terminal before running:
npm run test:export    # Generate a real short MP4 under /tmp
npm audit              # Audit dependencies for known vulnerabilities
```

The following checks have passed for this delivery:

- All 12 unit tests passed, covering direct start-hold selection, editing-mode separation, automatic start placement, gravity sag, falling after sustained failure, and DeepSeek request and candidate conversion.
- All four Playwright workflows passed against both the development server and the production server. They cover desktop and Pixel 7 emulated viewports.
- The production TypeScript and Vite build passed.
- Server-side export produced a real H.264 MP4 at 1080×720, 30 fps, with `yuv420p` pixel format; `ffprobe` parsed it successfully.
- The npm audit reported no known vulnerabilities in production or development dependencies.

Not verified in this environment: a live DeepSeek request (no API key was provided), in-browser AVC encoding (`VideoEncoder` was unavailable in the browser used for acceptance), or testing on physical iOS Safari and Android Chrome devices. The app includes explicit fallbacks for these cases; they should not be considered verified by the checks above.

## Code layout

- `src/components`: Canvas, route and movement settings panels, and timeline.
- `src/lib/physics.ts`: Inverse kinematics, contact forces, and load calculations.
- `src/lib/motion.ts` and `src/workers`: Fixed-rate motion tracks and Web Workers.
- `src/lib/storage.ts`: IndexedDB storage and project ZIP files.
- `src/lib/exportVideo.ts`: Browser MP4 encoding and the server export client.
- `server/index.ts`: DeepSeek vision adapter, export jobs, and static file serving.

All project data uses `version: 1`. When changing the data structure, add an explicit migration to prevent older projects from being interpreted silently.
