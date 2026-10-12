using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

class AgentForm : Form {
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly string configDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FlashubAgente");
    TextBox api, key, rub, user, pass, logs;
    ComboBox browser;
    CheckBox startup;
    Button connect, stop;
    Label status;
    NotifyIcon tray;
    Process child;
    bool exiting;
    string agentId = Guid.NewGuid().ToString();

    public AgentForm(bool autoStart) {
        Text = "Flashub • Agente local"; Size = new Size(690, 790); MinimumSize = new Size(600, 730);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10); BackColor = Color.FromArgb(243, 246, 252);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 2, RowCount = 13, AutoScroll = true };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 65));
        var title = new Label { Text = "Conecte esta máquina ao Flashub", AutoSize = true, Font = new Font("Segoe UI", 17, FontStyle.Bold), Margin = new Padding(0, 0, 0, 15) };
        layout.Controls.Add(title, 0, 0); layout.SetColumnSpan(title, 2);
        api = Field(layout, 1, "Endereço da API", false);
        key = Field(layout, 2, "Chave de conexão", true);
        rub = Field(layout, 3, "Endereço do RUB", false);
        user = Field(layout, 4, "Usuário do RUB", false);
        pass = Field(layout, 5, "Senha do RUB", true);
        layout.Controls.Add(new Label { Text = "Navegador instalado", AutoSize = true, Margin = new Padding(0, 10, 0, 0) }, 0, 6);
        browser = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, Margin = new Padding(0, 4, 0, 8) };
        browser.Items.AddRange(new object[] { "Microsoft Edge", "Google Chrome" }); browser.SelectedIndex = 0; layout.Controls.Add(browser, 1, 6);
        startup = new CheckBox { Text = "Iniciar ao entrar no Windows", AutoSize = true, Margin = new Padding(0, 12, 0, 12) };
        layout.Controls.Add(startup, 0, 7); layout.SetColumnSpan(startup, 2);
        var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
        connect = new Button { Text = "Salvar e conectar", AutoSize = true, BackColor = Color.FromArgb(108, 83, 238), ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Padding = new Padding(10, 5, 10, 5) };
        stop = new Button { Text = "Desconectar", AutoSize = true, Enabled = false, Padding = new Padding(10, 5, 10, 5) };
        connect.Click += delegate { SaveAndStart(); }; stop.Click += delegate { StopAgent(); };
        buttons.Controls.Add(connect); buttons.Controls.Add(stop); layout.Controls.Add(buttons, 0, 8); layout.SetColumnSpan(buttons, 2);
        status = new Label { Text = "Desconectado", AutoSize = true, Margin = new Padding(0, 14, 0, 8), ForeColor = Color.FromArgb(60, 85, 115) };
        layout.Controls.Add(status, 0, 9); layout.SetColumnSpan(status, 2);
        logs = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Height = 190, BackColor = Color.White };
        layout.Controls.Add(logs, 0, 10); layout.SetColumnSpan(logs, 2); layout.RowStyles.Add(new RowStyle());
        var note = new Label { Text = "As credenciais são protegidas pelo Windows para este usuário. Fechar a janela mantém o agente na bandeja. Para encerrar, use Sair no ícone da bandeja. A máquina precisa permanecer ligada e sem suspensão.", AutoSize = true, MaximumSize = new Size(610, 0), Margin = new Padding(0, 14, 0, 0) };
        layout.Controls.Add(note, 0, 11); layout.SetColumnSpan(note, 2); Controls.Add(layout);
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Flashub Agente", Visible = true };
        var menu = new ContextMenuStrip(); menu.Items.Add("Abrir", null, delegate { Show(); WindowState = FormWindowState.Normal; Activate(); });
        menu.Items.Add("Sair", null, delegate { exiting = true; Close(); }); tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { Show(); WindowState = FormWindowState.Normal; Activate(); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) {
            if (!exiting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }
            StopAgent(); tray.Dispose();
        };
        LoadConfig();
        if (autoStart) Shown += delegate { SaveAndStart(); if (child != null) Hide(); };
    }
    TextBox Field(TableLayoutPanel panel, int row, string label, bool secret) {
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 10, 0, 0) }, 0, row);
        var box = new TextBox { Dock = DockStyle.Fill, UseSystemPasswordChar = secret, Margin = new Padding(0, 4, 0, 8) };
        panel.Controls.Add(box, 1, row); return box;
    }
    void LoadConfig() {
        string file = Path.Combine(configDir, "config.dat");
        if (!File.Exists(file)) return;
        try {
            byte[] bytes = ProtectedData.Unprotect(File.ReadAllBytes(file), null, DataProtectionScope.CurrentUser);
            var d = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(Encoding.UTF8.GetString(bytes));
            api.Text = d["api"]; key.Text = d["key"]; rub.Text = d["rub"]; user.Text = d["user"]; pass.Text = d["pass"];
            agentId = d["id"]; browser.SelectedIndex = d["browser"] == "chrome" ? 1 : 0;
            using (var run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) startup.Checked = run != null && run.GetValue("FlashubAgente") != null;
        } catch { Append("Não foi possível ler a configuração. Preencha novamente neste usuário do Windows."); }
    }
    void SaveAndStart() {
        if (child != null) return;
        Uri apiUri, rubUri;
        if (!Uri.TryCreate(api.Text.Trim(), UriKind.Absolute, out apiUri) ||
            !(apiUri.Scheme == "https" || (apiUri.Scheme == "http" && apiUri.IsLoopback)) ||
            !Uri.TryCreate(rub.Text.Trim(), UriKind.Absolute, out rubUri) || !(rubUri.Scheme == "https" || rubUri.Scheme == "http") ||
            !System.Text.RegularExpressions.Regex.IsMatch(key.Text.Trim(), "^flh_[a-f0-9]{64}$") ||
            String.IsNullOrWhiteSpace(user.Text) || String.IsNullOrEmpty(pass.Text)) {
            MessageBox.Show("Preencha a API HTTPS, a chave, o endereço e o login do RUB. HTTP para API só é aceito em localhost.", Text); return;
        }
        try {
            Directory.CreateDirectory(configDir);
            var data = new Dictionary<string, string> { {"api",api.Text.Trim()}, {"key",key.Text.Trim()}, {"rub",rub.Text.Trim()},
                {"user",user.Text.Trim()}, {"pass",pass.Text}, {"id",agentId}, {"browser",browser.SelectedIndex == 1 ? "chrome" : "msedge"} };
            var bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(data));
            var target = Path.Combine(configDir, "config.dat");
            var temporary = target + ".tmp";
            File.WriteAllBytes(temporary, ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser));
            if (File.Exists(target)) File.Replace(temporary, target, null); else File.Move(temporary, target);
            using (var run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) {
                if (startup.Checked) run.SetValue("FlashubAgente", "\"" + Application.ExecutablePath + "\" --autostart");
                else run.DeleteValue("FlashubAgente", false);
            }
            var info = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), "\"" + Path.Combine(root, "src", "agent.js") + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            info.EnvironmentVariables["FLASHUB_API"] = data["api"]; info.EnvironmentVariables["FLASHUB_KEY"] = data["key"];
            info.EnvironmentVariables["FLASHUB_AGENT_ID"] = data["id"]; info.EnvironmentVariables["RUB_URL"] = data["rub"];
            info.EnvironmentVariables["RUB_USER"] = data["user"]; info.EnvironmentVariables["RUB_PASS"] = data["pass"];
            info.EnvironmentVariables["FLASHUB_BROWSER"] = data["browser"];
            child = new Process { StartInfo = info, EnableRaisingEvents = true };
            child.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Append(e.Data); };
            child.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Append(e.Data); };
            child.Exited += delegate { if (!IsDisposed && IsHandleCreated) BeginInvoke((Action)delegate { child = null; SetRunning(false); }); };
            child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine(); SetRunning(true);
        } catch (Exception) { child = null; SetRunning(false); MessageBox.Show("Não foi possível iniciar. Verifique se o pacote foi extraído inteiro e se você pode gravar a configuração.", Text); }
    }
    void Append(string message) {
        if (IsDisposed || !IsHandleCreated) return;
        if (InvokeRequired) { BeginInvoke((Action)(() => Append(message))); return; }
        if (logs.TextLength > 40000) logs.Clear();
        logs.AppendText(message + Environment.NewLine);
        if (message.Contains("Online.")) status.Text = "Online • aguardando tarefas";
        else if (message.Contains("Sem conexão") || message.Contains("recusada")) status.Text = "Sem conexão • verifique a API e a chave";
    }
    void SetRunning(bool running) {
        connect.Enabled = !running; stop.Enabled = running;
        foreach (Control field in new Control[] { api, key, rub, user, pass, browser, startup }) field.Enabled = !running;
        status.Text = running ? "Conectando…" : "Desconectado";
    }
    void StopAgent() {
        var process = child;
        if (process == null) return;
        try { if (!process.HasExited) { process.StandardInput.WriteLine("stop"); process.StandardInput.Flush(); if (!process.WaitForExit(5000)) process.Kill(); } } catch { }
        child = null; SetRunning(false);
    }
}
static class Program {
    [STAThread] static int Main(string[] args) {
        if (Array.IndexOf(args, "--self-test") >= 0) {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            return File.Exists(Path.Combine(root, "runtime", "node.exe")) && File.Exists(Path.Combine(root, "src", "agent.js")) ? 0 : 1;
        }
        bool created;
        using (var mutex = new Mutex(true, @"Local\FlashubAgente", out created)) {
            if (!created) { MessageBox.Show("O Flashub Agente já está aberto. Procure o ícone na bandeja do Windows."); return 0; }
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new AgentForm(Array.IndexOf(args, "--autostart") >= 0));
        }
        return 0;
    }
}
