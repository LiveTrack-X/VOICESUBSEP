using System.Collections.Generic;

namespace VoiceSubSepInstaller
{
    // Pinned to the original v0.3.1 assets; changes require rebuilding the bootstrap.
    internal static class ReleaseConfig
    {
        internal const string Version = "0.3.1";
        internal const string ReleaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/tag/v0.3.1";
        private const string BaseUrl = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/download/v0.3.1/";
        internal static readonly Asset Installer = File("VOICESUBSEP-0.3.1-Offline-Setup-x64.exe", 1045696L, "2c09da69e43e4162c36a7da52a83bad80f22b5867543bc6ff2bc9ddb3eccbced");
        internal static readonly Asset Payload = File("voicesubsep-0.3.1-x64.nsis.7z", 2419022088L, "f2a5c0b6e9aa534857933a6cf9685b5075eda7e61f12bf8c3a668771abfd4b04");
        internal static readonly IList<Asset> Parts = new List<Asset> {
            File("voicesubsep-0.3.1-x64.nsis.7z.part001", 1073741824L, "bcda5b7d3510f2855ae3fe766c5ea5590551fe5fa6a68e2f327660224f23548e"),
            File("voicesubsep-0.3.1-x64.nsis.7z.part002", 1073741824L, "98d6bfed226ad7e22195d09da2ea310fade04eb2f9e69d761467adc3e44e5c66"),
            File("voicesubsep-0.3.1-x64.nsis.7z.part003", 271538440L, "72a2bde577fa535e446d8a2cdb8c5cdd41a9f675268b7677e27823d4d4e47c40")
        };
        private static Asset File(string name, long size, string hash)
        {
            return new Asset { Name = name, Size = size, Sha256 = hash, ApiUrl = BaseUrl + name };
        }
    }
}
