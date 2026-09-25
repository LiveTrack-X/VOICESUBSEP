using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace VoiceSubSepInstaller
{
    public sealed class Asset
    {
        public string Name { get; set; }
        public long Size { get; set; }
        public string Sha256 { get; set; }
        public string ApiUrl { get; set; }
    }

    // No original exception/URL/token is retained, including as InnerException.
    public sealed class DownloadException : Exception
    {
        public string Code { get; private set; }
        public DownloadException(string code, string message) : base(message) { Code = code; }
    }

    public sealed class DownloadEngine
    {
        public const int BufferSize = 1024 * 1024;
        private readonly HttpClient client;
        private readonly long maxBytesPerSecond;
        private readonly Action<long, long, string> progress;
        private readonly SemaphoreSlim gate = new SemaphoreSlim(1, 1);

        // Injected clients MUST use a handler with AllowAutoRedirect=false and UseCookies=false.
        // Authorization belongs to individual API requests, never DefaultRequestHeaders.
        public DownloadEngine(HttpClient client, long maxBytesPerSecond, Action<long, long, string> progress)
        {
            if (client == null || maxBytesPerSecond < 0) throw Failure("configuration");
            this.client = client;
            this.maxBytesPerSecond = maxBytesPerSecond; // zero means explicitly unlimited
            this.progress = progress;
            CheckClientHeaders();
        }

        public static HttpClient CreateClient()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            return new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
        }

        public async Task<string> DownloadAsync(Asset asset, string cacheFolder, string token, CancellationToken cancellation)
        {
            await gate.WaitAsync(cancellation).ConfigureAwait(false);
            try
            {
                ValidateAsset(asset);
                Uri api = ValidateUrl(asset.ApiUrl, true);
                if (token != null && (token.Length > 4096 || token.IndexOfAny(new char[] { '\r', '\n' }) >= 0)) throw Failure("authorization");
                string destination = CachePath(cacheFolder, asset.Name);
                string partial = CachePath(cacheFolder, asset.Name + ".partial", true);
                if (await VerifiedAsync(destination, asset, cancellation).ConfigureAwait(false))
                {
                    Report(asset.Size, asset.Size, "complete");
                    return destination;
                }
                if (File.Exists(destination)) File.Delete(destination);
                if (File.Exists(partial) && new FileInfo(partial).Length == asset.Size)
                {
                    if (await VerifiedAsync(partial, asset, cancellation).ConfigureAwait(false))
                    {
                        cancellation.ThrowIfCancellationRequested();
                        File.Move(partial, destination);
                        Report(asset.Size, asset.Size, "complete");
                        return destination;
                    }
                    File.Delete(partial);
                }
                if (File.Exists(partial) && new FileInfo(partial).Length > asset.Size) File.Delete(partial);
                long offset = File.Exists(partial) ? new FileInfo(partial).Length : 0;
                using (HttpResponseMessage response = await SendAsync(api, offset, token, cancellation).ConfigureAwait(false))
                {
                    long start = ValidateResponse(response, offset, asset.Size);
                    cancellation.ThrowIfCancellationRequested();
                    CheckNotReparse(partial);
                    using (Stream input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    using (FileStream output = new FileStream(partial, start == 0 ? FileMode.Create : FileMode.Open,
                               FileAccess.Write, FileShare.None, BufferSize, true))
                    {
                        if (start > 0 && output.Length != start) throw Failure("partial_changed");
                        output.Position = start;
                        byte[] buffer = new byte[BufferSize];
                        long completed = start, transferred = 0;
                        Stopwatch clock = Stopwatch.StartNew();
                        Report(completed, asset.Size, "downloading");
                        while (true)
                        {
                            int count = await input.ReadAsync(buffer, 0, buffer.Length, cancellation).ConfigureAwait(false);
                            if (count == 0) break;
                            if (count > asset.Size - completed) throw Failure("size_mismatch");
                            await output.WriteAsync(buffer, 0, count, cancellation).ConfigureAwait(false);
                            completed += count;
                            transferred += count;
                            Report(completed, asset.Size, "downloading");
                            await ThrottleAsync(transferred, clock, cancellation).ConfigureAwait(false);
                        }
                        await output.FlushAsync(cancellation).ConfigureAwait(false);
                        if (completed != asset.Size) throw Failure("incomplete");
                    }
                }
                if (!await VerifiedAsync(partial, asset, cancellation).ConfigureAwait(false))
                {
                    File.Delete(partial); // a complete corrupt prefix must not poison every retry
                    throw Failure("checksum");
                }
                cancellation.ThrowIfCancellationRequested();
                File.Move(partial, destination);
                Report(asset.Size, asset.Size, "complete");
                return destination;
            }
            catch (OperationCanceledException)
            {
                if (cancellation.IsCancellationRequested) throw new OperationCanceledException(cancellation);
                throw Failure("network_timeout");
            }
            catch (DownloadException) { throw; }
            catch (HttpRequestException) { throw Failure("network"); }
            catch (UnauthorizedAccessException) { throw Failure("storage_access"); }
            catch (IOException) { throw Failure("storage_or_connection"); }
            catch (Exception) { throw Failure("operation"); }
            finally { gate.Release(); }
        }

        public async Task<string> AssembleAsync(IList<Asset> parts, Asset payload, string cacheFolder, CancellationToken cancellation)
        {
            await gate.WaitAsync(cancellation).ConfigureAwait(false);
            string partial = null;
            try
            {
                ValidateAsset(payload);
                if (parts == null || parts.Count == 0 || parts.Count > 10000) throw Failure("manifest");
                long size = 0;
                HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (Asset part in parts)
                {
                    ValidateAsset(part);
                    if (!names.Add(part.Name) || String.Equals(part.Name, payload.Name, StringComparison.OrdinalIgnoreCase)) throw Failure("manifest");
                    if (part.Size > payload.Size - size) throw Failure("manifest");
                    size += part.Size;
                }
                if (size != payload.Size) throw Failure("manifest");
                string destination = CachePath(cacheFolder, payload.Name);
                partial = CachePath(cacheFolder, payload.Name + ".partial", true);
                if (await VerifiedAsync(destination, payload, cancellation).ConfigureAwait(false))
                {
                    Report(payload.Size, payload.Size, "complete");
                    return destination;
                }
                if (File.Exists(destination)) File.Delete(destination);
                cancellation.ThrowIfCancellationRequested();
                using (FileStream output = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None, BufferSize, true))
                using (SHA256 combinedHash = SHA256.Create())
                {
                    byte[] buffer = new byte[BufferSize];
                    long completed = 0;
                    foreach (Asset part in parts)
                    {
                        cancellation.ThrowIfCancellationRequested();
                        string path = CachePath(cacheFolder, part.Name);
                        using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize, true))
                        using (SHA256 partHash = SHA256.Create())
                        {
                            if (input.Length != part.Size) throw Failure("part_checksum");
                            long read = 0;
                            while (true)
                            {
                                int count = await input.ReadAsync(buffer, 0, buffer.Length, cancellation).ConfigureAwait(false);
                                if (count == 0) break;
                                if (count > part.Size - read) throw Failure("part_checksum");
                                partHash.TransformBlock(buffer, 0, count, buffer, 0);
                                combinedHash.TransformBlock(buffer, 0, count, buffer, 0);
                                await output.WriteAsync(buffer, 0, count, cancellation).ConfigureAwait(false);
                                read += count;
                                completed += count;
                                Report(completed, payload.Size, "assembling");
                            }
                            partHash.TransformFinalBlock(new byte[0], 0, 0);
                            if (read != part.Size || !HashMatches(partHash.Hash, part.Sha256)) throw Failure("part_checksum");
                        }
                    }
                    combinedHash.TransformFinalBlock(new byte[0], 0, 0);
                    if (completed != payload.Size || !HashMatches(combinedHash.Hash, payload.Sha256)) throw Failure("checksum");
                    await output.FlushAsync(cancellation).ConfigureAwait(false);
                }
                cancellation.ThrowIfCancellationRequested();
                File.Move(partial, destination);
                Report(payload.Size, payload.Size, "complete");
                return destination;
            }
            catch (OperationCanceledException) { throw new OperationCanceledException(cancellation); }
            catch (DownloadException error)
            {
                if (partial != null && (error.Code == "checksum" || error.Code == "part_checksum")) TryDelete(partial);
                throw;
            }
            catch (UnauthorizedAccessException) { throw Failure("storage_access"); }
            catch (IOException) { throw Failure("storage"); }
            catch (Exception) { throw Failure("operation"); }
            finally { gate.Release(); }
        }

        private async Task<HttpResponseMessage> SendAsync(Uri initial, long offset, string token, CancellationToken cancellation)
        {
            Uri current = initial;
            for (int redirects = 0; ; redirects++)
            {
                CheckClientHeaders();
                using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, current))
                {
                    request.Headers.UserAgent.ParseAdd("VOICESUBSEP-Installer/0.2.0");
                    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/octet-stream"));
                    if (offset > 0) request.Headers.Range = new RangeHeaderValue(offset, null);
                    if (current.Host.Equals("api.github.com", StringComparison.OrdinalIgnoreCase))
                    {
                        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
                        if (!String.IsNullOrEmpty(token)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    }
                    HttpResponseMessage response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation).ConfigureAwait(false);
                    if (response.RequestMessage != null && response.RequestMessage.RequestUri != current)
                    {
                        response.Dispose();
                        throw Failure("automatic_redirects_enabled");
                    }
                    int status = (int)response.StatusCode;
                    if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) return response;
                    Uri next = response.Headers.Location;
                    response.Dispose();
                    if (redirects >= 5 || next == null) throw Failure("redirect");
                    if (!next.IsAbsoluteUri) next = new Uri(current, next);
                    current = ValidateUrl(next.AbsoluteUri, false);
                }
            }
        }

        private static long ValidateResponse(HttpResponseMessage response, long offset, long total)
        {
            if (response.StatusCode == HttpStatusCode.Unauthorized) throw Failure("unauthorized");
            if (response.StatusCode == HttpStatusCode.Forbidden) throw Failure("forbidden");
            if (response.StatusCode == HttpStatusCode.NotFound) throw Failure("not_found");
            if (response.Content == null) throw Failure("response");
            long start;
            if (response.StatusCode == HttpStatusCode.PartialContent)
            {
                ContentRangeHeaderValue range = response.Content.Headers.ContentRange;
                if (range == null || range.Unit != "bytes" || range.From != offset || range.To != total - 1 || range.Length != total) throw Failure("range");
                start = offset;
            }
            else if (response.StatusCode == HttpStatusCode.OK) start = 0; // server ignored Range: truncate, never append
            else throw Failure("response");
            if (response.Content.Headers.ContentLength.HasValue && response.Content.Headers.ContentLength.Value != total - start) throw Failure("size_mismatch");
            return start;
        }

        private async Task<bool> VerifiedAsync(string path, Asset asset, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            CheckNotReparse(path);
            if (!File.Exists(path)) return false;
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize, true))
            using (SHA256 hash = SHA256.Create())
            {
                if (stream.Length != asset.Size) return false;
                byte[] buffer = new byte[BufferSize];
                long completed = 0;
                while (true)
                {
                    int count = await stream.ReadAsync(buffer, 0, buffer.Length, cancellation).ConfigureAwait(false);
                    if (count == 0) break;
                    hash.TransformBlock(buffer, 0, count, buffer, 0);
                    completed += count;
                    Report(completed, asset.Size, "verifying");
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                return completed == asset.Size && HashMatches(hash.Hash, asset.Sha256);
            }
        }

        private async Task ThrottleAsync(long bytes, Stopwatch clock, CancellationToken cancellation)
        {
            if (maxBytesPerSecond == 0) return;
            while (true)
            {
                double delay = bytes * 1000.0 / maxBytesPerSecond - clock.Elapsed.TotalMilliseconds;
                if (delay <= 0) return;
                await Task.Delay((int)Math.Min(1000, Math.Ceiling(delay)), cancellation).ConfigureAwait(false);
            }
        }

        private static void ValidateAsset(Asset asset)
        {
            if (asset == null || asset.Size <= 0 || String.IsNullOrEmpty(asset.Sha256) || !Regex.IsMatch(asset.Sha256, "\\A[0-9a-fA-F]{64}\\z")) throw Failure("manifest");
            ValidateName(asset.Name, false);
        }

        private static void ValidateName(string name, bool internalPartial)
        {
            if (String.IsNullOrWhiteSpace(name) || name.Length > (internalPartial ? 188 : 180) || name != name.Trim() || name == "." || name == ".." ||
                name.EndsWith(".", StringComparison.Ordinal) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
                name.IndexOfAny(new char[] { '/', '\\', ':' }) >= 0 || Path.GetFileName(name) != name ||
                (!internalPartial && name.EndsWith(".partial", StringComparison.OrdinalIgnoreCase)) ||
                Regex.IsMatch(name, "\\A(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\\.|\\z)", RegexOptions.IgnoreCase)) throw Failure("asset_name");
        }

        private static string CachePath(string cacheFolder, string name, bool internalPartial = false)
        {
            ValidateName(name, internalPartial);
            if (String.IsNullOrWhiteSpace(cacheFolder)) throw Failure("cache_path");
            string root = Path.GetFullPath(cacheFolder);
            for (DirectoryInfo directory = new DirectoryInfo(root); directory != null; directory = directory.Parent)
                if (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0) throw Failure("cache_path");
            Directory.CreateDirectory(root);
            string path = Path.GetFullPath(Path.Combine(root, name));
            string prefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw Failure("cache_path");
            CheckNotReparse(path);
            return path;
        }

        private static void CheckNotReparse(string path)
        {
            if ((File.Exists(path) || Directory.Exists(path)) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw Failure("cache_path");
        }

        private static Uri ValidateUrl(string value, bool initial)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps || uri.Port != 443 ||
                !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Fragment)) throw Failure("asset_url");
            bool api = uri.Host.Equals("api.github.com", StringComparison.OrdinalIgnoreCase);
            bool publicRelease = uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase) &&
                Regex.IsMatch(uri.AbsolutePath, "\\A/[^/]+/[^/]+/releases/download/[^/]+/[^/]+\\z");
            bool storage = uri.Host.Equals("release-assets.githubusercontent.com", StringComparison.OrdinalIgnoreCase) || uri.Host.Equals("objects.githubusercontent.com", StringComparison.OrdinalIgnoreCase);
            if (initial ? !(api || publicRelease) : !storage) throw Failure("redirect_host");
            return uri;
        }

        private void CheckClientHeaders()
        {
            if (client.DefaultRequestHeaders.Contains("Authorization") || client.DefaultRequestHeaders.Contains("Proxy-Authorization") || client.DefaultRequestHeaders.Contains("Cookie")) throw Failure("client_headers");
        }

        private static bool HashMatches(byte[] bytes, string expected)
        {
            string actual = BitConverter.ToString(bytes).Replace("-", "");
            return String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);
        }

        private void Report(long done, long total, string stage)
        {
            try { if (progress != null) progress(done, total, stage); }
            catch { /* A closed progress window cannot corrupt a verified file. */ }
        }

        private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
        private static DownloadException Failure(string code) { return new DownloadException(code, "Installer operation failed (" + code + "). Retry or restart the installer."); }
    }
}
