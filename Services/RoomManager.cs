using System.Collections.Concurrent;

namespace VideoCallApp.Services;

/// <summary>
/// Represents a video call room with up to 2 participants.
/// </summary>
public class VideoCallRoom
{
    public string RoomId { get; set; } = string.Empty;
    public string? CallerId { get; set; }      // First user to join (initiates call)
    public string? CalleeId { get; set; }      // Second user to join (receives call)
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastActivity { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Get the list of all user IDs in the room.
    /// </summary>
    public List<string> GetUserIds()
    {
        var users = new List<string>();
        if (!string.IsNullOrEmpty(CallerId))
            users.Add(CallerId);
        if (!string.IsNullOrEmpty(CalleeId))
            users.Add(CalleeId);
        return users;
    }

    /// <summary>
    /// Get the count of users in the room.
    /// </summary>
    public int GetUserCount()
    {
        int count = 0;
        if (!string.IsNullOrEmpty(CallerId)) count++;
        if (!string.IsNullOrEmpty(CalleeId)) count++;
        return count;
    }
}

/// <summary>
/// Result of adding a user to a room.
/// </summary>
public class JoinRoomResult
{
    public bool Success { get; set; }
    public int Position { get; set; }  // 1 = caller, 2 = callee, >2 = rejected
    public string? ErrorMessage { get; set; }

    public static JoinRoomResult SuccessResult(int position) => new()
    {
        Success = true,
        Position = position
    };

    public static JoinRoomResult FailureResult(string error) => new()
    {
        Success = false,
        Position = 0,
        ErrorMessage = error
    };
}

/// <summary>
/// Interface for room management operations.
/// </summary>
public interface IRoomManager
{
    Task<JoinRoomResult> AddUserToRoomAsync(string roomId, string connectionId);
    Task RemoveUserFromRoomAsync(string roomId, string connectionId);
    Task RemoveUserFromAllRoomsAsync(string connectionId);
    Task RemoveRoomAsync(string roomId);
    string? GetCallerId(string roomId);
    string? GetCalleeId(string roomId);
    string? GetOtherUserId(string roomId, string currentUserId);
    string? GetRemainingUser(string roomId, string excludedUserId);
    VideoCallRoom? GetRoom(string roomId);
    IEnumerable<VideoCallRoom> GetAllRooms();
}

/// <summary>
/// In-memory room manager for managing video call rooms.
/// Thread-safe implementation using ConcurrentDictionary.
/// </summary>
public class RoomManager : IRoomManager
{
    private readonly ConcurrentDictionary<string, VideoCallRoom> _rooms = new();
    private readonly ConcurrentDictionary<string, string> _userRooms = new();  // Maps connectionId to roomId
    private readonly ILogger<RoomManager> _logger;

    public RoomManager(ILogger<RoomManager> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Add a user to a room. First user becomes caller, second becomes callee.
    /// </summary>
    public Task<JoinRoomResult> AddUserToRoomAsync(string roomId, string connectionId)
    {
        var room = _rooms.GetOrAdd(roomId, _ => new VideoCallRoom { RoomId = roomId });

        // Check if room is full
        if (room.GetUserCount() >= 2)
        {
            return Task.FromResult(JoinRoomResult.FailureResult("Room is full"));
        }

        // Check if user is already in this room
        if (room.CallerId == connectionId || room.CalleeId == connectionId)
        {
            return Task.FromResult(JoinRoomResult.SuccessResult(
                room.CallerId == connectionId ? 1 : 2));
        }

        // Add user to room
        int position;
        if (string.IsNullOrEmpty(room.CallerId))
        {
            room.CallerId = connectionId;
            position = 1;
            _logger.LogInformation("User {ConnectionId} is now caller in room {RoomId}", connectionId, roomId);
        }
        else if (string.IsNullOrEmpty(room.CalleeId))
        {
            room.CalleeId = connectionId;
            position = 2;
            _logger.LogInformation("User {ConnectionId} is now callee in room {RoomId}", connectionId, roomId);
        }
        else
        {
            return Task.FromResult(JoinRoomResult.FailureResult("Room is full"));
        }

        room.LastActivity = DateTime.UtcNow;
        _userRooms[connectionId] = roomId;

        return Task.FromResult(JoinRoomResult.SuccessResult(position));
    }

    /// <summary>
    /// Remove a user from a specific room.
    /// </summary>
    public Task RemoveUserFromRoomAsync(string roomId, string connectionId)
    {
        if (_rooms.TryGetValue(roomId, out var room))
        {
            if (room.CallerId == connectionId)
            {
                room.CallerId = null;
                _logger.LogInformation("Removed caller {ConnectionId} from room {RoomId}", connectionId, roomId);
            }
            else if (room.CalleeId == connectionId)
            {
                room.CalleeId = null;
                _logger.LogInformation("Removed callee {ConnectionId} from room {RoomId}", connectionId, roomId);
            }

            room.LastActivity = DateTime.UtcNow;
        }

        _userRooms.TryRemove(connectionId, out _);
        return Task.CompletedTask;
    }

    /// <summary>
    /// Remove a user from all rooms (used on disconnect).
    /// </summary>
    public Task RemoveUserFromAllRoomsAsync(string connectionId)
    {
        if (_userRooms.TryGetValue(connectionId, out var roomId))
        {
            RemoveUserFromRoomAsync(roomId, connectionId);
        }
        return Task.CompletedTask;
    }

    /// <summary>
    /// Remove an empty room.
    /// </summary>
    public Task RemoveRoomAsync(string roomId)
    {
        _rooms.TryRemove(roomId, out _);
        _logger.LogInformation("Removed room {RoomId}", roomId);
        return Task.CompletedTask;
    }

    /// <summary>
    /// Get the caller's connection ID for a room.
    /// </summary>
    public string? GetCallerId(string roomId)
    {
        return _rooms.TryGetValue(roomId, out var room) ? room.CallerId : null;
    }

    /// <summary>
    /// Get the callee's connection ID for a room.
    /// </summary>
    public string? GetCalleeId(string roomId)
    {
        return _rooms.TryGetValue(roomId, out var room) ? room.CalleeId : null;
    }

    /// <summary>
    /// Get the other user's connection ID in a room.
    /// </summary>
    public string? GetOtherUserId(string roomId, string currentUserId)
    {
        if (!_rooms.TryGetValue(roomId, out var room))
            return null;

        if (room.CallerId == currentUserId)
            return room.CalleeId;
        if (room.CalleeId == currentUserId)
            return room.CallerId;

        return null;
    }

    /// <summary>
    /// Get the remaining user in a room (excluding the specified user).
    /// </summary>
    public string? GetRemainingUser(string roomId, string excludedUserId)
    {
        return GetOtherUserId(roomId, excludedUserId);
    }

    /// <summary>
    /// Get a room by ID.
    /// </summary>
    public VideoCallRoom? GetRoom(string roomId)
    {
        _rooms.TryGetValue(roomId, out var room);
        return room;
    }

    /// <summary>
    /// Get all active rooms.
    /// </summary>
    public IEnumerable<VideoCallRoom> GetAllRooms()
    {
        return _rooms.Values.ToList();
    }
}
