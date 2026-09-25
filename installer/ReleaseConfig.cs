using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the original v0.3.3 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.3.3";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.3.3";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.3/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.3.3-Offline-Setup-x64.exe", 1045704L, "442f1f136ba174639833853d71a5d83becea32d628347c7ce51da9c8c688dee0");
        internal static readonly Asset Payload = File("voicesubsep-0.3.3-x64.nsis.7z", 2419217244L, "ca1bd98db0e0dfea435c27d0c158bfa02ab68fb6d029d7b636dce962e76ca747");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.3.3-x64.nsis.7z.part001", 1073741824L, "6803ae3abe6b4e7823f6bf7d4f99fd441255773eac30a219c752a640425ed545"),
            File("voicesubsep-0.3.3-x64.nsis.7z.part002", 1073741824L, "0203bd2e21f6a6d96706c8ecff0663801f84ba87e097d1e58319c1716d6814fd"),
            File("voicesubsep-0.3.3-x64.nsis.7z.part003", 271733596L, "45c4c018fad07591902c00a03cb875f5f0be75264ecf752cbf9db222bd98a2f0")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
