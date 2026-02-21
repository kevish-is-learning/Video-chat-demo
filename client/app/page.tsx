"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const router = useRouter();

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !roomId.trim()) {
      alert("Please enter both username and room ID");
      return;
    }

    // Store username in localStorage
    localStorage.setItem("username", username);
    localStorage.setItem("roomId", roomId);
    
    // Navigate to room page
    router.push(`/pages/room/${roomId}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="bg-black p-8 border border-white w-96">
        <h1 className="text-2xl font-semibold mb-2 text-center text-white">
          Video Chat
        </h1>
        <p className="text-center text-gray-400 text-sm mb-6">Enter your details to join</p>
        
        <form onSubmit={handleJoinRoom} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm text-white mb-2">
              Username
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-black border border-gray-600 text-white focus:outline-none focus:border-white"
              placeholder="Enter username"
            />
          </div>

          <div>
            <label htmlFor="roomId" className="block text-sm text-white mb-2">
              Room ID
            </label>
            <input
              type="text"
              id="roomId"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full px-3 py-2 bg-black border border-gray-600 text-white focus:outline-none focus:border-white"
              placeholder="Enter room ID"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 transition-colors mt-6"
          >
            Join Room
          </button>
        </form>
      </div>
    </div>
  );
}
