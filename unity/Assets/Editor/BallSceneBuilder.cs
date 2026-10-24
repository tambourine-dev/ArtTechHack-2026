using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;

// Builds the VR test scene: an XR camera rig, a light, and a ball in front of the player.
// Runs once automatically when the scene doesn't exist yet; rebuild via the menu.
[InitializeOnLoad]
public static class BallSceneBuilder
{
    const string ScenePath = "Assets/Scenes/BallTest.unity";
    const string MaterialPath = "Assets/Materials/Ball.mat";

    static BallSceneBuilder()
    {
        EditorApplication.delayCall += () =>
        {
            if (!File.Exists(ScenePath))
                Build();
        };
    }

    [MenuItem("ArtTech/Rebuild Ball Test Scene")]
    public static void Build()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            return;

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        var light = new GameObject("Directional Light").AddComponent<Light>();
        light.type = LightType.Directional;
        light.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

        var rig = new GameObject("XR Rig");
        rig.AddComponent<XRFloorOrigin>();

        var cameraObject = new GameObject("Main Camera") { tag = "MainCamera" };
        cameraObject.transform.SetParent(rig.transform, false);
        // Eye height for flat play mode; the headset pose overrides this when XR is running.
        cameraObject.transform.localPosition = new Vector3(0f, 1.6f, 0f);
        var camera = cameraObject.AddComponent<Camera>();
        camera.nearClipPlane = 0.01f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.05f, 0.05f, 0.08f);
        cameraObject.AddComponent<AudioListener>();

        var poseDriver = cameraObject.AddComponent<TrackedPoseDriver>();
        poseDriver.positionInput = new InputActionProperty(
            new InputAction("Head Position", binding: "<XRHMD>/centerEyePosition", expectedControlType: "Vector3"));
        poseDriver.rotationInput = new InputActionProperty(
            new InputAction("Head Rotation", binding: "<XRHMD>/centerEyeRotation", expectedControlType: "Quaternion"));
        poseDriver.trackingStateInput = new InputActionProperty(
            new InputAction("Head Tracking State", binding: "<XRHMD>/trackingState", expectedControlType: "Integer"));

        var ball = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        ball.name = "Ball";
        ball.transform.position = new Vector3(0f, 1.4f, 1.5f);
        ball.transform.localScale = Vector3.one * 0.3f;
        ball.GetComponent<Renderer>().sharedMaterial = GetOrCreateBallMaterial();

        Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        Debug.Log($"Built {ScenePath}");
    }

    static Material GetOrCreateBallMaterial()
    {
        var material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
        if (material != null)
            return material;

        material = new Material(Shader.Find("Standard")) { color = new Color(1f, 0.45f, 0.1f) };
        Directory.CreateDirectory(Path.GetDirectoryName(MaterialPath));
        AssetDatabase.CreateAsset(material, MaterialPath);
        return material;
    }
}
