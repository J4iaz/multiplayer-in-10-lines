/*!
 * WebRTC Video & Audio Calling Module for NexusMeet
 * Features:
 * - P2P Mesh WebRTC (up to 6 peers)
 * - Microphone toggle with mute/unmute
 * - Camera toggle with live video track
 * - Screen share via getDisplayMedia
 * - Audio visualizer & active speaker glowing border
 * - Avatar fallback when camera is muted/off
 * - Graceful permission handling and error fallback
 */
(function (global) {
  'use strict';

  function initVideo(room, options) {
    var opts = options || {};
    var containerId = opts.containerId || 'video-dock';
    var dock = document.getElementById(containerId);
    if (!dock) {
      dock = document.createElement('div');
      dock.id = containerId;
      dock.className = 'video-dock-container';
      document.body.appendChild(dock);
    }

    var localStream = null;
    var screenStream = null;
    var peerConnections = new Map(); // peerId -> RTCPeerConnection
    var iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    var inCall = false;
    var audioMuted = false;
    var videoMuted = false;
    var isSharingScreen = false;
    var audioAnalyser = null;
    var audioAnimFrame = null;

    // Fetch STUN/TURN ICE servers from server
    fetch('/api/ice')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.iceServers && data.iceServers.length > 0) {
          iceServers = data.iceServers;
        }
      })
      .catch(function () {});

    // Render dock UI
    dock.innerHTML = [
      '<div class="video-dock-shell glass-panel">',
      '  <div class="video-dock-header">',
      '    <div class="video-dock-title">',
      '      <span class="video-live-dot"></span>',
      '      <span>Call <span id="video-count-badge" class="badge-count">0</span></span>',
      '    </div>',
      '    <button id="video-dock-minimize" class="dock-btn-icon" title="Minimize/Maximize Video Dock">⤢</button>',
      '  </div>',
      '  <div id="video-grid" class="video-grid"></div>',
      '  <div class="video-controls-bar">',
      '    <button id="video-btn-toggle-call" class="vbtn vbtn-call" title="Join or Leave Call">',
      '      <span class="vbtn-icon">📞</span> <span id="vbtn-call-label">Join Call</span>',
      '    </button>',
      '    <button id="video-btn-audio" class="vbtn vbtn-icon-only disabled" title="Mute/Unmute Mic" disabled>🎙️</button>',
      '    <button id="video-btn-video" class="vbtn vbtn-icon-only disabled" title="Start/Stop Camera" disabled>📹</button>',
      '    <button id="video-btn-screen" class="vbtn vbtn-icon-only disabled" title="Share Screen" disabled>🖥️</button>',
      '  </div>',
      '</div>',
    ].join('\n');

    var grid = document.getElementById('video-grid');
    var btnCall = document.getElementById('video-btn-toggle-call');
    var btnCallLabel = document.getElementById('vbtn-call-label');
    var btnAudio = document.getElementById('video-btn-audio');
    var btnVideo = document.getElementById('video-btn-video');
    var btnScreen = document.getElementById('video-btn-screen');
    var btnMin = document.getElementById('video-dock-minimize');
    var countBadge = document.getElementById('video-count-badge');

    if (btnMin) {
      btnMin.addEventListener('click', function () {
        dock.classList.toggle('minimized');
      });
    }

    function updatePeerCount() {
      var count = (inCall ? 1 : 0) + peerConnections.size;
      if (countBadge) countBadge.textContent = String(count);
      if (grid) {
        grid.setAttribute('data-peer-count', String(count));
      }
    }

    function createPeerConnection(targetPeerId) {
      if (peerConnections.has(targetPeerId)) {
        return peerConnections.get(targetPeerId);
      }

      var pc = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)({
        iceServers: iceServers,
      });

      peerConnections.set(targetPeerId, pc);

      if (localStream) {
        localStream.getTracks().forEach(function (track) {
          pc.addTrack(track, localStream);
        });
      }

      pc.onicecandidate = function (evt) {
        if (evt.candidate) {
          room.sendMsg({
            type: 'rtc_ice',
            targetId: targetPeerId,
            candidate: evt.candidate,
          });
        }
      };

      pc.ontrack = function (evt) {
        var remoteStream = evt.streams && evt.streams[0] ? evt.streams[0] : new MediaStream([evt.track]);
        renderRemoteVideo(targetPeerId, remoteStream);
      };

      pc.onconnectionstatechange = function () {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          removeRemoteVideo(targetPeerId);
        }
      };

      updatePeerCount();
      return pc;
    }

    function renderLocalVideo(stream) {
      var existing = document.getElementById('video-tile-local');
      if (!existing) {
        existing = document.createElement('div');
        existing.id = 'video-tile-local';
        existing.className = 'video-tile local-tile';
        grid.appendChild(existing);
      }

      existing.innerHTML = [
        '<div class="tile-inner">',
        '  <video id="local-video-elem" autoplay playsinline muted></video>',
        '  <div class="tile-overlay">',
        '    <span class="tile-name">You' + (isSharingScreen ? ' (Screen)' : '') + '</span>',
        '    <span id="local-tile-audio-indicator" class="tile-indicator">🎙️</span>',
        '  </div>',
        '</div>',
      ].join('');

      var videoEl = existing.querySelector('video');
      if (videoEl && stream) {
        videoEl.srcObject = stream;
        videoEl.play().catch(function () {});
      }
      setupLocalAudioAnalysis(stream);
      updatePeerCount();
    }

    function setupLocalAudioAnalysis(stream) {
      try {
        if (!stream || !stream.getAudioTracks().length) return;
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        var audioCtx = new AudioCtx();
        var source = audioCtx.createMediaStreamSource(stream);
        audioAnalyser = audioCtx.createAnalyser();
        audioAnalyser.fftSize = 64;
        source.connect(audioAnalyser);

        var dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
        function checkVolume() {
          if (!inCall) return;
          audioAnalyser.getByteFrequencyData(dataArray);
          var sum = 0;
          for (var i = 0; i < dataArray.length; i++) sum += dataArray[i];
          var avg = sum / dataArray.length;
          var localTile = document.getElementById('video-tile-local');
          if (localTile) {
            if (avg > 25 && !audioMuted) {
              localTile.classList.add('speaking');
            } else {
              localTile.classList.remove('speaking');
            }
          }
          audioAnimFrame = requestAnimationFrame(checkVolume);
        }
        checkVolume();
      } catch (e) {}
    }

    function renderRemoteVideo(peerId, stream) {
      var tileId = 'video-tile-' + peerId;
      var existing = document.getElementById(tileId);
      if (!existing) {
        existing = document.createElement('div');
        existing.id = tileId;
        existing.className = 'video-tile remote-tile';
        grid.appendChild(existing);
      }

      var peerPresence = null;
      if (room.getPresence) {
        var pList = room.getPresence() || [];
        for (var i = 0; i < pList.length; i++) {
          if (pList[i].id === peerId) {
            peerPresence = pList[i];
            break;
          }
        }
      }

      var peerName = peerPresence ? peerPresence.name : 'Peer';
      var peerColor = peerPresence ? peerPresence.color : '#96d7ff';

      existing.innerHTML = [
        '<div class="tile-inner">',
        '  <video autoplay playsinline></video>',
        '  <div class="tile-avatar-fallback" style="background:' + peerColor + '22;border-color:' + peerColor + '">',
        '    <span class="avatar-letter">' + (peerName[0] || '?').toUpperCase() + '</span>',
        '  </div>',
        '  <div class="tile-overlay">',
        '    <span class="tile-name" style="color:' + peerColor + '">' + escapeHtml(peerName) + '</span>',
        '    <span id="audio-ind-' + peerId + '" class="tile-indicator">🎙️</span>',
        '  </div>',
        '</div>',
      ].join('');

      var videoEl = existing.querySelector('video');
      if (videoEl && stream) {
        videoEl.srcObject = stream;
        videoEl.play().catch(function () {});
      }
      updatePeerCount();
    }

    function removeRemoteVideo(peerId) {
      var pc = peerConnections.get(peerId);
      if (pc) {
        pc.close();
        peerConnections.delete(peerId);
      }
      var tile = document.getElementById('video-tile-' + peerId);
      if (tile && tile.parentNode) {
        tile.parentNode.removeChild(tile);
      }
      updatePeerCount();
    }

    function escapeHtml(str) {
      return String(str || '').replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }

    async function startCall() {
      try {
        btnCall.disabled = true;
        btnCallLabel.textContent = 'Connecting…';

        // Request local media with fallback to audio-only if camera is unavailable
        try {
          localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 24 } },
          });
        } catch (mediaErr) {
          try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (audioOnlyErr) {
            // Virtual dummy stream if user has no mic/camera connected
            localStream = createDummyStream();
          }
        }

        inCall = true;
        dock.classList.add('active');
        btnCallLabel.textContent = 'Leave Call';
        btnCall.classList.add('vbtn-danger');
        btnCall.disabled = false;

        btnAudio.disabled = false;
        btnAudio.classList.remove('disabled');
        btnVideo.disabled = false;
        btnVideo.classList.remove('disabled');
        btnScreen.disabled = false;
        btnScreen.classList.remove('disabled');

        renderLocalVideo(localStream);

        // Announce to room
        room.sendMsg({
          type: 'rtc_join',
          mediaState: { audio: !audioMuted, video: !videoMuted, screen: false },
        });
      } catch (err) {
        btnCall.disabled = false;
        btnCallLabel.textContent = 'Join Call';
        alert('Could not start call: ' + err.message);
      }
    }

    function createDummyStream() {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0a102a';
        ctx.fillRect(0, 0, 320, 240);
        return canvas.captureStream(5);
      } catch (e) {
        return null;
      }
    }

    function endCall() {
      inCall = false;
      dock.classList.remove('active');

      if (audioAnimFrame) cancelAnimationFrame(audioAnimFrame);
      if (localStream) {
        localStream.getTracks().forEach(function (t) { t.stop(); });
        localStream = null;
      }
      if (screenStream) {
        screenStream.getTracks().forEach(function (t) { t.stop(); });
        screenStream = null;
      }

      peerConnections.forEach(function (pc) {
        try { pc.close(); } catch (e) {}
      });
      peerConnections.clear();

      room.sendMsg({ type: 'rtc_leave' });

      grid.innerHTML = '';
      btnCallLabel.textContent = 'Join Call';
      btnCall.classList.remove('vbtn-danger');
      btnCall.disabled = false;

      btnAudio.disabled = true;
      btnAudio.classList.add('disabled');
      btnVideo.disabled = true;
      btnVideo.classList.add('disabled');
      btnScreen.disabled = true;
      btnScreen.classList.add('disabled');

      updatePeerCount();
    }

    // Toggle call button
    btnCall.addEventListener('click', function () {
      if (inCall) {
        endCall();
      } else {
        startCall();
      }
    });

    // Mute/Unmute Mic
    btnAudio.addEventListener('click', function () {
      if (!localStream) return;
      audioMuted = !audioMuted;
      localStream.getAudioTracks().forEach(function (track) {
        track.enabled = !audioMuted;
      });
      btnAudio.textContent = audioMuted ? '🔇' : '🎙️';
      btnAudio.classList.toggle('muted', audioMuted);
      var ind = document.getElementById('local-tile-audio-indicator');
      if (ind) ind.textContent = audioMuted ? '🔇' : '🎙️';

      room.sendMsg({
        type: 'media_state',
        audio: !audioMuted,
        video: !videoMuted,
        screen: isSharingScreen,
      });
    });

    // Toggle Camera
    btnVideo.addEventListener('click', function () {
      if (!localStream) return;
      videoMuted = !videoMuted;
      localStream.getVideoTracks().forEach(function (track) {
        track.enabled = !videoMuted;
      });
      btnVideo.textContent = videoMuted ? '🚫' : '📹';
      btnVideo.classList.toggle('muted', videoMuted);
      var localTile = document.getElementById('video-tile-local');
      if (localTile) localTile.classList.toggle('video-off', videoMuted);

      room.sendMsg({
        type: 'media_state',
        audio: !audioMuted,
        video: !videoMuted,
        screen: isSharingScreen,
      });
    });

    // Screen Share
    btnScreen.addEventListener('click', async function () {
      if (!inCall) return;
      try {
        if (!isSharingScreen) {
          screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          var screenTrack = screenStream.getVideoTracks()[0];

          peerConnections.forEach(function (pc) {
            var sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
            if (sender) sender.replaceTrack(screenTrack);
          });

          renderLocalVideo(screenStream);
          isSharingScreen = true;
          btnScreen.classList.add('active');

          screenTrack.onended = function () {
            stopScreenShare();
          };
        } else {
          stopScreenShare();
        }
      } catch (err) {
        console.warn('Screen share cancelled/failed:', err);
      }
    });

    function stopScreenShare() {
      if (!isSharingScreen) return;
      isSharingScreen = false;
      btnScreen.classList.remove('active');
      if (screenStream) {
        screenStream.getTracks().forEach(function (t) { t.stop(); });
        screenStream = null;
      }
      if (localStream) {
        var videoTrack = localStream.getVideoTracks()[0];
        peerConnections.forEach(function (pc) {
          var sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
          if (sender && videoTrack) sender.replaceTrack(videoTrack);
        });
        renderLocalVideo(localStream);
      }
    }

    // Room WebSocket WebRTC Signaling Listeners
    room.on('rtc_peers', function (msg) {
      if (!inCall) return;
      var peers = msg.peers || [];
      peers.forEach(async function (peer) {
        var pc = createPeerConnection(peer.id);
        try {
          var offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          room.sendMsg({
            type: 'rtc_offer',
            targetId: peer.id,
            offer: offer,
          });
        } catch (e) {
          console.error('Error creating offer:', e);
        }
      });
    });

    room.on('rtc_peer_joined', function (msg) {
      if (!inCall || !msg.peer) return;
      // Peer will create offer to us
      updatePeerCount();
    });

    room.on('rtc_offer', async function (msg) {
      if (!inCall || !msg.fromId || !msg.offer) return;
      var pc = createPeerConnection(msg.fromId);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        room.sendMsg({
          type: 'rtc_answer',
          targetId: msg.fromId,
          answer: answer,
        });
      } catch (e) {
        console.error('Error handling offer:', e);
      }
    });

    room.on('rtc_answer', async function (msg) {
      if (!inCall || !msg.fromId || !msg.answer) return;
      var pc = peerConnections.get(msg.fromId);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
        } catch (e) {
          console.error('Error setting remote description:', e);
        }
      }
    });

    room.on('rtc_ice', async function (msg) {
      if (!inCall || !msg.fromId || !msg.candidate) return;
      var pc = peerConnections.get(msg.fromId);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {}
      }
    });

    room.on('rtc_peer_left', function (msg) {
      if (msg.peerId) {
        removeRemoteVideo(msg.peerId);
      }
    });

    room.on('media_state', function (msg) {
      var peerId = msg.peerId;
      var ms = msg.mediaState;
      if (!peerId || !ms) return;
      var ind = document.getElementById('audio-ind-' + peerId);
      if (ind) {
        ind.textContent = ms.audio ? '🎙️' : '🔇';
      }
      var tile = document.getElementById('video-tile-' + peerId);
      if (tile) {
        tile.classList.toggle('video-off', !ms.video);
      }
    });

    return {
      startCall: startCall,
      endCall: endCall,
      inCall: function () { return inCall; },
    };
  }

  global.NexusMeetVideo = {
    initVideo: initVideo,
  };
})(window);
