// External-only Unity script-eval template. The generator appends one Execute(...) call.
// Do not place in Assets; do not run until Root approves the final freeze and lease window.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using UnityEditor;
using UnityEngine;

public static class Resume98PrefsLease
{
    const int SchemaVersion = 1;
    const int SnapshotMode = 0x180; // POSIX 0600; the parent directory is required to be 0700.
    static readonly byte[] Magic = { 0x52, 0x48, 0x39, 0x38, 0x50, 0x52, 0x45, 0x46 }; // RH98PREF
    const string ProfileKey = "rh.ui.profile";
    const string TextScaleKey = "roguehalla.showcase.textScale";
    const string MinimapScaleKey = "rh.ui.minimapScale";

    enum ValueKind : byte { String = 1, Float = 2, Int = 3 }

    sealed class Value
    {
        public string Key;
        public ValueKind Kind;
        public bool Present;
        public string StringValue;
        public float FloatValue;
        public int IntValue;
    }

    sealed class Fault
    {
        public string Key;
        public string Step;
        public string Type;
    }

    [DllImport("libc", EntryPoint = "chmod", SetLastError = true)]
    static extern int Chmod(string path, uint mode);

    // Arguments are generated at invocation time and are all mandatory. No credentials or
    // preference values are arguments, returned, logged, hashed, or included in errors.
    public static string Execute(string operation, string expectedProjectRoot, int expectedPid,
        string expectedUnityVersion, string expectedEditorApp, string expectedEditorExecutable,
        string snapshotPath)
    {
        string stop = Guard(expectedProjectRoot, expectedPid, expectedUnityVersion,
            expectedEditorApp, expectedEditorExecutable, snapshotPath);
        if (stop != null) return "STOP_GUARD:" + stop;
        if (operation == "capture") return Capture(snapshotPath);
        if (operation == "restore") return Restore(snapshotPath);
        return "STOP_ARGUMENT:operation";
    }

    static string Guard(string projectRoot, int expectedPid, string unityVersion,
        string expectedEditorApp, string expectedEditorExecutable, string snapshotPath)
    {
        if (!Application.isEditor) return "not-editor";
        if (expectedPid <= 1 || Process.GetCurrentProcess().Id != expectedPid) return "pid";
        if (!string.Equals(Application.unityVersion, unityVersion, StringComparison.Ordinal)) return "unity-version";

        string expectedRoot, actualRoot, actualApp, expectedApp, expectedExe, snapshot, privateDir;
        try
        {
            expectedRoot = Path.GetFullPath(projectRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            actualRoot = Directory.GetParent(Path.GetFullPath(Application.dataPath)).FullName
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            actualApp = Path.GetFullPath(EditorApplication.applicationPath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            expectedApp = Path.GetFullPath(expectedEditorApp)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            expectedExe = Path.GetFullPath(expectedEditorExecutable)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            snapshot = Path.GetFullPath(snapshotPath);
            privateDir = Path.GetDirectoryName(snapshot);
        }
        catch { return "path-resolution"; }

        if (!string.Equals(actualRoot, expectedRoot, StringComparison.Ordinal)) return "project-path";
        // Unity documents applicationPath as the Editor application path. On macOS installations
        // it may be reported as either the .app bundle or its executable; accept only these two
        // explicit paths supplied from the frozen Editor install, never a substring match.
        if (!string.Equals(actualApp, expectedApp, StringComparison.Ordinal) &&
            !string.Equals(actualApp, expectedExe, StringComparison.Ordinal)) return "editor-path";
        if (!Path.IsPathRooted(snapshotPath) ||
            !string.Equals(Path.GetDirectoryName(snapshot), Path.GetFullPath(privateDir), StringComparison.Ordinal))
            return "snapshot-path";
        return null;
    }

    static string Capture(string snapshotPath)
    {
        byte[] bytes;
        try { bytes = Encode(CaptureValues()); }
        catch (Exception e) { return "CAPTURE_FAIL;step=read;type=" + e.GetType().Name; }

        try
        {
            // CreateNew is deliberate: a retry cannot replace an earlier snapshot.
            using (var stream = new FileStream(snapshotPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                if (Chmod(snapshotPath, SnapshotMode) != 0)
                    return "CAPTURE_FAIL;step=private-mode;type=IOException";
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush();
            }
            return "CAPTURE_OK;keys=3";
        }
        catch (Exception e) { return "CAPTURE_FAIL;step=create-write;type=" + e.GetType().Name; }
    }

    static Value[] CaptureValues()
    {
        var result = new[]
        {
            new Value { Key = ProfileKey, Kind = ValueKind.String },
            new Value { Key = TextScaleKey, Kind = ValueKind.Float },
            new Value { Key = MinimapScaleKey, Kind = ValueKind.Int },
        };
        foreach (var value in result)
        {
            value.Present = PlayerPrefs.HasKey(value.Key);
            if (!value.Present) continue;
            switch (value.Kind)
            {
                case ValueKind.String: value.StringValue = PlayerPrefs.GetString(value.Key); break;
                case ValueKind.Float: value.FloatValue = PlayerPrefs.GetFloat(value.Key); break;
                case ValueKind.Int: value.IntValue = PlayerPrefs.GetInt(value.Key); break;
            }
        }
        return result;
    }

    static byte[] Encode(Value[] values)
    {
        using (var memory = new MemoryStream())
        using (var writer = new BinaryWriter(memory))
        {
            writer.Write(Magic);
            writer.Write(SchemaVersion);
            writer.Write(values.Length);
            foreach (var value in values)
            {
                writer.Write(value.Key);
                writer.Write((byte)value.Kind);
                writer.Write(value.Present);
                if (!value.Present) continue;
                switch (value.Kind)
                {
                    case ValueKind.String: writer.Write(value.StringValue ?? string.Empty); break;
                    case ValueKind.Float: writer.Write(value.FloatValue); break;
                    case ValueKind.Int: writer.Write(value.IntValue); break;
                    default: throw new InvalidDataException();
                }
            }
            writer.Flush();
            return memory.ToArray();
        }
    }

    static string Restore(string snapshotPath)
    {
        Value[] values;
        try { values = Decode(File.ReadAllBytes(snapshotPath)); }
        catch (Exception e) { return "RESTORE_STOP;step=read-snapshot;type=" + e.GetType().Name + ";snapshotRetained=true"; }

        var faults = new List<Fault>();
        foreach (var value in values)
        {
            try
            {
                if (!value.Present) PlayerPrefs.DeleteKey(value.Key);
                else
                {
                    switch (value.Kind)
                    {
                        case ValueKind.String: PlayerPrefs.SetString(value.Key, value.StringValue); break;
                        case ValueKind.Float: PlayerPrefs.SetFloat(value.Key, value.FloatValue); break;
                        case ValueKind.Int: PlayerPrefs.SetInt(value.Key, value.IntValue); break;
                    }
                }
            }
            catch (Exception e) { AddFault(faults, value.Key, value.Present ? "set" : "delete", e); }

            try { PlayerPrefs.Save(); }
            catch (Exception e) { AddFault(faults, value.Key, "save", e); }

            try
            {
                bool present = PlayerPrefs.HasKey(value.Key);
                if (present != value.Present) AddFault(faults, value.Key, "verify-presence", null);
                else if (present && !SameTypedValue(value)) AddFault(faults, value.Key, "verify-value", null);
            }
            catch (Exception e) { AddFault(faults, value.Key, "verify-read", e); }
        }

        if (faults.Count != 0) return FormatFaults(faults, true);
        try
        {
            File.Delete(snapshotPath); // only after all three keys saved and independently verified
            if (File.Exists(snapshotPath)) return "RESTORE_FAIL;step=delete-snapshot;type=IOException;snapshotRetained=true";
            return "RESTORE_OK;keys=3;verified=3;snapshotDeleted=true";
        }
        catch (Exception e) { return "RESTORE_FAIL;step=delete-snapshot;type=" + e.GetType().Name + ";snapshotRetained=true"; }
    }

    static bool SameTypedValue(Value value)
    {
        switch (value.Kind)
        {
            case ValueKind.String: return string.Equals(PlayerPrefs.GetString(value.Key), value.StringValue, StringComparison.Ordinal);
            case ValueKind.Int: return PlayerPrefs.GetInt(value.Key) == value.IntValue;
            case ValueKind.Float:
                return BitConverter.ToInt32(BitConverter.GetBytes(PlayerPrefs.GetFloat(value.Key)), 0) ==
                       BitConverter.ToInt32(BitConverter.GetBytes(value.FloatValue), 0);
            default: return false;
        }
    }

    static Value[] Decode(byte[] bytes)
    {
        using (var memory = new MemoryStream(bytes, false))
        using (var reader = new BinaryReader(memory))
        {
            var magic = reader.ReadBytes(Magic.Length);
            if (magic.Length != Magic.Length) throw new InvalidDataException();
            for (int i = 0; i < Magic.Length; i++) if (magic[i] != Magic[i]) throw new InvalidDataException();
            if (reader.ReadInt32() != SchemaVersion || reader.ReadInt32() != 3) throw new InvalidDataException();
            var expected = new[]
            {
                new Value { Key = ProfileKey, Kind = ValueKind.String },
                new Value { Key = TextScaleKey, Kind = ValueKind.Float },
                new Value { Key = MinimapScaleKey, Kind = ValueKind.Int },
            };
            foreach (var value in expected)
            {
                if (!string.Equals(reader.ReadString(), value.Key, StringComparison.Ordinal) || reader.ReadByte() != (byte)value.Kind)
                    throw new InvalidDataException();
                value.Present = reader.ReadBoolean();
                if (!value.Present) continue;
                switch (value.Kind)
                {
                    case ValueKind.String: value.StringValue = reader.ReadString(); break;
                    case ValueKind.Float: value.FloatValue = reader.ReadSingle(); break;
                    case ValueKind.Int: value.IntValue = reader.ReadInt32(); break;
                }
            }
            if (memory.Position != memory.Length) throw new InvalidDataException();
            return expected;
        }
    }

    static void AddFault(List<Fault> faults, string key, string step, Exception error)
    {
        faults.Add(new Fault { Key = key, Step = step, Type = error == null ? "Mismatch" : error.GetType().Name });
    }

    static string FormatFaults(List<Fault> faults, bool retained)
    {
        // Only fixed key names, step codes and exception type names leave this helper.
        var parts = new List<string>();
        foreach (var fault in faults) parts.Add(fault.Key + ":" + fault.Step + ":" + fault.Type);
        return "RESTORE_PARTIAL;faults=" + faults.Count + ";details=" + string.Join(",", parts) +
               ";snapshotRetained=" + (retained ? "true" : "false");
    }
}
