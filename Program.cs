using VideoCallApp.Hubs;
using VideoCallApp.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorPages();

// Register RoomManager as a singleton for in-memory room storage
builder.Services.AddSingleton<IRoomManager, RoomManager>();

// Add SignalR
builder.Services.AddSignalR();

// Add CORS policy for frontend access
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Configure logging
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Information);

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

// Use CORS before routing
app.UseCors("AllowAll");

app.UseAuthorization();

// Map SignalR hub
app.MapHub<VideoCallHub>("/videocallhub");

app.MapRazorPages();

// Serve index.html for root path
app.MapGet("/", async context =>
{
    context.Response.Redirect("/index.html");
});

app.Run();
