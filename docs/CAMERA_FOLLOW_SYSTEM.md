# Camera and Follow System

## Overview

The minecraft-web-client features a camera system that separates camera position from bot position, enabling spectator-like viewing capabilities without requiring server permissions.

## Architecture

### Separation of Camera and Bot Position

- **Bot Position** (`bot.entity.position`): The player entity's position on the Minecraft server
- **Spectator Camera Position** (`spectatorCameraPosition`): Independent camera position for free-roam viewing
- **Camera Rotation**: In first-person mode, uses `bot.entity.yaw/pitch`. In free-roam/spectator mode, uses independent spectator direction (`spectatorCameraYaw/Pitch`) decoupled from bot.entity so replay packets cannot overwrite it

This separation allows the camera to move freely through the world while the bot remains at its spawn location, bypassing the need for teleport permissions.

## Camera Modes

### 1. First Person Mode (`firstPerson`)
- Default mode for direct bot control
- Camera follows bot position
- Full keyboard and mouse control enabled
- Used when not following any player

### 2. Third Person Follow Mode (`thirdPerson`)
- Camera positioned behind and above a followed player
- Automatically tracks the target player's movement
- Camera looks in the same direction as the followed player
- Keyboard controls disabled during following

### 3. Birds Eye View Mode (`birdsEye`)
- Dynamic overhead view of all players
- Camera position calculated as center point of all active players
- Height and offset adjust based on player spread
- Provides tactical overview of player positions
- Filters out system entities ("KradleWebViewer", "watcher")

### 4. Free Roam Mode (`freeRoam`)
- Independent spectator camera with WASD + mouse control
- Camera position and direction are fully decoupled from bot.entity
- Entered by clicking the overlay in thirdPerson/birdsEye or via postMessage
- Pointer lock enables mouse-look; WASD moves relative to current view direction

## Spectator Camera Implementation

### Taking Control from Follow/Birds Eye Mode

When clicking to take control of the camera:

1. **Capture Current View**: The system captures the current camera position from either birds eye or follow mode
2. **Set Spectator Position**: Stores this position as `spectatorCameraPosition`
3. **Enable Flying**: Activates flying mode to allow free movement
4. **Initialize View Direction**: Sets `bot.look(yaw, pitch)` to match the captured camera angle
5. **Request Pointer Lock**: Captures mouse for first-person control
6. **Focus Canvas**: Ensures keyboard events are captured in iframe environments

### Movement System

#### WASD Movement
- Movement is calculated fresh each frame based on current camera yaw
- Forward/back/left/right vectors are computed from trigonometric functions of yaw
- This ensures movement is always relative to current view direction
- Movement continues correctly even while rotating with the mouse

#### Implementation Details
```javascript
// Movement calculation in fly loop
if (wasdPressed.forward) {
  movement.add(new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw)))
}
if (wasdPressed.back) {
  movement.add(new Vec3(Math.sin(yaw), 0, Math.cos(yaw)))
}
// Similar for left, right...
```

### Chunk Loading and Entity Rendering

The system updates `worldView.updatePosition()` with the spectator camera position to ensure:
- Chunks load around the camera location
- Entities remain visible as the camera moves
- Proper rendering distance is maintained

## Key Functions

### `handleMovement()`
- Called on bot movement events
- Routes to appropriate camera mode handler
- Handles spectator camera position updates
- Throttled to 60 FPS

### `getBirdsEyeCameraPosition()`
- Calculates center point of all active players
- Dynamically adjusts height based on player spread
- Returns camera position with north-facing yaw
- Caches last valid position as fallback

### `getThirdPersonCameraPosition()`
- Positions camera 5 blocks behind target player
- Elevates camera 2 blocks above player
- Returns position with player's yaw direction

### `setCamera({ mode, target? })`
- Manages transitions between all camera modes
- Handles player entity loading with retry logic for thirdPerson
- Controls `controMax.enabled` state for keyboard input
- Reports camera state to parent via postMessage

### `setSpectatorCameraPosition(pos, yaw?, pitch?)`
- Stores independent camera position and optional direction
- Enables camera movement without bot movement
- Cleared when switching to firstPerson, thirdPerson, or birdsEye modes

### `getSpectatorCameraDirection()`
- Returns spectator yaw/pitch when in free-roam mode
- Returns null when not in spectator mode (falls back to bot.entity direction)

### `updateSpectatorCameraDirection(yaw, pitch)`
- Updates spectator direction from mouse movement in free-roam
- Only updates if spectator position is set (i.e. in free-roam mode)

## Integration Points

### Files and Responsibilities

- **`interactiveControls.ts`**: Core camera modes, position calculations, spectator position/direction management, and postMessage communication
- **`cameraRotationControls.ts`**: Mouse/gamepad camera rotation, spectator direction updates for free-roam
- **`controls.ts`**: WASD input handling, movement calculation, and fly loop implementation
- **`FollowerClickOverlay.tsx`**: UI overlay for taking control, handles click events and mode transitions
- **`CameraStateOverlay.tsx`**: Always-on debug overlay showing camera mode, target, direction, and spectator position

### Event Flow

1. **Mode Selection**: User selects follow/birds eye via UI or events
2. **Position Tracking**: System continuously updates camera to track targets
3. **Take Control**: User clicks overlay or triggers free roam mode
4. **Movement Input**: WASD keys update movement state
5. **Frame Updates**: Fly loop applies movement based on current view direction

## Free Roam Mode

### Activation Methods

1. **Click Overlay**: Click while in follow/birds eye mode
2. **UI Button**: `setCamera({ mode: 'freeRoam' })` via postMessage
3. **Escape Birds Eye**: Release pointer lock reports to parent, stays in current mode

### Movement Mechanics

- **Flying Physics**: `bot.physics.gravity = 0` enables flight
- **Movement Vectors**: Calculated per-frame from camera yaw
- **Speed Control**: Movement scaled by 0.5 for smooth control
- **Continuous Updates**: Camera and chunks update every 50ms

## Canvas Focus Management

The system includes robust focus handling for iframe environments:
- Adds `tabindex="-1"` to canvas element
- Explicitly focuses canvas after mode switches
- Ensures keyboard events are captured properly
- Handles both standalone and iframe deployments