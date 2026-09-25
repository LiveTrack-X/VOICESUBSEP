using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace VoiceSubSepInstaller
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (!Environment.Is64BitOperatingSystem) {
                MessageBox.Show("Windows x64 is required. / Windows 64비트가 필요합니다.");
                return 1;
            }
            using (var framework = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full")) {
                var release = framework == null ? null : framework.GetValue("Release");
                if (!(release is int) || (int)release < 528040) {
                    MessageBox.Show("Install .NET Framework 4.8 or later through Windows Update, then retry.\nWindows Update에서 .NET Framework 4.8 이상을 설치한 뒤 다시 실행하세요.", "VOICESUBSEP");
                    return 1;
                }
            }
            bool created;
            using (var mutex = new Mutex(true, "Local\\VOICESUBSEP.OnlineInstaller." + ReleaseConfig.Version, out created)) {
                if (!created) {
                    MessageBox.Show("Installer is already running. / 설치 도우미가 이미 실행 중입니다.");
                    return 2;
                }
                try {
                    using (var form = new InstallerForm()) {
                        // Creates the real controls without network access or starting NSIS.
                        if (args.Length == 1 && args[0] == "--smoke") {
                            form.Show();
                            Application.DoEvents();
                            return form.Controls.Count >= 8 ? 0 : 3;
                        }
                        Application.Run(form);
                    }
                } finally { mutex.ReleaseMutex(); }
            }
            return 0;
        }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly Label status = new Label();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Button start = new Button();
        private readonly Button cancel = new Button();
        private readonly ComboBox speed = new ComboBox();
        private readonly string cache;
        private CancellationTokenSource cancellation;
        private bool busy;
        private bool setupLaunched;
        private bool closeAfterCancel;
        private string currentFile = "";
        private DateTime lastProgress = DateTime.MinValue;

        internal InstallerForm()
        {
            Text = "VOICESUBSEP " + ReleaseConfig.Version + " · Online Setup / 온라인 설치";
            ClientSize = new Size(690, 405);
            MinimumSize = MaximumSize = Size;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10F);
            BackColor = Color.White;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "VOICESUBSEP", "InstallerCache", ReleaseConfig.Version);
            AddLabel("VOICESUBSEP " + ReleaseConfig.Version, 22, 18, 644, 32, true);
            AddLabel("Download, verify, then launch setup. / 다운로드·검증 후 설치를 시작합니다.\n" +
                "2.42 GB download · 16 GiB free recommended / 여유 공간 16 GiB 권장\n" +
                "AI model weights download separately in the app. / AI 모델은 앱에서 별도 다운로드", 22, 61, 650, 72, false);
            AddLabel("Download limit / 다운로드 제한", 22, 145, 300, 24, false);
            speed.SetBounds(337, 141, 325, 30);
            speed.DropDownStyle = ComboBoxStyle.DropDownList;
            speed.Items.AddRange(new object[] { "40 Mbps (5 MB/s)", "80 Mbps (10 MB/s)", "Unlimited / 제한 없음" });
            speed.SelectedIndex = 1;
            Controls.Add(speed);
            status.SetBounds(22, 189, 640, 67);
            status.Text = "Ready. No GitHub login required. / 준비됨. GitHub 로그인은 필요하지 않습니다.";
            Controls.Add(status);
            progress.SetBounds(22, 263, 640, 19);
            progress.Maximum = 1000;
            Controls.Add(progress);
            start.SetBounds(22, 302, 414, 38);
            start.Text = "Download & install / 다운로드 및 설치";
            start.Click += async (s, e) => { if (setupLaunched) Close(); else await RunAsync(); };
            Controls.Add(start);
            cancel.SetBounds(448, 302, 214, 38);
            cancel.Text = "Cancel / 취소";
            cancel.Enabled = false;
            cancel.Click += (s, e) => Cancel();
            Controls.Add(cancel);
            var link = new LinkLabel { Text = "Release & manual installation / 릴리즈·수동 설치", Left = 22, Top = 355, Width = 640, Height = 28 };
            link.LinkClicked += (s, e) => {
                try { Process.Start(new ProcessStartInfo(ReleaseConfig.ReleaseUrl) { UseShellExecute = true }); }
                catch (Exception) { MessageBox.Show("Could not open the browser. / 브라우저를 열 수 없습니다."); }
            };
            Controls.Add(link);
            FormClosing += (s, e) => {
                if (!busy) return;
                e.Cancel = true;
                closeAfterCancel = true;
                Cancel();
            };
        }

        private void AddLabel(string text, int x, int y, int width, int height, bool heading)
        {
            var label = new Label { Text = text, Left = x, Top = y, Width = width, Height = height };
            if (heading) label.Font = new Font(Font.FontFamily, 17, FontStyle.Bold);
            Controls.Add(label);
        }

        private void Cancel()
        {
            if (cancellation == null) return;
            cancellation.Cancel();
            cancel.Enabled = false;
            status.Text = "Cancelling… / 취소 중…";
        }

        private void Report(long done, long total, string stage)
        {
            var now = DateTime.UtcNow;
            if (done < total && now - lastProgress < TimeSpan.FromMilliseconds(150)) return;
            lastProgress = now;
            if (IsDisposed || !IsHandleCreated) return;
            string file = currentFile;
            string label = stage == "downloading" ? "Downloading / 다운로드" : stage == "verifying" ? "Verifying / 검증" : stage == "assembling" ? "Assembling / 조립" : "Verified / 검증 완료";
            BeginInvoke(new Action(() => {
                if (IsDisposed || cancellation == null || cancellation.IsCancellationRequested) return;
                progress.Value = total > 0 ? (int)Math.Min(1000, done * 1000.0 / total) : 0;
                status.Text = label + " · " + file + "\n" + (done / 1000000.0).ToString("N1") + " / " + (total / 1000000.0).ToString("N1") + " MB";
            }));
        }

        private async Task RunAsync()
        {
            busy = true;
            start.Enabled = speed.Enabled = false;
            cancel.Enabled = true;
            progress.Value = 0;
            cancellation = new CancellationTokenSource();
            var ct = cancellation.Token;
            long limit = speed.SelectedIndex == 0 ? 5000000L : speed.SelectedIndex == 1 ? 10000000L : 0L;
            try {
                // All disk, hash and network work stays off the UI thread.
                string installerPath = await Task.Run(async () => {
                    Directory.CreateDirectory(cache);
                    var drive = new DriveInfo(Path.GetPathRoot(cache));
                    if (drive.AvailableFreeSpace < 12L * 1024 * 1024 * 1024)
                        throw new IOException("At least 12 GiB free is required; 16 GiB is recommended. / 여유 공간 12 GiB 이상이 필요하며 16 GiB를 권장합니다.");
                    using (var client = DownloadEngine.CreateClient()) {
                        var engine = new DownloadEngine(client, limit, Report);
                        currentFile = ReleaseConfig.Installer.Name;
                        string path = await engine.DownloadAsync(ReleaseConfig.Installer, cache, null, ct);
                        foreach (var part in ReleaseConfig.Parts) {
                            currentFile = part.Name;
                            await engine.DownloadAsync(part, cache, null, ct);
                        }
                        currentFile = ReleaseConfig.Payload.Name;
                        await engine.AssembleAsync(ReleaseConfig.Parts, ReleaseConfig.Payload, cache, ct);
                        ct.ThrowIfCancellationRequested();
                        return path;
                    }
                }, ct);
                ct.ThrowIfCancellationRequested();
                // No --package-file: the co-located original payload retains NSIS's own SHA512 check.
                var launched = Process.Start(new ProcessStartInfo(installerPath) {
                    WorkingDirectory = cache, UseShellExecute = true
                });
                if (launched == null) throw new IOException("Setup could not start. / 설치기를 시작하지 못했습니다.");
                launched.Dispose();
                status.Text = "Verified. Setup has started — follow its instructions.\n검증 완료. 설치기가 시작되었습니다. 설치 창의 안내를 따르세요.";
                progress.Value = progress.Maximum;
                setupLaunched = true;
                start.Text = "Close / 닫기";
            } catch (OperationCanceledException) {
                status.Text = "Cancelled. Partial downloads are kept for retry.\n취소했습니다. 다시 실행하면 받은 파일을 확인하고 이어받습니다.";
                start.Text = "Resume / 이어받기";
            } catch (Exception ex) {
                status.Text = "Failed / 실패: " + ex.Message;
                start.Text = "Retry / 다시 시도";
            } finally {
                busy = false;
                cancellation.Dispose();
                cancellation = null;
                cancel.Enabled = false;
                start.Enabled = speed.Enabled = true;
                if (closeAfterCancel) Close();
            }
        }
    }
}
