using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the v0.3.5 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.3.5";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.3.5";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.5/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.3.5-Offline-Setup-x64.exe", 1045611L, "08cff0b0edf94dbd988e0439351b8ff4698512bf0797fa6bd44131fd6f54c7f6");
        internal static readonly Asset Payload = File("voicesubsep-0.3.5-x64.nsis.7z", 2394676208L, "9cea2680dc1566b83124d42f3c9d8b8e71e8923426e89b76edf6714b82c103ba");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.3.5-x64.nsis.7z.part001", 1073741824L, "841176b3a4881c5a72dfbf1b6a2a1306389220a1d7095deb7049cca2d20726e0"),
            File("voicesubsep-0.3.5-x64.nsis.7z.part002", 1073741824L, "c781ffa76b211d9e4468a73616148dd7418a4dd826fc8685ff0b6c536b0e746b"),
            File("voicesubsep-0.3.5-x64.nsis.7z.part003", 247192560L, "f6768b5056d0579de236f052c1b93d5fffdad84c1902dadb725debafb9645973")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
