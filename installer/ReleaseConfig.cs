using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the original v0.2.1 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.2.1";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.2.1";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.2.1/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.2.1-Offline-Setup-x64.exe", 1045607L, "c5629f6af04b8e3352f00628e1ba77ca0b5fd2680c64249fd2e15096d3aeb868");
        internal static readonly Asset Payload = File("voicesubsep-0.2.1-x64.nsis.7z", 2416282180L, "167d20e857390d174ee91ebf74991b2f7f42df8b559cf34aa221cd799b32f628");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.2.1-x64.nsis.7z.part001", 1073741824L, "7e41cb1655c8d8d1328d80cf0cde47cba439762c10ce338438275abfb247db0e"),
            File("voicesubsep-0.2.1-x64.nsis.7z.part002", 1073741824L, "88e0b3992625b3a35177c909edb8d5df02f913ff44dd3ceb905212366cd52a4b"),
            File("voicesubsep-0.2.1-x64.nsis.7z.part003", 268798532L, "f230597b76893756042fc0a30dc01303578564747dc2d95f9eab715afc7ae883")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
