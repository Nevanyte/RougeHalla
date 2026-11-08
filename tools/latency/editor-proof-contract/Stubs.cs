using System;
namespace UnityEngine {
 public static class Time { public static int frameCount; public static double realtimeSinceStartupAsDouble; }
 public class Object { public static T[] FindObjectsOfType<T>() where T:class => new T[0]; }
 public struct Vector2 { public float x,y; public Vector2(float x,float y){this.x=x;this.y=y;} }
 public static class JsonUtility { public static string ToJson(object x)=>"{}"; }
}
namespace UnityEditor { public static class EditorApplication { public static bool isPlaying,isPaused; public static double timeSinceStartup; public static event Action update; } }
namespace UnityEngine.InputSystem.LowLevel { }
namespace UnityEngine.InputSystem {
 public class Vector2Control {} public class ButtonControl {}
 public class Mouse { public static Mouse current; public Vector2Control position=new Vector2Control(); public ButtonControl leftButton=new ButtonControl(); }
 public class Keyboard { public static Keyboard current; public ButtonControl rKey=new ButtonControl(); }
 public static class InputSystem {
  public static void QueueDeltaStateEvent(Vector2Control c,UnityEngine.Vector2 v){}
  public static void QueueDeltaStateEvent(ButtonControl c,float v){}
 }
}
namespace Roguehalla.Client {
 public class MatchClient {
  public bool AutoJoin; public string Url,Profile,Token; public int Faction; public Roguehalla.Net.Session Session;
  public void Join(string n,int f){}
 }
}
