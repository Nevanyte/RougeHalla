using Roguehalla.Net;

namespace Roguehalla.Client
{
    public static class TransportFactory
    {
        public static ITransport Create()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return new WebGLTransport();
#else
            return new NativeTransport();
#endif
        }
    }
}
