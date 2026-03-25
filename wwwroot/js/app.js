/**
 * WebRTC Video Call Application
 * Handles peer-to-peer video calling using WebRTC and SignalR for signaling
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    signalRUrl: '/videocallhub',
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    rtcConfig: {
        iceServers: [],
        iceCandidatePoolSize: 10
    },
    // Set to true to allow calls without camera/microphone (for testing)
    allowCallWithoutMedia: true
};

// ============================================
// Application State
// ============================================
const state = {
    connection: null,
    localStream: null,
    remoteStream: null,
    peerConnection: null,
    roomId: null,
    userPosition: 0,  // 1 = caller, 2 = callee
    isInCall: false,
    isVideoEnabled: true,
    isAudioEnabled: true,
    incomingCallFrom: null
};

// ============================================
// DOM Elements
// ============================================
const elements = {
    roomIdInput: document.getElementById('roomId'),
    joinRoomBtn: document.getElementById('joinRoomBtn'),
    leaveRoomBtn: document.getElementById('leaveRoomBtn'),
    startCallBtn: document.getElementById('startCallBtn'),
    answerCallBtn: document.getElementById('answerCallBtn'),
    endCallBtn: document.getElementById('endCallBtn'),
    toggleVideoBtn: document.getElementById('toggleVideoBtn'),
    toggleAudioBtn: document.getElementById('toggleAudioBtn'),
    localVideo: document.getElementById('localVideo'),
    remoteVideo: document.getElementById('remoteVideo'),
    connectionStatus: document.getElementById('connectionStatus'),
    callStatus: document.getElementById('callStatus'),
    testModeIndicator: document.getElementById('testModeIndicator')
};

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initializeRTCConfig();
    setupEventListeners();
    updateUI();
});

/**
 * Initialize RTC configuration with ICE servers
 */
function initializeRTCConfig() {
    CONFIG.rtcConfig.iceServers = CONFIG.iceServers;
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
    elements.joinRoomBtn.addEventListener('click', joinRoom);
    elements.leaveRoomBtn.addEventListener('click', leaveRoom);
    elements.startCallBtn.addEventListener('click', startCall);
    elements.answerCallBtn.addEventListener('click', answerCall);
    elements.endCallBtn.addEventListener('click', endCall);
    elements.toggleVideoBtn.addEventListener('click', toggleVideo);
    elements.toggleAudioBtn.addEventListener('click', toggleAudio);
    
    // Allow Enter key to join room
    elements.roomIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            joinRoom();
        }
    });
}

// ============================================
// SignalR Connection
// ============================================

/**
 * Establish SignalR connection
 */
async function connectToSignalR() {
    try {
        state.connection = new signalR.HubConnectionBuilder()
            .withUrl(CONFIG.signalRUrl, {
                transport: signalR.HttpTransportType.WebSockets | 
                          signalR.HttpTransportType.LongPolling
            })
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
            .configureLogging(signalR.LogLevel.Information)
            .build();

        // Set up event handlers
        setupSignalREventHandlers();

        // Start connection
        await state.connection.start();
        console.log('SignalR connected');
        updateConnectionStatus('connected');
        
        return true;
    } catch (error) {
        console.error('SignalR connection failed:', error);
        updateConnectionStatus('disconnected');
        setCallStatus('Failed to connect to server. Please refresh and try again.');
        return false;
    }
}

/**
 * Set up SignalR event handlers
 */
function setupSignalREventHandlers() {
    // Joined a room successfully
    state.connection.on('JoinedRoom', (roomId, position) => {
        console.log('Joined room:', roomId, 'Position:', position);
        state.roomId = roomId;
        state.userPosition = position;
        setCallStatus(position === 1 ? 
            'You are the caller. Waiting for another user to join...' : 
            'You are the callee. Waiting for incoming call...');
        updateUI();
    });

    // Another user joined the room
    state.connection.on('UserJoined', (userId) => {
        console.log('User joined:', userId);
        if (state.userPosition === 1) {
            setCallStatus('Another user has joined. Click "Start Call" to begin.');
            elements.startCallBtn.disabled = false;
        }
    });

    // Room is full
    state.connection.on('RoomFull', () => {
        console.log('Room is full');
        setCallStatus('This room is already full. Please try a different room ID.');
        showError('Room is full. Please try a different room ID.');
    });

    // Failed to join room
    state.connection.on('JoinFailed', (error) => {
        console.error('Join failed:', error);
        setCallStatus('Failed to join room: ' + error);
        showError(error);
    });

    // Received an incoming call
    state.connection.on('ReceiveCall', (callerId, offer) => {
        console.log('Incoming call from:', callerId);
        state.incomingCallFrom = callerId;
        setCallStatus('📞 Incoming call! Click "Answer" to accept.');
        elements.answerCallBtn.style.display = 'inline-flex';
        elements.answerCallBtn.disabled = false;
        elements.answerCallBtn.classList.add('incoming-call');
        
        // Store the offer for when user answers
        state.pendingOffer = offer;
    });

    // Call was answered
    state.connection.on('CallAnswered', (calleeId, answer) => {
        console.log('Call answered by:', calleeId);
        setCallStatus('Call connected! 🎉');
        handleRemoteAnswer(answer);
    });

    // Received ICE candidate
    state.connection.on('ReceiveIceCandidate', (senderId, candidate) => {
        console.log('Received ICE candidate from:', senderId);
        handleRemoteIceCandidate(candidate);
    });

    // Call ended by other party
    state.connection.on('CallEnded', (senderId) => {
        console.log('Call ended by:', senderId);
        setCallStatus('Call ended by the other party.');
        endCallLocal();
    });

    // User left the room
    state.connection.on('UserLeft', (userId) => {
        console.log('User left:', userId);
        setCallStatus('The other user has left the room.');
        endCallLocal();
    });

    // Connection closed
    state.connection.onclose(() => {
        console.log('SignalR connection closed');
        updateConnectionStatus('disconnected');
        setCallStatus('Disconnected from server. Please refresh to reconnect.');
    });

    // Reconnection starting
    state.connection.onreconnecting((error) => {
        console.log('Reconnecting...', error);
        setCallStatus('Reconnecting to server...');
    });

    // Reconnected successfully
    state.connection.onreconnected((connectionId) => {
        console.log('Reconnected:', connectionId);
        updateConnectionStatus('connected');
        setCallStatus('Reconnected to server.');
    });
}

// ============================================
// Room Management
// ============================================

/**
 * Join a video call room
 */
async function joinRoom() {
    const roomId = elements.roomIdInput.value.trim();
    
    if (!roomId) {
        showError('Please enter a room ID');
        return;
    }

    // Connect to SignalR if not already connected
    if (!state.connection || state.connection.state !== signalR.HubConnectionState.Connected) {
        const connected = await connectToSignalR();
        if (!connected) return;
    }

    try {
        // Get local media stream (optional - continue even if failed)
        try {
            await getLocalStream();
        } catch (mediaError) {
            console.warn('Media access failed, continuing without camera/mic:', mediaError);
            setCallStatus('Joined room without camera/microphone. You can try again later.');
            showSuccess('Joined room. No camera/microphone found - you can still receive calls.');
        }
        
        // Join the room
        await state.connection.invoke('JoinRoom', roomId);
        setCallStatus('Joining room...');
        
        elements.joinRoomBtn.disabled = true;
        elements.roomIdInput.disabled = true;
        elements.leaveRoomBtn.disabled = false;
    } catch (error) {
        console.error('Error joining room:', error);
        showError('Failed to join room: ' + error.message);
    }
}

/**
 * Leave the current room
 */
async function leaveRoom() {
    if (!state.connection || !state.roomId) return;

    try {
        await state.connection.invoke('LeaveRoom', state.roomId);
    } catch (error) {
        console.error('Error leaving room:', error);
    }

    // Clean up local state
    state.roomId = null;
    state.userPosition = 0;
    elements.joinRoomBtn.disabled = false;
    elements.roomIdInput.disabled = false;
    elements.leaveRoomBtn.disabled = true;
    elements.startCallBtn.disabled = true;
    elements.answerCallBtn.style.display = 'none';
    setCallStatus('Left the room. Enter a room ID to join again.');
}

// ============================================
// WebRTC Peer Connection
// ============================================

/**
 * Create and configure RTCPeerConnection
 */
function createPeerConnection() {
    state.peerConnection = new RTCPeerConnection(CONFIG.rtcConfig);

    // Add local stream tracks to peer connection
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => {
            state.peerConnection.addTrack(track, state.localStream);
        });
    }

    // Handle incoming remote tracks
    state.peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        if (event.streams && event.streams[0]) {
            state.remoteStream = event.streams[0];
            elements.remoteVideo.srcObject = state.remoteStream;
        }
    };

    // Handle ICE candidates
    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Generated ICE candidate');
            sendIceCandidate(event.candidate);
        } else {
            console.log('All ICE candidates have been generated');
        }
    };

    // Handle connection state changes
    state.peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', state.peerConnection.connectionState);
        
        switch (state.peerConnection.connectionState) {
            case 'connected':
                state.isInCall = true;
                setCallStatus('Connected! 🎉');
                updateConnectionStatus('in-call');
                updateUI();
                break;
            case 'disconnected':
            case 'failed':
            case 'closed':
                setCallStatus('Connection lost.');
                endCallLocal();
                break;
            case 'connecting':
                setCallStatus('Connecting...');
                break;
            case 'new':
                setCallStatus('Initializing connection...');
                break;
        }
    };

    // Handle ICE connection state changes
    state.peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE state:', state.peerConnection.iceConnectionState);
    };

    return state.peerConnection;
}

/**
 * Send ICE candidate to remote peer via SignalR
 */
async function sendIceCandidate(candidate) {
    if (!state.connection || !state.roomId) return;
    
    try {
        await state.connection.invoke('SendIceCandidate', state.roomId, candidate);
    } catch (error) {
        console.error('Error sending ICE candidate:', error);
    }
}

/**
 * Handle received ICE candidate from remote peer
 */
async function handleRemoteIceCandidate(candidate) {
    if (!state.peerConnection) return;
    
    try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added remote ICE candidate');
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

// ============================================
// Call Management
// ============================================

/**
 * Start a call (caller side)
 */
async function startCall() {
    // Try to get media if not already acquired
    if (!state.localStream) {
        try {
            setCallStatus('Requesting camera/microphone access...');
            await getLocalStream();
            elements.toggleVideoBtn.disabled = false;
            elements.toggleAudioBtn.disabled = false;
            hideTestModeIndicator();
        } catch (error) {
            console.warn('Media access failed:', error);
            if (CONFIG.allowCallWithoutMedia) {
                setCallStatus('Starting call without camera/microphone (test mode)');
                showTestModeIndicator();
                showSuccess('Call started without media. You can still see the other person if they have a camera.');
            } else {
                showError('Cannot start call without camera/microphone: ' + error.message);
                setCallStatus('Please allow camera/microphone access and try again.');
                return;
            }
        }
    }

    if (!state.peerConnection) {
        createPeerConnection();
    }

    try {
        setCallStatus('Creating offer...');
        
        // Create offer
        const offer = await state.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        
        await state.peerConnection.setLocalDescription(offer);
        console.log('Created and set local offer');

        // Wait for ICE gathering to complete (optional but recommended)
        await waitForIceGathering();

        // Send offer to callee via SignalR
        await state.connection.invoke('InitiateCall', state.roomId, state.peerConnection.localDescription);
        setCallStatus('Calling...');
        
        elements.startCallBtn.disabled = true;
    } catch (error) {
        console.error('Error starting call:', error);
        showError('Failed to start call: ' + error.message);
    }
}

/**
 * Answer an incoming call (callee side)
 */
async function answerCall() {
    if (!state.pendingOffer) {
        showError('No incoming call to answer');
        return;
    }

    // Try to get media if not already acquired
    if (!state.localStream) {
        try {
            setCallStatus('Requesting camera/microphone access...');
            await getLocalStream();
            elements.toggleVideoBtn.disabled = false;
            elements.toggleAudioBtn.disabled = false;
            hideTestModeIndicator();
        } catch (error) {
            console.warn('Media access failed:', error);
            if (CONFIG.allowCallWithoutMedia) {
                setCallStatus('Answering call without camera/microphone (test mode)');
                showTestModeIndicator();
                showSuccess('Call answered without media. You can still see the other person if they have a camera.');
            } else {
                showError('Cannot answer call without camera/microphone: ' + error.message);
                setCallStatus('Please allow camera/microphone access and try again.');
                return;
            }
        }
    }

    if (!state.peerConnection) {
        createPeerConnection();
    }

    try {
        setCallStatus('Answering call...');

        // Set remote description (offer)
        await state.peerConnection.setRemoteDescription(
            new RTCSessionDescription(state.pendingOffer)
        );

        // Create answer
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        console.log('Created and set local answer');

        // Wait for ICE gathering to complete
        await waitForIceGathering();

        // Send answer to caller via SignalR
        await state.connection.invoke('AnswerCall', state.roomId, state.peerConnection.localDescription);
        setCallStatus('Connected! 🎉');

        elements.answerCallBtn.style.display = 'none';
        elements.answerCallBtn.disabled = true;
        elements.answerCallBtn.classList.remove('incoming-call');
        state.pendingOffer = null;
    } catch (error) {
        console.error('Error answering call:', error);
        showError('Failed to answer call: ' + error.message);
    }
}

/**
 * Handle remote answer (caller side)
 */
async function handleRemoteAnswer(answer) {
    if (!state.peerConnection) return;

    try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Set remote answer');
    } catch (error) {
        console.error('Error handling remote answer:', error);
    }
}

/**
 * End the current call
 */
async function endCall() {
    if (!state.connection || !state.roomId) return;

    try {
        await state.connection.invoke('EndCall', state.roomId);
    } catch (error) {
        console.error('Error ending call:', error);
    }

    endCallLocal();
}

/**
 * Local cleanup when call ends
 */
function endCallLocal() {
    state.isInCall = false;
    state.incomingCallFrom = null;
    state.pendingOffer = null;

    // Close peer connection
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }

    // Clear remote video
    elements.remoteVideo.srcObject = null;
    state.remoteStream = null;

    // Reset UI
    elements.startCallBtn.disabled = false;
    elements.answerCallBtn.style.display = 'none';
    elements.answerCallBtn.disabled = true;
    elements.answerCallBtn.classList.remove('incoming-call');

    hideTestModeIndicator();
    setCallStatus('Call ended. You can start a new call or leave the room.');
    updateConnectionStatus('connected');
    updateUI();
}

// ============================================
// Media Stream Management
// ============================================

/**
 * Get local media stream (camera and microphone)
 */
async function getLocalStream() {
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        elements.localVideo.srcObject = state.localStream;
        console.log('Local stream acquired');
        return state.localStream;
    } catch (error) {
        console.error('Error getting local stream:', error);
        
        let errorMessage = 'Failed to access camera/microphone. ';
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage += 'Please allow camera and microphone permissions.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No camera or microphone found.';
        } else if (error.name === 'NotReadableError') {
            errorMessage += 'Camera or microphone is in use by another application.';
        }
        
        showError(errorMessage);
        throw error;
    }
}

/**
 * Toggle video track on/off or request media if not yet acquired
 */
async function toggleVideo() {
    // If no local stream, try to get one
    if (!state.localStream) {
        try {
            await getLocalStream();
            state.isVideoEnabled = true;
            elements.toggleVideoBtn.disabled = false;
            elements.toggleAudioBtn.disabled = false;
            return;
        } catch (error) {
            console.error('Failed to get media stream:', error);
            showError('Could not access camera: ' + error.message);
            return;
        }
    }

    const videoTrack = state.localStream.getVideoTracks()[0];
    if (videoTrack) {
        state.isVideoEnabled = !state.isVideoEnabled;
        videoTrack.enabled = state.isVideoEnabled;
        
        elements.toggleVideoBtn.innerHTML = `
            <span class="btn-icon">${state.isVideoEnabled ? '📷' : '📷❌'}</span>
            <span class="btn-text">${state.isVideoEnabled ? 'Camera On' : 'Camera Off'}</span>
        `;
        
        console.log('Video toggled:', state.isVideoEnabled ? 'on' : 'off');
    }
}

/**
 * Toggle audio track on/off or request media if not yet acquired
 */
async function toggleAudio() {
    // If no local stream, try to get one
    if (!state.localStream) {
        try {
            await getLocalStream();
            state.isAudioEnabled = true;
            state.isVideoEnabled = true;
            elements.toggleVideoBtn.disabled = false;
            elements.toggleAudioBtn.disabled = false;
            return;
        } catch (error) {
            console.error('Failed to get media stream:', error);
            showError('Could not access microphone: ' + error.message);
            return;
        }
    }

    const audioTrack = state.localStream.getAudioTracks()[0];
    if (audioTrack) {
        state.isAudioEnabled = !state.isAudioEnabled;
        audioTrack.enabled = state.isAudioEnabled;
        
        elements.toggleAudioBtn.innerHTML = `
            <span class="btn-icon">${state.isAudioEnabled ? '🎤' : '🎤❌'}</span>
            <span class="btn-text">${state.isAudioEnabled ? 'Mic On' : 'Mic Off'}</span>
        `;
        
        console.log('Audio toggled:', state.isAudioEnabled ? 'on' : 'off');
    }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Wait for ICE gathering to complete
 */
function waitForIceGathering() {
    return new Promise((resolve) => {
        if (state.peerConnection.iceGatheringState === 'complete') {
            resolve();
        } else {
            const checkState = () => {
                if (state.peerConnection.iceGatheringState === 'complete') {
                    state.peerConnection.removeEventListener('icegatheringstatechange', checkState);
                    resolve();
                }
            };
            state.peerConnection.addEventListener('icegatheringstatechange', checkState);
            
            // Timeout after 2 seconds as a fallback
            setTimeout(resolve, 2000);
        }
    });
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status) {
    elements.connectionStatus.className = 'status';
    
    switch (status) {
        case 'connected':
            elements.connectionStatus.classList.add('status-connected');
            elements.connectionStatus.innerHTML = `
                <span class="status-indicator"></span>
                <span class="status-text">Connected</span>
            `;
            break;
        case 'in-call':
            elements.connectionStatus.classList.add('status-in-call');
            elements.connectionStatus.innerHTML = `
                <span class="status-indicator"></span>
                <span class="status-text">In Call</span>
            `;
            break;
        default:
            elements.connectionStatus.classList.add('status-disconnected');
            elements.connectionStatus.innerHTML = `
                <span class="status-indicator"></span>
                <span class="status-text">Disconnected</span>
            `;
    }
}

/**
 * Update call status message
 */
function setCallStatus(message) {
    elements.callStatus.innerHTML = `
        <span class="call-status-text">${message}</span>
    `;
}

/**
 * Update UI based on current state
 */
function updateUI() {
    // Media controls are always enabled after joining room (they'll request media on click)
    // Only disable if we're not in a room at all
    const isInRoom = !!state.roomId;
    elements.toggleVideoBtn.disabled = !isInRoom;
    elements.toggleAudioBtn.disabled = !isInRoom;
    
    // Enable/disable end call button
    elements.endCallBtn.disabled = !state.isInCall && !state.incomingCallFrom;
    
    // Show/hide answer button
    if (state.incomingCallFrom && !state.isInCall) {
        elements.answerCallBtn.style.display = 'inline-flex';
        elements.answerCallBtn.disabled = false;
    } else {
        elements.answerCallBtn.style.display = 'none';
    }
}

/**
 * Show test mode indicator
 */
function showTestModeIndicator() {
    if (elements.testModeIndicator) {
        elements.testModeIndicator.style.display = 'block';
    }
}

/**
 * Hide test mode indicator
 */
function hideTestModeIndicator() {
    if (elements.testModeIndicator) {
        elements.testModeIndicator.style.display = 'none';
    }
}

/**
 * Show error message
 */
function showError(message) {
    console.error(message);
    
    // Remove existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Create error element
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.textContent = message;
    
    // Insert after connection section
    const connectionSection = document.querySelector('.connection-section');
    connectionSection.parentNode.insertBefore(errorEl, connectionSection.nextSibling);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        errorEl.remove();
    }, 5000);
}

/**
 * Show success message
 */
function showSuccess(message) {
    // Remove existing success messages
    const existingSuccess = document.querySelector('.success-message');
    if (existingSuccess) {
        existingSuccess.remove();
    }
    
    // Create success element
    const successEl = document.createElement('div');
    successEl.className = 'success-message';
    successEl.textContent = message;
    
    // Insert after connection section
    const connectionSection = document.querySelector('.connection-section');
    connectionSection.parentNode.insertBefore(successEl, connectionSection.nextSibling);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        successEl.remove();
    }, 3000);
}

// ============================================
// Browser Compatibility Check
// ============================================

/**
 * Check for WebRTC support
 */
function checkWebRTCSupport() {
    const supports = {
        getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        RTCPeerConnection: !!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection),
        RTCSessionDescription: !!(window.RTCSessionDescription || window.webkitRTCSessionDescription || window.mozRTCSessionDescription),
        RTCIceCandidate: !!(window.RTCIceCandidate || window.webkitRTCIceCandidate || window.mozRTCIceCandidate)
    };

    const allSupported = Object.values(supports).every(v => v);
    
    if (!allSupported) {
        const unsupported = Object.entries(supports)
            .filter(([_, v]) => !v)
            .map(([k]) => k)
            .join(', ');
        
        showError(`Your browser does not fully support WebRTC. Missing: ${unsupported}`);
    }

    return allSupported;
}

// Run compatibility check on load
checkWebRTCSupport();
