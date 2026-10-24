using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

// Asks the XR runtime for floor-level tracking so the camera height matches
// the player's real head height and y = 0 is the physical floor.
public class XRFloorOrigin : MonoBehaviour
{
    static readonly List<XRInputSubsystem> subsystems = new();

    void Update()
    {
        SubsystemManager.GetSubsystems(subsystems);
        foreach (var subsystem in subsystems)
        {
            if (subsystem.running && subsystem.TrySetTrackingOriginMode(TrackingOriginModeFlags.Floor))
            {
                enabled = false;
                return;
            }
        }
    }
}
