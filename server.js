import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    credentials: true,
  },
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('hello ,', socket.id);
  socket.on('join room', (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].push(socket.id);
    } else {
      rooms[roomId] = [socket.id];
    }
    console.log(rooms);
    const remoteUserId = rooms[roomId].find((id) => id !== socket.id);
    console.log('remoteUser: ', remoteUserId);
    if (remoteUserId) {
      socket.emit('remote user joined', remoteUserId);
      socket.to(remoteUserId).emit('other user set', socket.id);
    }
  });
  socket.on('offer', (payload) => {
    io.to(payload.target).emit('offer', payload);
  });
  socket.on('answer', (payload) => {
    io.to(payload.target).emit('answer', payload);
  });
  socket.on('add ice candidate', (localCandidatePayload) => {
    io.to(localCandidatePayload.target).emit(
      'add ice candidate',
      localCandidatePayload.candidate
    );
  });
});

server.listen(9000, () => console.log('Server is up and running on Port 9000'));
