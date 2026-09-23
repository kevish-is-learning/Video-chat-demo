"use client";

import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { io } from "socket.io-client";

const SOCKET_SERVER_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "https://video-chat-demo-6bdb.onrender.com";

function subscribe() {
  return () => {};
}

function getStoredValue(key) {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params?.id;

  const username = useSyncExternalStore(
    subscribe,
    () => getStoredValue("username"),
    () => ""
  );

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting"); // 'connecting' | 'connected' | 'disconnected' | 'error'

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const mySocketIdRef = useRef(null);
  const isInitializedRef = useRef(false);

  const flushPendingIceCandidates = useCallback(async (peer, userId) => {
    const queue = pendingCandidatesRef.current.get(userId) || [];
    if (queue.length > 0) {
      console.log(`Flushing ${queue.length} pending ICE candidates for: ${userId}`);
      for (const candidate of queue) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("Error adding queued ICE candidate:", err);
        }
      }
      pendingCandidatesRef.current.delete(userId);
    }
  }, []);

  const createPeerConnection = useCallback(
    (userId, isInitiator, stream) => {
      if (userId === mySocketIdRef.current) {
        return null;
      }

      if (peersRef.current.has(userId)) {
        return peersRef.current.get(userId);
      }

      console.log(`Creating peer connection with ${userId}, isInitiator: ${isInitiator}`);

      const configuration = {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
      };

      const peer = new RTCPeerConnection(configuration);

      if (stream) {
        stream.getTracks().forEach((track) => {
          peer.addTrack(track, stream);
        });
      }

      peer.ontrack = (event) => {
        console.log("Received remote track from:", userId);
        const [remoteStream] = event.streams;
        if (remoteStream) {
          remoteStreamsRef.current.set(userId, remoteStream);
          setRemoteStreams(new Map(remoteStreamsRef.current));
        }
      };

      peer.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit("ice-candidate", {
            candidate: event.candidate,
            to: userId,
          });
        }
      };

      peersRef.current.set(userId, peer);

      if (isInitiator) {
        peer
          .createOffer()
          .then((offer) => peer.setLocalDescription(offer))
          .then(() => {
            if (socketRef.current) {
              socketRef.current.emit("offer", {
                offer: peer.localDescription,
                to: userId,
              });
            }
          })
          .catch((error) => console.error("Error creating offer:", error));
      }

      return peer;
    },
    []
  );

  const initializeMediaAndSocket = useCallback(
    async (user) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        localStreamRef.current = stream;
        setLocalStream(stream);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        console.log("Connecting to Socket server at:", SOCKET_SERVER_URL);
        const socket = io(SOCKET_SERVER_URL, {
          transports: ["websocket", "polling"],
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
          console.log("Connected to socket server with ID:", socket.id);
          mySocketIdRef.current = socket.id;
          setConnectionStatus("connected");
          socket.emit("joinRoom", { roomId, username: user });
        });

        socket.on("connect_error", (error) => {
          console.error("Socket connection error:", error);
          setConnectionStatus("error");
        });

        socket.on("disconnect", (reason) => {
          console.log("Socket disconnected:", reason);
          setConnectionStatus("disconnected");
        });

        socket.on("existingUsers", ({ users }) => {
          console.log("Existing users in room:", users);
          users.forEach((userId) => {
            if (userId !== mySocketIdRef.current) {
              createPeerConnection(userId, true, stream);
            }
          });
        });

        socket.on("userJoined", ({ username: joinedUser, socketId }) => {
          console.log(`User ${joinedUser} joined: ${socketId}`);
          if (socketId !== mySocketIdRef.current) {
            createPeerConnection(socketId, false, stream);
          }
        });

        socket.on("offer", async ({ offer, from }) => {
          console.log("Received offer from:", from);
          let peer = peersRef.current.get(from);
          if (!peer) {
            peer = createPeerConnection(from, false, localStreamRef.current || stream);
          }

          if (peer) {
            try {
              await peer.setRemoteDescription(new RTCSessionDescription(offer));
              await flushPendingIceCandidates(peer, from);

              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              socket.emit("answer", { answer, to: from });
            } catch (err) {
              console.error("Error handling offer:", err);
            }
          }
        });

        socket.on("answer", async ({ answer, from }) => {
          console.log("Received answer from:", from);
          const peer = peersRef.current.get(from);
          if (peer) {
            try {
              await peer.setRemoteDescription(new RTCSessionDescription(answer));
              await flushPendingIceCandidates(peer, from);
            } catch (err) {
              console.error("Error setting remote description for answer:", err);
            }
          }
        });

        socket.on("ice-candidate", async ({ candidate, from }) => {
          console.log("Received ICE candidate from:", from);
          const peer = peersRef.current.get(from);
          if (peer && peer.remoteDescription && peer.remoteDescription.type) {
            try {
              await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.error("Error adding direct ICE candidate:", err);
            }
          } else {
            console.log(`Buffering ICE candidate for peer: ${from}`);
            const queue = pendingCandidatesRef.current.get(from) || [];
            queue.push(candidate);
            pendingCandidatesRef.current.set(from, queue);
          }
        });

        socket.on("userLeft", ({ socketId }) => {
          console.log("User left:", socketId);
          const peer = peersRef.current.get(socketId);
          if (peer) {
            peer.close();
            peersRef.current.delete(socketId);
          }
          pendingCandidatesRef.current.delete(socketId);
          remoteStreamsRef.current.delete(socketId);
          setRemoteStreams(new Map(remoteStreamsRef.current));
        });
      } catch (error) {
        console.error("Error accessing media devices:", error);
        alert(
          "Failed to access camera/microphone. Please allow camera and mic permissions in your browser."
        );
      }
    },
    [roomId, createPeerConnection, flushPendingIceCandidates]
  );

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const storedUsername = getStoredValue("username");
    const storedRoomId = getStoredValue("roomId");

    if (!storedUsername || !storedRoomId || storedRoomId !== roomId) {
      router.push(`/?roomId=${encodeURIComponent(roomId || "")}`);
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    initializeMediaAndSocket(storedUsername);

    const activePeers = peersRef.current;
    const activeCandidates = pendingCandidatesRef.current;

    return () => {
      isInitializedRef.current = false;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      activePeers.forEach((peer) => peer.close());
      activePeers.clear();
      activeCandidates.clear();
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId, router, initializeMediaAndSocket]);

  const toggleAudio = () => {
    const stream = localStreamRef.current || localStream;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current || localStream;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const leaveRoom = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-gray-800 p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">Video Chat</h1>
              <div className="flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border border-gray-700 bg-gray-900">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connectionStatus === "connected"
                      ? "bg-green-500 animate-pulse"
                      : connectionStatus === "connecting"
                      ? "bg-yellow-500 animate-pulse"
                      : "bg-red-500"
                  }`}
                />
                <span className="capitalize text-gray-300">
                  {connectionStatus === "connected"
                    ? "Live"
                    : connectionStatus === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-400 mt-1">
              Room: {roomId} · You: {username}
            </p>
          </div>
          <button
            onClick={leaveRoom}
            className="px-4 py-2 bg-white text-black hover:bg-gray-200 transition-colors font-medium text-sm cursor-pointer"
          >
            Leave Room
          </button>
        </div>
      </div>

      {/* Video Grid */}
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Local Video */}
            <div className="relative">
              <div className="border border-gray-800 bg-gray-950 overflow-hidden aspect-video rounded flex items-center justify-center">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                {isVideoOff && (
                  <div className="absolute inset-0 bg-gray-900 flex items-center justify-center text-gray-400 text-sm">
                    Camera is off
                  </div>
                )}
              </div>
              <div className="absolute bottom-2 left-2 bg-black bg-opacity-80 px-2 py-1 text-xs rounded text-white flex items-center gap-1.5">
                <span>{username} (You)</span>
                {isAudioMuted && <span className="text-red-400">· Muted</span>}
              </div>
            </div>

            {/* Remote Videos */}
            {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
              <div key={userId} className="relative">
                <div className="border border-gray-800 bg-gray-950 overflow-hidden aspect-video rounded flex items-center justify-center">
                  <video
                    autoPlay
                    playsInline
                    ref={(el) => {
                      if (el && el.srcObject !== stream) {
                        el.srcObject = stream;
                        el.play().catch((err) =>
                          console.log("Remote video autoplay caught:", err)
                        );
                      }
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-80 px-2 py-1 text-xs rounded text-white">
                  Peer {userId.substring(0, 6)}
                </div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="mt-8 flex justify-center items-center gap-4">
            <button
              onClick={toggleAudio}
              className={`px-6 py-2.5 rounded text-sm font-medium transition-colors cursor-pointer ${
                isAudioMuted
                  ? "bg-red-950 border border-red-700 text-red-200 hover:bg-red-900"
                  : "bg-white text-black hover:bg-gray-200"
              }`}
            >
              {isAudioMuted ? "Unmute Mic" : "Mute Mic"}
            </button>
            <button
              onClick={toggleVideo}
              className={`px-6 py-2.5 rounded text-sm font-medium transition-colors cursor-pointer ${
                isVideoOff
                  ? "bg-red-950 border border-red-700 text-red-200 hover:bg-red-900"
                  : "bg-white text-black hover:bg-gray-200"
              }`}
            >
              {isVideoOff ? "Start Camera" : "Stop Camera"}
            </button>
          </div>

          {/* Connection Info */}
          <div className="mt-8 p-4 border border-gray-800 bg-gray-950 rounded flex justify-between items-center text-sm text-gray-400">
            <div>
              <span className="font-medium text-gray-300">Connected Peers:</span>{" "}
              {remoteStreams.size}
            </div>
            <div className="text-xs text-gray-500">
              Server: {SOCKET_SERVER_URL.replace(/^https?:\/\//, "")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
