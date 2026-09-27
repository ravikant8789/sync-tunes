const { io } = require('socket.io-client');

const SOCKET_URL = 'http://localhost:3000';
const ROOM_ID = 'TEST99';

console.log('--- Starting Dual-User Sync Engine Verification ---');

const userA = io(SOCKET_URL);
const userB = io(SOCKET_URL);

let userAReceivedSeek = false;
let userBReceivedPlay = false;

userA.on('connect', () => {
  console.log('[User A] Connected to Socket.io with ID:', userA.id);
  userA.emit('join-room', { roomId: ROOM_ID, username: 'Alice' });
});

userA.on('room-joined', (data) => {
  console.log('[User A] Successfully created/joined room:', data.roomId);
  
  // Now connect User B
  userB.emit('join-room', { roomId: ROOM_ID, username: 'Bob' });
});

userB.on('room-joined', (data) => {
  console.log('[User B] Successfully joined room:', data.roomId);
  console.log('[User B] Current participants in room:', data.users.length);

  // User A triggers Play event
  console.log('[User A] Emitting sync-play at timestamp 12.5s');
  userA.emit('sync-play', { roomId: ROOM_ID, currentTime: 12.5 });
});

userB.on('sync-play', (data) => {
  console.log('[User B] Received sync-play event:', data);
  if (data.currentTime === 12.5 && data.senderId === userA.id) {
    userBReceivedPlay = true;
    console.log('>>> VERIFICATION PASSED: Real-time play sync delivered accurately to User B');

    // User B scrubs to 45.0s
    console.log('[User B] Emitting sync-seek to 45.0s');
    userB.emit('sync-seek', { roomId: ROOM_ID, currentTime: 45.0, isPlaying: true });
  }
});

userA.on('sync-seek', (data) => {
  console.log('[User A] Received sync-seek event:', data);
  if (data.currentTime === 45.0 && data.senderId === userB.id) {
    userAReceivedSeek = true;
    console.log('>>> VERIFICATION PASSED: Real-time seek sync delivered accurately to User A');
  }
});

// Also test time synchronization ping/pong
userA.emit('sync-ping', { clientTimestamp: Date.now() });
userA.on('sync-pong', (data) => {
  console.log('[User A] Clock sync pong received:', data);
  console.log('>>> VERIFICATION PASSED: High-precision NTP ping/pong operational');
});

setTimeout(() => {
  console.log('--- Verification Summary ---');
  console.log('User B received Play:', userBReceivedPlay ? 'PASS' : 'FAIL');
  console.log('User A received Seek:', userAReceivedSeek ? 'PASS' : 'FAIL');

  userA.disconnect();
  userB.disconnect();

  if (userBReceivedPlay && userAReceivedSeek) {
    console.log('ALL SYNCHRONIZATION CHECKS PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.error('Verification failed');
    process.exit(1);
  }
}, 3000);
