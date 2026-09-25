using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using VoiceSubSepInstaller;

namespace VoiceSubSepInstallerTests
{
    public static class BootstrapCoreTests
    {
        private sealed class Handler : HttpMessageHandler
        {
            public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Handle;
            public int Calls;
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
            {
                Calls++;
                return Handle(request, cancellation);
            }
        }

        private sealed class Cache : IDisposable
        {
            public readonly string Root = Path.Combine(Path.GetTempPath(), "VoiceSubSepInstallerTests-" + Guid.NewGuid().ToString("N"));
            public Cache() { Directory.CreateDirectory(Root); }
            public string PathFor(string name) { return Path.Combine(Root, name); }
            public void Dispose() { Directory.Delete(Root, true); }
        }

        private sealed class DisconnectingStream : Stream
        {
            private readonly byte[] bytes;
            private bool sent;
            public DisconnectingStream(byte[] bytes) { this.bytes = bytes; }
            public override bool CanRead { get { return true; } }
            public override bool CanSeek { get { return false; } }
            public override bool CanWrite { get { return false; } }
            public override long Length { get { throw new NotSupportedException(); } }
            public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
            public override int Read(byte[] buffer, int offset, int count)
            {
                if (sent) throw new IOException("https://signed.example/?token=private-test-token");
                sent = true;
                Array.Copy(bytes, 0, buffer, offset, bytes.Length);
                return bytes.Length;
            }
            public override void Flush() { }
            public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
            public override void SetLength(long value) { throw new NotSupportedException(); }
            public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        }

        private static byte[] Data(int size)
        {
            byte[] data = new byte[size];
            for (int index = 0; index < size; index++) data[index] = (byte)(index % 251);
            return data;
        }

        private static string Hash(byte[] data)
        {
            using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(data)).Replace("-", "").ToLowerInvariant();
        }

        private static Asset FileAsset(string name, byte[] data)
        {
            return new Asset { Name = name, Size = data.Length, Sha256 = Hash(data), ApiUrl = "https://api.github.com/repos/example/app/releases/assets/1" };
        }

        private static HttpResponseMessage Content(byte[] bytes, int status = 200)
        {
            return new HttpResponseMessage((HttpStatusCode)status) { Content = new ByteArrayContent(bytes) };
        }

        private static Task<HttpResponseMessage> Reply(HttpResponseMessage response) { return Task.FromResult(response); }
        private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
        private static async Task Fails(Func<Task> action, string code)
        {
            try { await action(); }
            catch (DownloadException error) { Check(error.Code == code, "Unexpected error code"); Check(error.InnerException == null, "Original error leaked"); return; }
            throw new Exception("Expected controlled failure");
        }

        private static async Task FullDownloadAndReuse()
        {
            byte[] bytes = Data(20000); Asset asset = FileAsset("part.001", bytes);
            Handler handler = new Handler { Handle = (request, cancellation) => Reply(Content(bytes)) };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
            {
                DownloadEngine engine = new DownloadEngine(client, 10000000, null);
                string path = await engine.DownloadAsync(asset, cache.Root, "", CancellationToken.None);
                Check(File.ReadAllBytes(path).SequenceEqual(bytes), "Download content changed");
                Check(!File.Exists(path + ".partial"), "Verified partial was not renamed");
                Check(await engine.DownloadAsync(asset, cache.Root, "", CancellationToken.None) == path && handler.Calls == 1, "Verified cache was not reused");
            }
        }

        private static async Task ResumeAndIgnoredRange()
        {
            foreach (bool honor in new bool[] { true, false })
            {
                byte[] bytes = Data(9000); Asset asset = FileAsset("part.001", bytes);
                Handler handler = new Handler { Handle = (request, cancellation) => {
                    Check(request.Headers.Range.Ranges.Single().From == 3000, "Resume offset missing");
                    HttpResponseMessage response = Content(honor ? bytes.Skip(3000).ToArray() : bytes, honor ? 206 : 200);
                    if (honor) response.Content.Headers.ContentRange = new ContentRangeHeaderValue(3000, bytes.Length - 1, bytes.Length);
                    return Reply(response);
                } };
                using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
                {
                    File.WriteAllBytes(cache.PathFor(asset.Name + ".partial"), bytes.Take(3000).ToArray());
                    string path = await new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None);
                    Check(File.ReadAllBytes(path).SequenceEqual(bytes), "Resume or Range-ignored restart corrupted output");
                }
            }
        }

        private static async Task InvalidRangeKeepsPartial()
        {
            foreach (int mode in new int[] { 0, 1, 2 })
            {
                byte[] bytes = Data(6000); Asset asset = FileAsset("part.001", bytes);
                Handler handler = new Handler { Handle = (request, cancellation) => {
                    HttpResponseMessage response = Content(bytes.Skip(2000).ToArray(), 206);
                    response.Content.Headers.ContentRange = new ContentRangeHeaderValue(mode == 0 ? 1999 : 2000, mode == 1 ? 5998 : 5999, mode == 2 ? 6001 : 6000);
                    return Reply(response);
                } };
                using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
                {
                    string partial = cache.PathFor(asset.Name + ".partial"); File.WriteAllBytes(partial, bytes.Take(2000).ToArray());
                    await Fails(() => new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None), "range");
                    Check(File.ReadAllBytes(partial).SequenceEqual(bytes.Take(2000)), "Bad range modified the partial");
                    Check(!File.Exists(cache.PathFor(asset.Name)), "Bad range created final file");
                }
            }
        }

        private static async Task CancelKeepsPartialAndResumes()
        {
            byte[] bytes = Data(DownloadEngine.BufferSize * 2 + 10); Asset asset = FileAsset("large.part", bytes);
            Handler handler = new Handler { Handle = (request, cancellation) => {
                long from = request.Headers.Range == null ? 0 : request.Headers.Range.Ranges.Single().From.Value;
                HttpResponseMessage response = Content(bytes.Skip((int)from).ToArray(), from > 0 ? 206 : 200);
                if (from > 0) response.Content.Headers.ContentRange = new ContentRangeHeaderValue(from, bytes.Length - 1, bytes.Length);
                return Reply(response);
            } };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler)) using (CancellationTokenSource stop = new CancellationTokenSource())
            {
                DownloadEngine engine = new DownloadEngine(client, 0, (done, total, stage) => { if (stage == "downloading" && done >= DownloadEngine.BufferSize) stop.Cancel(); });
                try { await engine.DownloadAsync(asset, cache.Root, null, stop.Token); throw new Exception("Cancellation ignored"); }
                catch (OperationCanceledException) { }
                string partial = cache.PathFor(asset.Name + ".partial");
                Check(new FileInfo(partial).Length == DownloadEngine.BufferSize && !File.Exists(cache.PathFor(asset.Name)), "Cancellation did not preserve only partial");
                string path = await new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None);
                Check(File.ReadAllBytes(path).SequenceEqual(bytes), "Cancelled transfer did not resume");
            }
        }

        private static async Task CorruptionNeverPromotes()
        {
            byte[] bytes = Data(9000); Asset asset = FileAsset("part.001", bytes); byte[] wrong = (byte[])bytes.Clone(); wrong[2] ^= 127;
            Handler handler = new Handler { Handle = (request, cancellation) => Reply(Content(wrong)) };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
            {
                await Fails(() => new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None), "checksum");
                Check(!File.Exists(cache.PathFor(asset.Name)) && !File.Exists(cache.PathFor(asset.Name + ".partial")), "Corrupt data retained as complete");
                File.WriteAllBytes(cache.PathFor(asset.Name), wrong);
                handler.Handle = (request, cancellation) => Reply(Content(bytes));
                string path = await new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None);
                Check(File.ReadAllBytes(path).SequenceEqual(bytes), "Corrupt final cache was trusted");
            }
        }

        private static async Task CompletedPartialNeedsNoNetwork()
        {
            byte[] bytes = Data(200); Asset asset = FileAsset("part.001", bytes);
            Handler handler = new Handler { Handle = (request, cancellation) => { throw new Exception("Network forbidden"); } };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
            {
                File.WriteAllBytes(cache.PathFor(asset.Name + ".partial"), bytes);
                string path = await new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None);
                Check(File.Exists(path) && handler.Calls == 0, "Completed partial was redownloaded");
            }
        }

        private static async Task UnsafeNamesFailBeforeNetwork()
        {
            foreach (string name in new string[] { "../outside", "..\\outside", "C:\\outside", "/outside", "file:stream", "CON", "nul.txt", "COM1.zip", "bad. ", "part.partial" })
            {
                Handler handler = new Handler { Handle = (request, cancellation) => Reply(Content(Data(1))) };
                using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
                {
                    Asset asset = FileAsset(name, Data(1));
                    await Fails(() => new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None), "asset_name");
                    Check(handler.Calls == 0 && Directory.GetFiles(cache.Root).Length == 0, "Unsafe name reached IO");
                }
            }
        }

        private static async Task RedirectHostAndTokenIsolation()
        {
            byte[] bytes = Data(50); Asset asset = FileAsset("part.001", bytes); int calls = 0;
            Handler handler = new Handler { Handle = (request, cancellation) => {
                calls++;
                if (calls == 1)
                {
                    Check(request.Headers.Authorization.Parameter == "private-test-token", "API token missing");
                    HttpResponseMessage redirect = new HttpResponseMessage(HttpStatusCode.Found);
                    redirect.Headers.Location = new Uri("https://release-assets.githubusercontent.com/download?signature=private-test-signature");
                    return Reply(redirect);
                }
                Check(request.Headers.Authorization == null, "Authorization leaked to asset host");
                return Reply(Content(bytes));
            } };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
            {
                await new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, "private-test-token", CancellationToken.None);
                Check(calls == 2, "Redirect not followed");
            }
            foreach (string url in new string[] { "http://release-assets.githubusercontent.com/file", "https://evil.example/file", "https://release-assets.githubusercontent.com.evil.example/file", "https://api.github.com/user", "https://user:secret@objects.githubusercontent.com/file", "https://objects.githubusercontent.com:444/file" })
            {
                Handler denied = new Handler { Handle = (request, cancellation) => {
                    HttpResponseMessage redirect = new HttpResponseMessage(HttpStatusCode.Found); redirect.Headers.Location = new Uri(url); return Reply(redirect);
                } };
                using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(denied))
                {
                    try { await new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, "private-test-token", CancellationToken.None); throw new Exception("Unsafe redirect accepted"); }
                    catch (DownloadException error) { Check(!error.ToString().Contains("private-test") && !error.ToString().Contains(url), "Network secret leaked"); }
                    Check(denied.Calls == 1, "Unsafe host was requested");
                }
            }
        }

        private static async Task PublicReleaseAndRedirectLimit()
        {
            byte[] bytes = Data(30); Asset asset = FileAsset("part.001", bytes); asset.ApiUrl = "https://github.com/example/app/releases/download/v0.2.0/part.001";
            Handler handler = new Handler(); handler.Handle = (request, cancellation) => {
                Check(request.Headers.Authorization == null, "Public URL received a token");
                if (handler.Calls == 1) { HttpResponseMessage redirect = new HttpResponseMessage(HttpStatusCode.Found); redirect.Headers.Location = new Uri("https://objects.githubusercontent.com/file"); return Reply(redirect); }
                return Reply(Content(bytes));
            };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
                await new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, "must-not-send", CancellationToken.None);
            Handler loop = new Handler { Handle = (request, cancellation) => { HttpResponseMessage redirect = new HttpResponseMessage(HttpStatusCode.Found); redirect.Headers.Location = new Uri("https://objects.githubusercontent.com/loop"); return Reply(redirect); } };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(loop))
            {
                await Fails(() => new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None), "redirect");
                Check(loop.Calls == 6, "Redirect bound was not five hops");
            }
        }

        private static async Task HeaderAndErrorSanitization()
        {
            Handler handler = new Handler { Handle = (request, cancellation) => { throw new HttpRequestException("https://signed.example/?token=private-test-token"); } };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
            {
                await Fails(() => new DownloadEngine(client, 0, null).DownloadAsync(FileAsset("part.001", Data(20)), cache.Root, "private-test-token", CancellationToken.None), "network");
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "private-test-token");
                try { new DownloadEngine(client, 0, null); throw new Exception("Default Authorization accepted"); }
                catch (DownloadException error) { Check(error.Code == "client_headers" && !error.ToString().Contains("private-test-token"), "Unsafe client/error accepted"); }
            }
        }

        private static async Task DisconnectionPreservesPartialAndSanitizesError()
        {
            byte[] bytes = Data(20000); Asset asset = FileAsset("part.001", bytes);
            Handler handler = new Handler { Handle = (request, cancellation) => Reply(new HttpResponseMessage(HttpStatusCode.OK) {
                Content = new StreamContent(new DisconnectingStream(bytes.Take(2000).ToArray()))
            }) };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
            {
                await Fails(() => new DownloadEngine(client, 0, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None), "storage_or_connection");
                Check(File.ReadAllBytes(cache.PathFor(asset.Name + ".partial")).SequenceEqual(bytes.Take(2000)), "Disconnected stream lost partial bytes");
                Check(!File.Exists(cache.PathFor(asset.Name)), "Disconnected stream promoted partial");
            }
        }

        private static async Task RateLimitAppliesToTransferredBytes()
        {
            byte[] bytes = Data(16384); Asset asset = FileAsset("part.001", bytes);
            Handler handler = new Handler { Handle = (request, cancellation) => Reply(Content(bytes)) };
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(handler))
            {
                Stopwatch clock = Stopwatch.StartNew();
                await new DownloadEngine(client, 32768, null).DownloadAsync(asset, cache.Root, null, CancellationToken.None);
                Check(clock.ElapsedMilliseconds >= 450, "Download speed cap not applied");
            }
        }

        private static async Task WrongPayloadHashNeverPromotesAssembly()
        {
            byte[] bytes = Data(100); Asset part = FileAsset("part.001", bytes), payload = FileAsset("payload.7z", bytes);
            payload.Sha256 = new string('0', 64);
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(new Handler()))
            {
                File.WriteAllBytes(cache.PathFor(part.Name), bytes);
                await Fails(() => new DownloadEngine(client, 0, null).AssembleAsync(new Asset[] { part }, payload, cache.Root, CancellationToken.None), "checksum");
                Check(!File.Exists(cache.PathFor(payload.Name)), "Wrong original payload checksum accepted");
                Check(File.Exists(cache.PathFor(part.Name)), "Assembly deleted a verified part");
            }
        }

        private static async Task AssemblyAndReuse()
        {
            byte[] one = Data(333), two = Data(555); byte[] all = one.Concat(two).ToArray();
            Asset a = FileAsset("part.001", one), b = FileAsset("part.002", two), payload = FileAsset("payload.7z", all);
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(new Handler()))
            {
                File.WriteAllBytes(cache.PathFor(a.Name), one); File.WriteAllBytes(cache.PathFor(b.Name), two);
                DownloadEngine engine = new DownloadEngine(client, 0, null);
                string path = await engine.AssembleAsync(new Asset[] { a, b }, payload, cache.Root, CancellationToken.None);
                Check(File.ReadAllBytes(path).SequenceEqual(all), "Parts assembled out of order");
                File.Delete(cache.PathFor(a.Name)); File.Delete(cache.PathFor(b.Name));
                Check(await engine.AssembleAsync(new Asset[] { a, b }, payload, cache.Root, CancellationToken.None) == path, "Verified payload not reused");
            }
        }

        private static async Task AssemblyCorruptionAndCancellation()
        {
            byte[] bytes = Data(DownloadEngine.BufferSize + 50); Asset part = FileAsset("part.001", bytes), payload = FileAsset("payload.7z", bytes);
            using (Cache cache = new Cache()) using (HttpClient client = new HttpClient(new Handler())) using (CancellationTokenSource stop = new CancellationTokenSource())
            {
                File.WriteAllBytes(cache.PathFor(part.Name), bytes);
                DownloadEngine engine = new DownloadEngine(client, 0, (done, total, stage) => { if (stage == "assembling") stop.Cancel(); });
                try { await engine.AssembleAsync(new Asset[] { part }, payload, cache.Root, stop.Token); throw new Exception("Assembly cancellation ignored"); }
                catch (OperationCanceledException) { }
                Check(File.Exists(cache.PathFor(payload.Name + ".partial")) && !File.Exists(cache.PathFor(payload.Name)), "Assembly cancellation promoted file");
                bytes[0] ^= 127; File.WriteAllBytes(cache.PathFor(part.Name), bytes);
                await Fails(() => new DownloadEngine(client, 0, null).AssembleAsync(new Asset[] { part }, payload, cache.Root, CancellationToken.None), "part_checksum");
                Check(!File.Exists(cache.PathFor(payload.Name)), "Corrupt part was assembled");
            }
        }

        public static int Main()
        {
            Func<Task>[] tests = { FullDownloadAndReuse, ResumeAndIgnoredRange, InvalidRangeKeepsPartial,
                CancelKeepsPartialAndResumes, CorruptionNeverPromotes, CompletedPartialNeedsNoNetwork,
                UnsafeNamesFailBeforeNetwork, RedirectHostAndTokenIsolation, PublicReleaseAndRedirectLimit,
                HeaderAndErrorSanitization, DisconnectionPreservesPartialAndSanitizesError, RateLimitAppliesToTransferredBytes,
                AssemblyAndReuse, AssemblyCorruptionAndCancellation, WrongPayloadHashNeverPromotesAssembly };
            int passed = 0;
            foreach (Func<Task> test in tests)
            {
                try { test().GetAwaiter().GetResult(); passed++; Console.WriteLine("PASS " + test.Method.Name); }
                catch (Exception error) { Console.WriteLine("FAIL " + test.Method.Name + ": " + error.GetType().Name + " " + error.Message); return 1; }
            }
            Console.WriteLine(passed + " tests passed; all HTTP requests used an in-memory handler.");
            return 0;
        }
    }
}
