import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import bodyParser from "body-parser";

import { ApiResponse } from "./src/utils/api-response.js";

dotenv.config();
const PORT = Number(process.env.PORT) || 8080;
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());

app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).json(new ApiResponse(200, "Server is running"));
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

const usernameToSocketIdMap = {};
const socketToRoomMap = {};

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("joinRoom", (data) => {
    const { roomId, username } = data;
    socket.join(roomId);

    usernameToSocketIdMap[username] = socket.id;
    socketToRoomMap[socket.id] = roomId;

    // Get all sockets in the room
    const socketsInRoom = Array.from(
      io.sockets.adapter.rooms.get(roomId) || [],
    );
    const otherUsers = socketsInRoom.filter((id) => id !== socket.id);

    console.log(`User ${username} joined room: ${roomId}`);

    // Notify other users in the room
    socket.broadcast.to(roomId).emit("userJoined", {
      username,
      socketId: socket.id,
    });

    // Send existing users to the new user
    socket.emit("existingUsers", { users: otherUsers });
  });

  // WebRTC signaling
  socket.on("offer", (data) => {
    const { offer, to } = data;
    console.log(`Sending offer from ${socket.id} to ${to}`);
    io.to(to).emit("offer", { offer, from: socket.id });
  });

  socket.on("answer", (data) => {
    const { answer, to } = data;
    console.log(`Sending answer from ${socket.id} to ${to}`);
    io.to(to).emit("answer", { answer, from: socket.id });
  });

  socket.on("ice-candidate", (data) => {
    const { candidate, to } = data;
    console.log(`Sending ICE candidate from ${socket.id} to ${to}`);
    io.to(to).emit("ice-candidate", { candidate, from: socket.id });
  });

  socket.on("disconnect", () => {
    const roomId = socketToRoomMap[socket.id];
    if (roomId) {
      socket.broadcast.to(roomId).emit("userLeft", { socketId: socket.id });
      delete socketToRoomMap[socket.id];
    }
    for (const [user, sId] of Object.entries(usernameToSocketIdMap)) {
      if (sId === socket.id) {
        delete usernameToSocketIdMap[user];
        break;
      }
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
