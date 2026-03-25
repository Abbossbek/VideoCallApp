using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using VideoCallApp.Services;

namespace VideoCallApp.Hubs;

/// <summary>
/// SignalR Hub for handling real-time video call signaling between peers.
/// This hub manages room connections and facilitates WebRTC offer/answer/ICE exchange.
/// </summary>
public class VideoCallHub : Hub
{
    private readonly ILogger<VideoCallHub> _logger;
    private readonly IRoomManager _roomManager;

    public VideoCallHub(ILogger<VideoCallHub> logger, IRoomManager roomManager)
    {
        _logger = logger;
        _roomManager = roomManager;
    }

    /// <summary>
    /// Join a video call room by room ID.
    /// </summary>
    /// <param name="roomId">The unique identifier for the room.</param>
    public async Task JoinRoom(string roomId)
    {
        _logger.LogInformation("User {ConnectionId} attempting to join room {RoomId}", Context.ConnectionId, roomId);

        // Add connection to the room group
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);

        // Register the user in the room manager
        var result = await _roomManager.AddUserToRoomAsync(roomId, Context.ConnectionId);

        if (result.Success)
        {
            _logger.LogInformation("User {ConnectionId} joined room {RoomId}. Position: {Position}", 
                Context.ConnectionId, roomId, result.Position);

            // Notify the client about their position (caller or callee)
            await Clients.Caller.SendAsync("JoinedRoom", roomId, result.Position);

            // If this is the second user, notify the first user (caller) that someone joined
            if (result.Position == 2)
            {
                var callerId = _roomManager.GetCallerId(roomId);
                if (!string.IsNullOrEmpty(callerId))
                {
                    await Clients.Client(callerId).SendAsync("UserJoined", Context.ConnectionId);
                    _logger.LogInformation("Notified caller {CallerId} that user {ConnectionId} joined", 
                        callerId, Context.ConnectionId);
                }
            }
            // If there are already 2 users, reject the new user
            else if (result.Position > 2)
            {
                await Clients.Caller.SendAsync("RoomFull");
                await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
                await _roomManager.RemoveUserFromRoomAsync(roomId, Context.ConnectionId);
                _logger.LogWarning("Room {RoomId} is full, rejected user {ConnectionId}", roomId, Context.ConnectionId);
            }
        }
        else
        {
            await Clients.Caller.SendAsync("JoinFailed", result.ErrorMessage);
            _logger.LogWarning("Failed to join room {RoomId}: {Error}", roomId, result.ErrorMessage);
        }
    }

    /// <summary>
    /// Initiate a call by sending a WebRTC offer to the callee.
    /// </summary>
    /// <param name="roomId">The room ID.</param>
    /// <param name="offer">The WebRTC offer SDP.</param>
    public async Task InitiateCall(string roomId, object offer)
    {
        _logger.LogInformation("User {ConnectionId} initiating call in room {RoomId}", Context.ConnectionId, roomId);

        var calleeId = _roomManager.GetCalleeId(roomId);
        if (!string.IsNullOrEmpty(calleeId))
        {
            await Clients.Client(calleeId).SendAsync("ReceiveCall", Context.ConnectionId, offer);
            _logger.LogInformation("Call initiated from {ConnectionId} to {CalleeId}", Context.ConnectionId, calleeId);
        }
        else
        {
            _logger.LogWarning("No callee found in room {RoomId} for call initiation", roomId);
        }
    }

    /// <summary>
    /// Answer an incoming call by sending a WebRTC answer.
    /// </summary>
    /// <param name="roomId">The room ID.</param>
    /// <param name="answer">The WebRTC answer SDP.</param>
    public async Task AnswerCall(string roomId, object answer)
    {
        _logger.LogInformation("User {ConnectionId} answering call in room {RoomId}", Context.ConnectionId, roomId);

        var callerId = _roomManager.GetCallerId(roomId);
        if (!string.IsNullOrEmpty(callerId))
        {
            await Clients.Client(callerId).SendAsync("CallAnswered", Context.ConnectionId, answer);
            _logger.LogInformation("Call answered by {ConnectionId} to caller {CallerId}", Context.ConnectionId, callerId);
        }
        else
        {
            _logger.LogWarning("No caller found in room {RoomId} for call answer", roomId);
        }
    }

    /// <summary>
    /// Send ICE candidate to the other peer.
    /// </summary>
    /// <param name="roomId">The room ID.</param>
    /// <param name="candidate">The ICE candidate data.</param>
    public async Task SendIceCandidate(string roomId, object candidate)
    {
        // Get the other user in the room
        var otherUserId = _roomManager.GetOtherUserId(roomId, Context.ConnectionId);
        
        if (!string.IsNullOrEmpty(otherUserId))
        {
            await Clients.Client(otherUserId).SendAsync("ReceiveIceCandidate", Context.ConnectionId, candidate);
        }
        else
        {
            _logger.LogWarning("No other user found in room {RoomId} for ICE candidate from {ConnectionId}", 
                roomId, Context.ConnectionId);
        }
    }

    /// <summary>
    /// End the current call and notify the other participant.
    /// </summary>
    /// <param name="roomId">The room ID.</param>
    public async Task EndCall(string roomId)
    {
        _logger.LogInformation("User {ConnectionId} ending call in room {RoomId}", Context.ConnectionId, roomId);

        var otherUserId = _roomManager.GetOtherUserId(roomId, Context.ConnectionId);
        if (!string.IsNullOrEmpty(otherUserId))
        {
            await Clients.Client(otherUserId).SendAsync("CallEnded", Context.ConnectionId);
            _logger.LogInformation("Call ended notification sent to {OtherUserId}", otherUserId);
        }

        // Clean up room
        await LeaveRoom(roomId);
    }

    /// <summary>
    /// Leave the current room.
    /// </summary>
    /// <param name="roomId">The room ID.</param>
    public async Task LeaveRoom(string roomId)
    {
        _logger.LogInformation("User {ConnectionId} leaving room {RoomId}", Context.ConnectionId, roomId);

        await _roomManager.RemoveUserFromRoomAsync(roomId, Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        // Notify other user if exists
        var remainingUser = _roomManager.GetRemainingUser(roomId, Context.ConnectionId);
        if (!string.IsNullOrEmpty(remainingUser))
        {
            await Clients.Client(remainingUser).SendAsync("UserLeft", Context.ConnectionId);
            _logger.LogInformation("Notified {RemainingUser} that {ConnectionId} left", remainingUser, Context.ConnectionId);
        }
        else
        {
            // Room is now empty, clean it up
            await _roomManager.RemoveRoomAsync(roomId);
            _logger.LogInformation("Room {RoomId} is now empty and removed", roomId);
        }
    }

    /// <summary>
    /// Handle disconnection - clean up room membership.
    /// </summary>
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("User {ConnectionId} disconnected", Context.ConnectionId);

        // Find and remove from all rooms
        await _roomManager.RemoveUserFromAllRoomsAsync(Context.ConnectionId);

        await base.OnDisconnectedAsync(exception);
    }
}
