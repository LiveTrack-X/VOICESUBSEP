using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the original v0.3.2 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.3.2";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.3.2";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.2/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.3.2-Offline-Setup-x64.exe", 1045703L, "bc952173b583b92ccf259480566b41c7301e97b71f69ae36bbcb4d269e7700b1");
        internal static readonly Asset Payload = File("voicesubsep-0.3.2-x64.nsis.7z", 2419065206L, "276e8b50e9f1671a3598653b9291a6543d26a763ea0cb378f5bbb2e99800805d");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.3.2-x64.nsis.7z.part001", 1073741824L, "d84f76105a82aa367797a94ea7f40400593bb8566f281a9297261fe983ddebbd"),
            File("voicesubsep-0.3.2-x64.nsis.7z.part002", 1073741824L, "5174ed0e1ce05e4120cee7e6b7fb412bd7f99e8a01da2b2db1305349aa0bbbc9"),
            File("voicesubsep-0.3.2-x64.nsis.7z.part003", 271581558L, "72abde6eb8a1234ce8da76fcbd427f4575ac2905e7e30a231e5b8ae0da7d6933")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
