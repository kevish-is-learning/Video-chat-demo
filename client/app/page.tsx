"use client";

import { useState, useSyncExternalStore, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function subscribe() {
  return () => {};
}

function getStoredValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramRoomId = searchParams.get("roomId") || "";

  const savedUsername = useSyncExternalStore(
    subscribe,
    () => getStoredValue("username"),
    () => ""
  );

  const savedRoomId = useSyncExternalStore(
    subscribe,
    () => getStoredValue("roomId"),
    () => ""
  );

  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");

  const currentUsername = username || savedUsername;
  const currentRoomId = roomId || paramRoomId || savedRoomId;

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();

    const finalUsername = currentUsername.trim();
    const finalRoomId = currentRoomId.trim();

    if (!finalUsername || !finalRoomId) {
      alert("Please enter both username and room ID");
      return;
    }

    localStorage.setItem("username", finalUsername);
    localStorage.setItem("roomId", finalRoomId);

    router.push(`/pages/room/${encodeURIComponent(finalRoomId)}`);
  };

  const handleGenerateRoom = () => {
    const randomId = Math.random().toString(36).substring(2, 9);
    setRoomId(randomId);
  };

  return (
    <div className="bg-black p-8 border border-white w-96">
      <h1 className="text-2xl font-semibold mb-2 text-center text-white">
        Video Chat
      </h1>
      <p className="text-center text-gray-400 text-sm mb-6">
        Enter your details to join
      </p>

      <form onSubmit={handleJoinRoom} className="space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm text-white mb-2">
            Username
          </label>
          <input
            type="text"
            id="username"
            value={currentUsername}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 bg-black border border-gray-600 text-white focus:outline-none focus:border-white"
            placeholder="Enter username"
            required
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label htmlFor="roomId" className="block text-sm text-white">
              Room ID
            </label>
            <button
              type="button"
              onClick={handleGenerateRoom}
              className="text-xs text-gray-400 hover:text-white underline cursor-pointer"
            >
              Generate ID
            </button>
          </div>
          <input
            type="text"
            id="roomId"
            value={currentRoomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full px-3 py-2 bg-black border border-gray-600 text-white focus:outline-none focus:border-white"
            placeholder="Enter room ID"
            required
          />
        </div>

        <button
          type="submit"
          className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 transition-colors mt-6 font-medium cursor-pointer"
        >
          Join Room
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <Suspense fallback={<div className="text-white">Loading...</div>}>
        <JoinForm />
      </Suspense>
    </div>
  );
}
