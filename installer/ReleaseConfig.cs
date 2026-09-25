using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the original v0.2.0 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.2.0";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.2.0";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.2.0/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.2.0-Offline-Setup-x64.exe", 1045697L, "968b59fe10ffe01192bf3b430d05bd886f9fe22ea5f62688de640d0e2f53baf2");
        internal static readonly Asset Payload = File("voicesubsep-0.2.0-x64.nsis.7z", 2416033719L, "ba00ff488bb8e5d70cb4b6dd05240ee471938440bd824b77a8fd518189b3e56f");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.2.0-x64.nsis.7z.part001", 1073741824L, "9945b6b17c9b1052a964eb92e02a36dc4c9691aa0837a2c724bd8c829faaf7c5"),
            File("voicesubsep-0.2.0-x64.nsis.7z.part002", 1073741824L, "7afd116dd546e3ae575d8989c156c1824fbe3bca5987ee2a4e8d86b45152b052"),
            File("voicesubsep-0.2.0-x64.nsis.7z.part003", 268550071L, "d36637b1292f50a1cb380023ec6a8a9f9169773c58ea0ed4b0a22de9d4cc392d")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
