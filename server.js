const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8 // 100MB
});

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for audio uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `track-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB limit
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files (MP3, WAV, OGG, M4A, FLAC) are supported.'));
    }
  }
});

// In-Memory store for uploaded track metadata
// trackId -> { id, originalName, filename, filepath, mimeType, size, uploadTime }
const trackMetadata = new Map();

// In-Memory store for Rooms
// roomId -> { id, createdAt, users: Map(socketId -> { id, username, isHost }), state: { isPlaying, currentTime, lastUpdated, track } }
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      createdAt: Date.now(),
      users: new Map(),
      state: {
        track: null,
        isPlaying: false,
        currentTime: 0,
        lastUpdated: Date.now()
      }
    });
  }
  return rooms.get(roomId);
}

function calculateCurrentRoomTime(room) {
  if (!room.state.isPlaying) {
    return room.state.currentTime;
  }
  const elapsed = (Date.now() - room.state.lastUpdated) / 1000;
  return room.state.currentTime + elapsed;
}

// Generate a high quality 30-second chill synth demo WAV so users can test immediately without uploading
let demoWavBuffer = null;
function generateDemoWavBuffer() {
  const sampleRate = 44100;
  const numChannels = 2;
  const durationSec = 32;
  const totalSamples = sampleRate * durationSec;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = totalSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20);  // Format = 1 (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Musical chord progression (Cmaj7 -> Am7 -> Fmaj7 -> G7) in Hz
  const chords = [
    [261.63, 329.63, 392.00, 493.88], // Cmaj7
    [220.00, 261.63, 329.63, 392.00], // Am7
    [174.61, 220.00, 261.63, 329.63], // Fmaj7
    [196.00, 246.94, 293.66, 349.23]  // G7
  ];

  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const chordIndex = Math.floor((t % 16) / 4);
    const chord = chords[chordIndex];
    const beatPhase = (t * 2) % 1; // 120 bpm pulse

    // Smooth ambient pad
    let left = 0;
    let right = 0;
    for (let c = 0; c < chord.length; c++) {
      const freq = chord[c];
      const tone = Math.sin(2 * Math.PI * freq * t) * 0.12;
      const sub = Math.sin(Math.PI * freq * t) * 0.08;
      const detuned = Math.sin(2 * Math.PI * (freq * 1.003) * t) * 0.06;
      left += (tone + sub) * (0.8 + 0.2 * Math.sin(t * 0.5));
      right += (tone + detuned) * (0.8 + 0.2 * Math.cos(t * 0.5));
    }

    // Melodic arpeggio note
    const arpNotes = [chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[3] * 2];
    const arpStep = Math.floor((t * 4) % 4);
    const arpFreq = arpNotes[arpStep];
    const arpEnvelope = Math.exp(-((t * 4) % 1) * 3);
    const arp = Math.sin(2 * Math.PI * arpFreq * t) * 0.15 * arpEnvelope;
    left += arp * 0.7;
    right += arp * 0.9;

    // Gentle rhythm kick/click pulse
    const kickEnv = Math.max(0, 1 - beatPhase * 6);
    const kick = Math.sin(2 * Math.PI * 60 * Math.max(0, 1 - beatPhase * 3) * t) * 0.3 * kickEnv;
    left += kick;
    right += kick;

    // Fade in and fade out
    const fadeIn = Math.min(1, t / 1.5);
    const fadeOut = Math.min(1, (durationSec - t) / 2);
    const masterGain = fadeIn * fadeOut * 0.45;

    // Clamp and convert to 16-bit integer
    const sampleL = Math.max(-1, Math.min(1, left * masterGain));
    const sampleR = Math.max(-1, Math.min(1, right * masterGain));

    buffer.writeInt16LE(Math.floor(sampleL * 32767), offset);
    buffer.writeInt16LE(Math.floor(sampleR * 32767), offset + 2);
    offset += 4;
  }

  return buffer;
}

try {
  demoWavBuffer = generateDemoWavBuffer();
  console.log('Synthesized Chillwave Demo WAV generated successfully (32s).');
} catch (e) {
  console.error('Failed generating demo WAV buffer:', e);
}

// --- REST Endpoints ---

// Serve the built-in demo track
app.get('/api/demo-audio.wav', (req, res) => {
  if (!demoWavBuffer) {
    return res.status(500).send('Demo audio unavailable');
  }

  const range = req.headers.range;
  const total = demoWavBuffer.length;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const partialStart = parts[0];
    const partialEnd = parts[1];

    const start = parseInt(partialStart, 10);
    const end = partialEnd ? parseInt(partialEnd, 10) : total - 1;
    const chunksize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/wav'
    });
    res.end(demoWavBuffer.subarray(start, end + 1));
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes'
    });
    res.end(demoWavBuffer);
  }
});

// Upload audio track endpoint
app.post('/api/upload', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const trackId = path.parse(req.file.filename).name;
  const meta = {
    id: trackId,
    originalName: req.file.originalname,
    filename: req.file.filename,
    filepath: req.file.path,
    mimeType: req.file.mimetype || 'audio/mpeg',
    size: req.file.size,
    url: `/api/audio/${trackId}`,
    uploadTime: Date.now()
  };

  trackMetadata.set(trackId, meta);

  res.json({
    success: true,
    track: meta
  });
});

// HTTP 206 Partial Content Audio Streaming
app.get('/api/audio/:trackId', (req, res) => {
  const { trackId } = req.params;
  const meta = trackMetadata.get(trackId);

  if (!meta || !fs.existsSync(meta.filepath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const filePath = meta.filepath;
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

    if (start >= total || end >= total) {
      res.status(416).set('Content-Range', `bytes */${total}`).end();
      return;
    }

    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': meta.mimeType || 'audio/mpeg'
    });

    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': meta.mimeType || 'audio/mpeg',
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// YouTube metadata helper endpoint (public oEmbed, zero API key required)
app.get('/api/youtube-meta', async (req, res) => {
  const input = req.query.url || req.query.videoId;
  if (!input) return res.status(400).json({ error: 'Missing url or videoId parameter' });

  const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/) || input.match(/^([\w-]{11})$/);
  const videoId = match ? match[1] : null;

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid YouTube URL or Video ID' });
  }

  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  try {
    const response = await fetch(oembedUrl);
    if (!response.ok) throw new Error('oEmbed lookup failed');
    const data = await response.json();
    return res.json({
      success: true,
      videoId,
      title: data.title || 'YouTube Music',
      author: data.author_name || 'YouTube',
      thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`
    });
  } catch (err) {
    return res.json({
      success: true,
      videoId,
      title: `YouTube Video (${videoId})`,
      author: 'YouTube',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`
    });
  }
});

// Room status endpoint for diagnostics
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    id: room.id,
    userCount: room.users.size,
    state: {
      ...room.state,
      computedCurrentTime: calculateCurrentRoomTime(room)
    }
  });
});

// --- Socket.io Real-Time Synchronization Engine ---

io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentUsername = 'Listener';

  // 1. High precision NTP clock synchronization ping/pong
  socket.on('sync-ping', (data) => {
    socket.emit('sync-pong', {
      clientTimestamp: data?.clientTimestamp || Date.now(),
      serverTimestamp: Date.now()
    });
  });

  // 2. Room Join
  socket.on('join-room', ({ roomId, username }) => {
    if (!roomId) return;
    currentRoomId = roomId.trim();
    currentUsername = (username || 'Listener').trim().slice(0, 24);

    socket.join(currentRoomId);
    const room = getOrCreateRoom(currentRoomId);

    const isHost = room.users.size === 0;
    room.users.set(socket.id, {
      id: socket.id,
      username: currentUsername,
      isHost,
      joinedAt: Date.now()
    });

    // Send room state and user list to newly joined user
    const usersList = Array.from(room.users.values());
    const computedTime = calculateCurrentRoomTime(room);

    socket.emit('room-joined', {
      roomId: currentRoomId,
      user: { id: socket.id, username: currentUsername, isHost },
      users: usersList,
      state: {
        ...room.state,
        currentTime: computedTime,
        serverTime: Date.now()
      }
    });

    // Notify other users in the room
    socket.to(currentRoomId).emit('user-joined', {
      user: { id: socket.id, username: currentUsername, isHost },
      users: usersList
    });

    io.to(currentRoomId).emit('room-users-update', {
      users: usersList,
      count: usersList.length
    });
  });

  // 3. Audio Track Loaded Event
  socket.on('track-change', ({ roomId, track }) => {
    const targetRoomId = roomId || currentRoomId;
    const room = rooms.get(targetRoomId);
    if (!room) return;

    room.state.track = track;
    room.state.isPlaying = false;
    room.state.currentTime = 0;
    room.state.lastUpdated = Date.now();

    io.to(targetRoomId).emit('track-changed', {
      track,
      senderId: socket.id,
      username: currentUsername,
      serverTime: Date.now()
    });
  });

  // 4. Synchronized Play
  socket.on('sync-play', ({ roomId, currentTime }) => {
    const targetRoomId = roomId || currentRoomId;
    const room = rooms.get(targetRoomId);
    if (!room) return;

    room.state.isPlaying = true;
    room.state.currentTime = typeof currentTime === 'number' ? currentTime : room.state.currentTime;
    room.state.lastUpdated = Date.now();

    // Broadcast play event to all other clients in the room
    socket.to(targetRoomId).emit('sync-play', {
      currentTime: room.state.currentTime,
      serverTime: room.state.lastUpdated,
      senderId: socket.id,
      username: currentUsername
    });
  });

  // 5. Synchronized Pause
  socket.on('sync-pause', ({ roomId, currentTime }) => {
    const targetRoomId = roomId || currentRoomId;
    const room = rooms.get(targetRoomId);
    if (!room) return;

    room.state.isPlaying = false;
    room.state.currentTime = typeof currentTime === 'number' ? currentTime : calculateCurrentRoomTime(room);
    room.state.lastUpdated = Date.now();

    socket.to(targetRoomId).emit('sync-pause', {
      currentTime: room.state.currentTime,
      serverTime: room.state.lastUpdated,
      senderId: socket.id,
      username: currentUsername
    });
  });

  // 6. Synchronized Seek / Scrub
  socket.on('sync-seek', ({ roomId, currentTime, isPlaying }) => {
    const targetRoomId = roomId || currentRoomId;
    const room = rooms.get(targetRoomId);
    if (!room) return;

    room.state.currentTime = Math.max(0, currentTime);
    if (typeof isPlaying === 'boolean') {
      room.state.isPlaying = isPlaying;
    }
    room.state.lastUpdated = Date.now();

    socket.to(targetRoomId).emit('sync-seek', {
      currentTime: room.state.currentTime,
      isPlaying: room.state.isPlaying,
      serverTime: room.state.lastUpdated,
      senderId: socket.id,
      username: currentUsername
    });
  });

  // 7. Request Authoritative State (for drift recovery or reconnect)
  socket.on('request-sync-state', ({ roomId }) => {
    const targetRoomId = roomId || currentRoomId;
    const room = rooms.get(targetRoomId);
    if (!room) return;

    socket.emit('authoritative-sync-state', {
      isPlaying: room.state.isPlaying,
      currentTime: calculateCurrentRoomTime(room),
      serverTime: Date.now(),
      track: room.state.track
    });
  });

  // 8. Interactive Live Reaction Emojis
  socket.on('send-reaction', ({ roomId, emoji }) => {
    const targetRoomId = roomId || currentRoomId;
    io.to(targetRoomId).emit('receive-reaction', {
      emoji,
      senderId: socket.id,
      username: currentUsername
    });
  });

  // 9. Disconnection cleanup
  socket.on('disconnect', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      room.users.delete(socket.id);

      const usersList = Array.from(room.users.values());

      socket.to(currentRoomId).emit('user-left', {
        userId: socket.id,
        username: currentUsername,
        users: usersList
      });

      io.to(currentRoomId).emit('room-users-update', {
        users: usersList,
        count: usersList.length
      });

      // If empty for 30 minutes, clean room
      if (room.users.size === 0) {
        setTimeout(() => {
          const current = rooms.get(currentRoomId);
          if (current && current.users.size === 0) {
            rooms.delete(currentRoomId);
          }
        }, 30 * 60 * 1000);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  SyncTunes Server running on http://localhost:${PORT}`);
  console.log(`  Ready for synchronized 2-user listening.`);
  console.log(`===============================================`);
});
