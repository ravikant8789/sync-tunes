# SyncTunes 🎧

A production-ready, real-time synchronized music listening web application for two users across different locations.

## Features

- **Room Management & Sharing:**
  - One-click Room creation with unique 6-character room codes.
  - 1-click shareable URL invite links (`?room=XYZ`) with auto-join.
  - Live connection status indicator (1/2 Waiting for partner vs. 2/2 Both Listeners Connected).
- **Audio Upload & HTTP 206 Partial Content Streaming:**
  - Upload local MP3, WAV, OGG, FLAC, or M4A audio files via drag & drop or file picker.
  - Express backend streams the uploaded files using `HTTP 206 Partial Content` (byte-range streaming) allowing instant seeking, low-latency playback, and progressive buffering.
  - Built-in synthesized **Chillwave Ambient Demo Track** (generated natively in Node.js via PCM WAV synthesis) for 1-click instant testing without requiring local audio files.
- **High-Precision Synchronization Engine:**
  - **NTP-Style Clock Synchronization:** Periodic ping-pong telemetry estimates network latency ($RTT/2$) and clock offsets.
  - **Instant Play/Pause Sync:** Actions on either client are broadcast immediately with server epoch timestamps.
  - **Seek & Scrub Sync:** Instant scrub timestamp synchronization.
  - **Dynamic Drift Correction:**
    - Sub-40ms: Strict lock ($1.0\times$ speed).
    - 40ms - 450ms: Imperceptible tempo adjustment ($1.05\times$ catch-up or $0.95\times$ slow-down).
    - $>450\text{ms}$: Direct timestamp snap.
  - Echo suppression flags prevent infinite ping-pong feedback loops.
- **Audio Visualizer & Social Reactions:**
  - Real-time HTML5 Web Audio API Canvas spectrum analyzer.
  - Real-time floating emoji reactions (❤️, 🔥, 🎶, 🎧, 👏).
  - Modern Tailwind CSS dark-mode glassmorphic interface with animated vinyl disc.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser:
   - User A: Navigate to `http://localhost:3000` and click **Create Room**.
   - User B: Click **Share Link** to copy the URL or open `http://localhost:3000?room=<ROOM_ID>` in a separate window/device.
   - Click **Load Chillwave Demo** or upload an MP3 file to begin listening in sync!
