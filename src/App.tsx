import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

interface ServerToClientEvents {
  'remote user joined': (remoteUserId: string) => void;
  'other user set': (otherUserId: string) => void;
  'add ice candidate': (remoteCandidateId: RTCIceCandidate) => void;
  offer: (remoteSdpPayload: DescriptionPayload) => void;
  answer: (localSdpPayload: DescriptionPayload) => void;
}

interface ClientToServerEvents {
  'join room': (roomId: string) => void;
  'add ice candidate': (localCandidatePayload: IceCandidatePayload) => void;
  offer: (localSdpPayload: DescriptionPayload) => void;
  answer: (remoteSdpPayload: DescriptionPayload) => void;
}

interface IceCandidatePayload {
  target: string;
  candidate: RTCIceCandidate;
}

interface DescriptionPayload {
  target: string;
  caller: string | undefined;
  sdp: RTCSessionDescription | null;
}

let count = 0;

function App() {
  const [roomId, setRoomId] = useState<string>('');
  const [videoMediaStream, setVideoMediaStream] = useState<MediaStream>();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef =
    useRef<Socket<ServerToClientEvents, ClientToServerEvents>>();
  const remoteUserRef = useRef<string>();
  const peerRef = useRef<RTCPeerConnection>();
  const sendChannelRef = useRef<RTCDataChannel>();
  const sendDataLoop = useRef<number>();
  const dataChannelCounter = useRef<string>('✅data 0');
  const receiveChannelRef = useRef<RTCDataChannel>();

  useEffect(() => {
    async function getMedia() {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 400 },
      });
      if (stream) {
        setVideoMediaStream(stream);
      }
    }
    getMedia();
  }, []);

  useEffect(() => {
    if (!localVideoRef.current) {
      return;
    }
    localVideoRef.current.srcObject = videoMediaStream || null;
  }, [videoMediaStream]);

  function clickHandler() {
    socketRef.current = io('http://127.0.0.1:9000', {
      transports: ['websocket', 'polling'],
    });
    if (roomId) {
      socketRef.current.emit('join room', roomId);
      socketRef.current.on('remote user joined', (remoteUserId) => {
        remoteUserRef.current = remoteUserId;
        makeCall();
      });
      socketRef.current.on('other user set', (otherUserId) => {
        remoteUserRef.current = otherUserId;
        console.log('Hello');
      });
      socketRef.current.on('add ice candidate', async (incomingCandidateId) => {
        try {
          peerRef.current &&
            (await peerRef.current.addIceCandidate(incomingCandidateId));
        } catch (error) {
          console.error(error);
        }
      });
    }
    socketRef.current.on('offer', handleOffer);
    socketRef.current.on('answer', handleAnswer);
  }

  function makeCall() {
    peerRef.current = configPeer();
    sendChannelRef.current = peerRef.current.createDataChannel('sendChannel', {
      ordered: true,
    });
    sendChannelRef.current.onopen = onSendChannelStateChange;
    sendChannelRef.current.onclose = onSendChannelStateChange;
    sendChannelRef.current.onerror = onSendChannelStateChange;
    peerRef.current.ontrack = gotRemoteStream;
    peerRef.current.ondatachannel = testFunc;
  }

  function configPeer() {
    const configuration = {
      iceServers: [{ urls: 'stun:stun4.l.google.com:19302' }],
    };
    const peerConnection = new RTCPeerConnection(configuration);

    videoMediaStream
      ?.getTracks()
      .forEach((track) => peerConnection.addTrack(track, videoMediaStream));

    peerConnection.onnegotiationneeded = handleNegotiationEvent;
    peerConnection.onicecandidate = handleIceCandidateEvent;

    return peerConnection;
  }

  function handleIceCandidateEvent(event: RTCPeerConnectionIceEvent) {
    console.log(peerRef.current);
    console.log(event.candidate);
    if (event.candidate && remoteUserRef.current) {
      const localCandidatePayload: IceCandidatePayload = {
        target: remoteUserRef.current,
        candidate: event.candidate,
      };
      socketRef.current &&
        socketRef.current.emit('add ice candidate', localCandidatePayload);
    }
  }

  async function handleNegotiationEvent() {
    if (peerRef.current && remoteUserRef.current && socketRef.current) {
      const offer = await peerRef.current.createOffer();
      await peerRef.current.setLocalDescription(offer);
      const localPayload: DescriptionPayload = {
        target: remoteUserRef.current,
        caller: socketRef.current.id,
        sdp: peerRef.current.localDescription,
      };
      socketRef.current.emit('offer', localPayload);
    }
  }

  function onSendChannelStateChange() {
    const readyState = sendChannelRef.current?.readyState;
    console.log(`Send channel state is: ${readyState}`);
    if (readyState === 'open') {
      sendDataLoop.current = setInterval(sendData as TimerHandler, 1000);
    } else {
      clearInterval(sendDataLoop.current);
    }
  }

  function sendData() {
    if (sendChannelRef.current?.readyState === 'open') {
      sendChannelRef.current?.send(dataChannelCounter.current);
      console.log(`DataChannel send counter: ${dataChannelCounter.current}`);
      ++count;
      dataChannelCounter.current = `✅data ${count}`;
    }
  }

  async function handleOffer(remoteSdpPayload: DescriptionPayload) {
    peerRef.current = configPeer();
    sendChannelRef.current = peerRef.current.createDataChannel('sendChannel', {
      ordered: true,
    });
    sendChannelRef.current.onopen = onSendChannelStateChange;
    sendChannelRef.current.onclose = onSendChannelStateChange;
    sendChannelRef.current.onerror = onSendChannelStateChange;
    peerRef.current.ontrack = gotRemoteStream;
    peerRef.current.ondatachannel = testFunc;
    const desc = new RTCSessionDescription(
      remoteSdpPayload.sdp as RTCSessionDescription
    );

    await peerRef.current.setRemoteDescription(desc);
    const answer = await peerRef.current.createAnswer();
    await peerRef.current.setLocalDescription(answer);
    const remotePayload: DescriptionPayload = {
      target: remoteSdpPayload.caller as string,
      caller: socketRef.current?.id,
      sdp: peerRef.current.localDescription,
    };
    socketRef.current?.emit('answer', remotePayload);
  }

  function testFunc(event: RTCDataChannelEvent) {
    receiveChannelRef.current = event.channel;
    receiveChannelRef.current.onmessage = onReceiveMessageCallback;
    receiveChannelRef.current.onopen = onReceiveChannelStateChange;
    receiveChannelRef.current.onclose = onReceiveChannelStateChange;
  }

  function gotRemoteStream(event: RTCTrackEvent) {
    if (
      remoteVideoRef.current &&
      remoteVideoRef.current.srcObject !== event.streams[0]
    ) {
      remoteVideoRef.current.srcObject = event.streams[0];
      console.log('Received remote stream');
    }
  }

  function onReceiveMessageCallback(event: MessageEvent) {
    console.log(`DataChannel receive counter : ${event.data}`);
  }

  function onReceiveChannelStateChange() {
    const readyState = receiveChannelRef.current?.readyState;
    console.log(`Receive channel state is: ${readyState}`);
  }

  function handleAnswer(localSdpPayload: DescriptionPayload) {
    const desc = new RTCSessionDescription(
      localSdpPayload.sdp as RTCSessionDescription
    );
    peerRef.current?.setRemoteDescription(desc);
  }

  function checkUser() {
    console.log(socketRef.current?.id);
  }

  function checkRemoteUser() {
    console.log(remoteUserRef.current);
  }

  return (
    <div className='App'>
      <div style={{ marginTop: 30 }}>
        <input type='text' onChange={(e) => setRoomId(e.target.value)}></input>
        <button onClick={clickHandler}>TEST BTN</button>
        <button onClick={checkUser}>CHECK USER BTN</button>
        <button onClick={checkRemoteUser}>CHECK REMOTE USER BTN</button>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          marginTop: 50,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <h1>Local</h1>
          <video
            style={{ backgroundColor: 'black', width: 300, height: 300 }}
            ref={localVideoRef}
            autoPlay
          />
        </div>
        <div>
          <h1>Remote</h1>
          <video
            style={{ backgroundColor: 'black', width: 300, height: 300 }}
            ref={remoteVideoRef}
            autoPlay
          />
        </div>
      </div>
    </div>
  );
}

export default App;
