using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the v0.3.5 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.3.6";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.3.6";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.6/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.3.6-Offline-Setup-x64.exe", 1045609L, "673b5aceb45eb7ee11a81e76672cdcedc5c25e5d48bd74d4ed0e405b80fc5888");
        internal static readonly Asset Payload = File("voicesubsep-0.3.6-x64.nsis.7z", 2424861246L, "23e5b10f4be409a15ca68e72c54b7055ab8ecc8763226b0819500be0e4ca5a08");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.3.6-x64.nsis.7z.part001", 1073741824L, "846e3b08fb13f3f3816c6dd829f8bf7b8023395cf3372ddc3710dfb4e910a33a"),
            File("voicesubsep-0.3.6-x64.nsis.7z.part002", 1073741824L, "a49157ab82b3c6cce68d009128c999b7bc93d261091bb9417b72752507f6488e"),
            File("voicesubsep-0.3.6-x64.nsis.7z.part003", 277377598L, "b76a677efba3e5c91f6ee1970c4da2a8a1c227450e2ec37336ac8b7245a52712")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
