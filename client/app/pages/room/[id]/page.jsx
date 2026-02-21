"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { io } from "socket.io-client";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id;

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [peers, setPeers] = useState(new Map());
  const [username, setUsername] = useState("");
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const localVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const mySocketIdRef = useRef(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization (React StrictMode)
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    // Get username from localStorage
    const storedUsername = localStorage.getItem("username");
    const storedRoomId = localStorage.getItem("roomId");

    if (!storedUsername || !storedRoomId || storedRoomId !== roomId) {
      router.push("/");
      return;
    }

    setUsername(storedUsername);

    // Initialize media and socket
    initializeMediaAndSocket(storedUsername);

    return () => {
      // Cleanup
      isInitializedRef.current = false;
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      peersRef.current.forEach((peer) => peer.close());
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const initializeMediaAndSocket = async (username) => {
    try {
      // Get local media stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Initialize socket connection
      const socket = io("https://videochat-u37j.onrender.com:8081");
      socketRef.current = socket;

      socket.on("connect", () => {
        console.log("Connected to socket server with ID:", socket.id);
        mySocketIdRef.current = socket.id;
        socket.emit("joinRoom", { roomId, username });
      });

      socket.on("existingUsers", ({ users }) => {
        console.log("Existing users:", users);
        users.forEach((userId) => {
          // Prevent creating peer connection to self
          if (userId !== mySocketIdRef.current) {
            createPeerConnection(userId, true, stream);
          }
        });
      });

      socket.on("userJoined", ({ socketId }) => {
        console.log("User joined:", socketId);
        // Prevent creating peer connection to self
        if (socketId !== mySocketIdRef.current) {
          createPeerConnection(socketId, false, stream);
        }
      });

      socket.on("offer", async ({ offer, from }) => {
        console.log("Received offer from:", from);
        const peer = peersRef.current.get(from);
        if (peer) {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit("answer", { answer, to: from });
        }
      });

      socket.on("answer", async ({ answer, from }) => {
        console.log("Received answer from:", from);
        const peer = peersRef.current.get(from);
        if (peer) {
          await peer.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      socket.on("ice-candidate", async ({ candidate, from }) => {
        console.log("Received ICE candidate from:", from);
        const peer = peersRef.current.get(from);
        if (peer && candidate) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      socket.on("userLeft", ({ socketId }) => {
        console.log("User left:", socketId);
        const peer = peersRef.current.get(socketId);
        if (peer) {
          peer.close();
          peersRef.current.delete(socketId);
          setPeers(new Map(peersRef.current));
        }
        remoteStreamsRef.current.delete(socketId);
        setRemoteStreams(new Map(remoteStreamsRef.current));
      });
    } catch (error) {
      console.error("Error accessing media devices:", error);
      alert("Failed to access camera/microphone");
    }
  };

  const createPeerConnection = (userId, isInitiator, stream) => {
    // Don't create peer connection to self
    if (userId === mySocketIdRef.current) {
      console.log("Skipping peer connection to self");
      return;
    }

    // Don't create duplicate peer connections
    if (peersRef.current.has(userId)) {
      console.log("Peer connection already exists for:", userId);
      return;
    }

    console.log(`Creating peer connection with ${userId}, isInitiator: ${isInitiator}`);

    const configuration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    };

    const peer = new RTCPeerConnection(configuration);

    // Add local stream tracks to peer connection
    stream.getTracks().forEach((track) => {
      peer.addTrack(track, stream);
    });

    // Handle incoming tracks
    peer.ontrack = (event) => {
      console.log("Received remote track from:", userId);
      const [remoteStream] = event.streams;
      remoteStreamsRef.current.set(userId, remoteStream);
      setRemoteStreams(new Map(remoteStreamsRef.current));
    };

    // Handle ICE candidates
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", {
          candidate: event.candidate,
          to: userId,
        });
      }
    };

    peersRef.current.set(userId, peer);
    setPeers(new Map(peersRef.current));

    // If initiator, create and send offer
    if (isInitiator) {
      peer
        .createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .then(() => {
          socketRef.current.emit("offer", {
            offer: peer.localDescription,
            to: userId,
          });
        })
        .catch((error) => console.error("Error creating offer:", error));
    }

    return peer;
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const leaveRoom = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-gray-800 p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-semibold">
              Video Chat
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Room: {roomId} · {username}
            </p>
          </div>
          <button
            onClick={leaveRoom}
            className="px-4 py-2 bg-white text-black hover:bg-gray-200 transition-colors"
          >
            Leave
          </button>
        </div>
      </div>

      {/* Video Grid */}
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Local Video */}
            <div className="relative">
              <div className="border border-gray-800 bg-black overflow-hidden aspect-video">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute bottom-2 left-2 bg-black bg-opacity-70 px-2 py-1 text-xs">
                You ({username})
              </div>
            </div>

            {/* Remote Videos */}
            {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
              <div key={userId} className="relative">
                <div className="border border-gray-800 bg-black overflow-hidden aspect-video">
                  <video
                    autoPlay
                    playsInline
                    ref={(el) => {
                      if (el) el.srcObject = stream;
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-70 px-2 py-1 text-xs">
                  Peer {userId.substring(0, 6)}
                </div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="mt-6 flex justify-center gap-4">
            <button
              onClick={toggleAudio}
              className={`px-6 py-2 ${
                isAudioMuted
                  ? "bg-black border border-gray-600 text-gray-400"
                  : "bg-white text-black"
              } hover:opacity-80 transition-opacity`}
            >
              {isAudioMuted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={toggleVideo}
              className={`px-6 py-2 ${
                isVideoOff
                  ? "bg-black border border-gray-600 text-gray-400"
                  : "bg-white text-black"
              } hover:opacity-80 transition-opacity`}
            >
              {isVideoOff ? "Start Video" : "Stop Video"}
            </button>
          </div>

          {/* Connection Info */}
          <div className="mt-6 p-4 border border-gray-800 text-sm text-gray-400">
            <p>Connections: {remoteStreams.size}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
