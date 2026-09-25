using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the original v0.3.0 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.3.0";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.3.0";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.0/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.3.0-Offline-Setup-x64.exe", 1045696L, "3240113ed460e7d2c458034d8b1ab2c6718b869a725da6ff3220c259b33fe950");
        internal static readonly Asset Payload = File("voicesubsep-0.3.0-x64.nsis.7z", 2419006888L, "93c6855975184faf7af9d959cd9c47ff2d212120913ffa01307b00c807476d1c");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.3.0-x64.nsis.7z.part001", 1073741824L, "b35d31226e87ef8efac5b19bdaf1ebeb80945be11c513d190857ab5e7ae077df"),
            File("voicesubsep-0.3.0-x64.nsis.7z.part002", 1073741824L, "676c80381f51995068298e02c2afe5552fb88f1ab08c5403d25b35689cb75912"),
            File("voicesubsep-0.3.0-x64.nsis.7z.part003", 271523240L, "b0d9f870e20091a9faa68174730fb2bd801f073db41a87f578cd352c7bf34719")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
