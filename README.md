# WebRTC Video Call Application

A real-time peer-to-peer video calling application built with **ASP.NET Core 8**, **SignalR**, and **WebRTC**.

## Features

- ✅ Real-time audio and video calling between two users
- ✅ Peer-to-peer media streaming (no media server required)
- ✅ SignalR-based signaling for WebRTC connection establishment
- ✅ Room-based connection management
- ✅ Camera and microphone toggle during calls
- ✅ Clean, responsive UI
- ✅ Cross-browser compatible (Chrome, Firefox, Edge)

## Technology Stack

### Backend
- **ASP.NET Core 8** - Web framework
- **SignalR** - Real-time signaling hub
- **In-memory room management** - Thread-safe room tracking

### Frontend
- **HTML5** - Semantic structure
- **CSS3** - Modern styling with CSS variables
- **Vanilla JavaScript** - WebRTC API and SignalR client
- **No external frameworks** - Pure, lightweight implementation

## Project Structure

```
VideoCallApp/
├── Hubs/
│   └── VideoCallHub.cs      # SignalR hub for signaling
├── Services/
│   └── RoomManager.cs       # Room management service
├── wwwroot/
│   ├── index.html           # Main HTML page
│   ├── css/
│   │   └── styles.css       # Application styles
│   └── js/
│       └── app.js           # WebRTC and SignalR client logic
└── Program.cs               # Application entry point and configuration
```

## How It Works

### WebRTC Signaling Flow

1. **Join Room**: Both users enter the same room ID and join
2. **Position Assignment**: First user becomes "caller", second becomes "callee"
3. **Call Initiation**: Caller creates WebRTC offer and sends via SignalR
4. **Call Answer**: Callee receives offer, creates answer, sends back via SignalR
5. **ICE Exchange**: Both peers exchange ICE candidates until direct connection established
6. **Media Streaming**: Audio/video streams flow directly between peers (P2P)

### SignalR Messages

| Message | Direction | Description |
|---------|-----------|-------------|
| `JoinRoom` | Client → Server | Join a specific room |
| `JoinedRoom` | Server → Client | Confirmation of room join with position |
| `UserJoined` | Server → Caller | Notify caller that callee joined |
| `InitiateCall` | Client → Server | Caller sends WebRTC offer |
| `ReceiveCall` | Server → Callee | Callee receives incoming call |
| `AnswerCall` | Client → Server | Callee sends WebRTC answer |
| `CallAnswered` | Server → Caller | Caller receives answer |
| `SendIceCandidate` | Client → Server | Send ICE candidate |
| `ReceiveIceCandidate` | Server → Peer | Receive ICE candidate |
| `EndCall` | Client → Server | End the current call |
| `CallEnded` | Server → Peer | Notify call ended |

## Getting Started

### Prerequisites

- .NET 8 SDK
- Modern web browser with WebRTC support (Chrome, Firefox, Edge)
- Camera and microphone

### Running the Application

1. **Navigate to the project directory:**
   ```bash
   cd VideoCallApp
   ```

2. **Run the application:**
   ```bash
   dotnet run
   ```

3. **Open your browser:**
   - Navigate to `https://localhost:7000` (or the URL shown in console)
   - Note: HTTPS is required for WebRTC to work properly

4. **Test the video call:**
   - Open the application in **two browser windows/tabs**
   - Enter the **same room ID** in both windows
   - Click "Join Room" in both windows
   - In the first window (caller), click "Start Call"
   - In the second window (callee), click "Answer"
   - Video call should be established!

### Testing on Different Devices

To test between different devices on the same network:

1. Find your local IP address (e.g., `192.168.1.100`)
2. Run the application with:
   ```bash
   dotnet run --urls="https://0.0.0.0:5001"
   ```
3. Access from other devices using: `https://YOUR_IP:5001`

**Note:** Browsers may require HTTPS for WebRTC. You may need to set up a proper SSL certificate for LAN access.

## Usage Instructions

1. **Enter Room ID**: Type any room name (e.g., "meeting123")
2. **Join Room**: Click "Join Room" button
3. **Share Room ID**: Tell the other person to join the same room
4. **Start Call**: First person clicks "Start Call"
5. **Answer Call**: Second person clicks "Answer"
6. **During Call**: Use camera/mic toggle buttons as needed
7. **End Call**: Either person can click "End Call"

## Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 80+ | ✅ Fully Supported |
| Firefox | 75+ | ✅ Fully Supported |
| Edge | 80+ | ✅ Fully Supported |
| Safari | 14+ | ⚠️ Limited Support |

## Security Considerations

- **No Authentication**: This is a demo application. Add authentication for production use.
- **Room Privacy**: Room IDs are simple strings. Use UUIDs or add authentication for privacy.
- **HTTPS Required**: WebRTC requires secure context (HTTPS) in most browsers.
- **No Media Recording**: The application does not record or store any media.

## ICE Servers

The application uses Google's public STUN servers for NAT traversal:
- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`
- `stun:stun2.l.google.com:19302`
- `stun:stun3.l.google.com:19302`
- `stun:stun4.l.google.com:19302`

For production use behind restrictive firewalls, consider adding TURN servers.

## Troubleshooting

### "Failed to access camera/microphone"
- Ensure you've granted camera/microphone permissions in your browser
- Check that no other application is using the camera
- Try using HTTPS (required for media access)

### "Connection failed" or "No ICE candidates"
- Check your firewall settings
- Ensure STUN servers are accessible
- Try a different network

### "Room is full"
- Each room supports maximum 2 participants
- Use a different room ID

### Video not showing
- Ensure both users have granted camera permissions
- Check that WebRTC is supported in your browser
- Try refreshing both browser windows

## License

This project is provided as-is for educational and demonstration purposes.
