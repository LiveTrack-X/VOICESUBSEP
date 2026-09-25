using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the original v0.3.4 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.3.4";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.3.4";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.4/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.3.4-Offline-Setup-x64.exe", 1045608L, "070dd57c2af3349a892588ba2e2c5b575047ebff736968359b32791203c785bd");
        internal static readonly Asset Payload = File("voicesubsep-0.3.4-x64.nsis.7z", 2394655120L, "4f78c6bf8f66046c1ba9399fc21881ac69ea05fb7291ff5173b88e524ac697d1");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.3.4-x64.nsis.7z.part001", 1073741824L, "fca424c6e62ef3dbb5f4115c586d5d2bd92f0646f88c38a6c055e1f667947a43"),
            File("voicesubsep-0.3.4-x64.nsis.7z.part002", 1073741824L, "bb02256213d77fac416f473cfce36e0182fe3cd3bc5f13216e4bbcb69f4c0281"),
            File("voicesubsep-0.3.4-x64.nsis.7z.part003", 247171472L, "d62c474d3b5309a239817b6c56ab564cafbe1d131c908589bed59b53501172a6")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
