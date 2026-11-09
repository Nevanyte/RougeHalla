using System;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Net
{
    /// <summary>Dedicated sessionStorage slot. Outside the WebGL player it is explicitly unavailable; never a durable fallback.</summary>
    public sealed class WebGlSeatCheckpointStorage : IOwnedSeatCheckpointStorage
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern string RhSeatCheckpoint_Read();
        [DllImport("__Internal")] static extern int RhSeatCheckpoint_Write(string text);
        [DllImport("__Internal")] static extern int RhSeatCheckpoint_Clear(string expected);
#endif
        public SeatCheckpointReadStatus Read(out string canonicalRecord)
        {
            canonicalRecord = null;
#if UNITY_WEBGL && !UNITY_EDITOR
            try
            {
                string framed = RhSeatCheckpoint_Read();
                if (framed == null || framed == "U") return SeatCheckpointReadStatus.Unavailable;
                if (framed == "M") return SeatCheckpointReadStatus.Missing;
                if (framed == "I") return SeatCheckpointReadStatus.Invalid;
                if (framed.Length > OwnedSeatCheckpointStore.MaxRecordChars+2 || !framed.StartsWith("R\n", StringComparison.Ordinal)) return SeatCheckpointReadStatus.Invalid;
                canonicalRecord = framed.Substring(2); return SeatCheckpointReadStatus.Ready;
            }
            catch { return SeatCheckpointReadStatus.Unavailable; }
#else
            return SeatCheckpointReadStatus.Unavailable;
#endif
        }

        public SeatCheckpointWriteStatus Write(string canonicalRecord)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (canonicalRecord == null || canonicalRecord.Length > OwnedSeatCheckpointStore.MaxRecordChars) return SeatCheckpointWriteStatus.Invalid;
            try
            {
                int status = RhSeatCheckpoint_Write(canonicalRecord);
                return status >= 0 && status <= (int)SeatCheckpointWriteStatus.Invalid ? (SeatCheckpointWriteStatus)status : SeatCheckpointWriteStatus.Unsaved;
            }
            catch { return SeatCheckpointWriteStatus.Unsaved; }
#else
            return SeatCheckpointWriteStatus.Unavailable;
#endif
        }

        public SeatCheckpointClearStatus CompareAndClear(string expectedCanonicalRecord)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (expectedCanonicalRecord == null || expectedCanonicalRecord.Length > OwnedSeatCheckpointStore.MaxRecordChars) return SeatCheckpointClearStatus.Invalid;
            try
            {
                int status = RhSeatCheckpoint_Clear(expectedCanonicalRecord);
                return status >= 0 && status <= (int)SeatCheckpointClearStatus.Invalid ? (SeatCheckpointClearStatus)status : SeatCheckpointClearStatus.Unsaved;
            }
            catch { return SeatCheckpointClearStatus.Unsaved; }
#else
            return SeatCheckpointClearStatus.Unavailable;
#endif
        }
    }
}
