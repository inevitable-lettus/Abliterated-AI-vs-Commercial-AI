# Uncensored AI vs Commercial AI

A live demo. One question goes to two AI models at once, and both answers stream side by side on a projector.

- **Left, UNCENSORED:** an uncensored local model running in Ollama on Krish's laptop.
- **Right, COMMERCIAL:** Google Gemini Flash, with Google's normal safety filters.

For how it works and why it's built this way, see [dev_notes.md](dev_notes.md).

---

## Running the demo

### 1. Start it
Open Terminal and run:
```bash
cd ~/Documents/code/uncensored-ai-UI
./start.sh
```
Wait until you see `Uvicorn running on http://127.0.0.1:8000`, then open **http://localhost:8000** in Chrome. Press **Cmd+Ctrl+F** for fullscreen.

Leave that Terminal window open. Closing it stops the demo.

### 2. Connect Krish's laptop
Get on the same phone hotspot as Krish. When he sends you his IP address, run this in a **second** Terminal window:
```bash
cd ~/Documents/code/uncensored-ai-UI
./connect-krish.sh 172.20.10.x
```
Use his actual IP in place of `172.20.10.x`. It prints ✓ if the connection works, or explains what's wrong if it doesn't. You don't need to restart anything.

### 3. Check the status dots
Each panel title has a dot:
- 🟢 **green:** the model is ready.
- 🔴 **red:** there's a problem. The reason is shown next to the dot, e.g. `offline` or `no API key`.

### 4. Controls

| Do this | What happens |
|---|---|
| Type a question, press **Enter** (or SEND) | Both AIs answer at the same time. |
| Press **Esc** (or the red **KILL** button) | **Emergency cut.** Both answers stop at once and the screen goes blank ("STANDBY"). |
| Press **Esc** again (or double-click) | Brings the chat back. |
| **CLEAR** button | Wipes both panels for a fresh start. |

Sending a new question while answers are still coming in cuts the old ones off. If one side fails (for example, Krish's laptop drops off), only that panel shows an error, and the other side keeps working.

### 5. Stop it
Click the Terminal window running `./start.sh` and press **Ctrl+C**.

### The question log
Every question, with both answers, is saved to **`log.md`** in this folder. Answers that were blocked, failed, or cut off by the kill switch are logged too, and marked as such. The file stays on your laptop and is not committed to git.

---

## One-time setup

### This Mac
You need Node 22+, Python 3.12+, and [uv](https://docs.astral.sh/uv/).
```bash
cp .env.example .env
cd frontend && npm install && cd ..
cd backend && uv sync && cd ..
```
`./start.sh` also installs the frontend packages if they're missing.

### Gemini API key
1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key**.
3. Paste the key into `.env` as `GEMINI_API_KEY=...`.

**Enable billing on the key's Google Cloud project before the event.** The free tier allows only 20 requests per model per day, which a demo uses up fast. Paid usage for a few hours of Flash costs very little.

### Krish's laptop (Windows, Ollama host)
The model tag is already set as `OLLAMA_MODEL` in `.env`.

**Before the event (once):**
1. Make Ollama accept network connections and keep the model loaded. In a normal terminal, run:
   ```powershell
   setx OLLAMA_HOST 0.0.0.0:11434
   setx OLLAMA_KEEP_ALIVE -1
   ```
   Then **quit Ollama from its tray icon** (right-click the llama → Quit) and open it again. Closing the window alone doesn't pick up the change.
2. Open port 11434. In **PowerShell as Administrator**, run:
   ```powershell
   New-NetFirewallRule -DisplayName "Ollama API (TCP 11434)" -Direction Inbound -Protocol TCP -LocalPort 11434 -RemoteAddress LocalSubnet -Profile Public,Private -Action Allow
   ```
   If a "Windows Security Alert" pops up for Ollama, click **Allow**. Clicking Cancel creates a block rule that overrides this one.
3. Check that it works locally:
   ```powershell
   Invoke-RestMethod http://localhost:11434/api/tags | Select-Object -ExpandProperty models | Select-Object name
   ```
   The output must list the model tag from `OLLAMA_MODEL`.
4. Stop the laptop sleeping: Settings → System → Power → Screen and sleep → **Never** (plugged in).

**At the event:**
1. Join the **same phone hotspot** as Garv. Guest or venue Wi-Fi blocks laptop-to-laptop traffic.
2. Preload the model so the first answer is fast:
   ```powershell
   Invoke-RestMethod http://localhost:11434/api/generate -Method Post -Body '{"model":"<OLLAMA_MODEL tag>","keep_alive":-1}'
   ```
3. Get the laptop's IP and send it to Garv. On an iPhone hotspot it looks like `172.20.10.x`.
   ```powershell
   (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias Wi-Fi).IPAddress
   ```

**Security:** Ollama has no password, so anyone on the network can use it, including downloading or deleting models. Only expose it on your own hotspot. Afterwards, Krish can undo it with `setx OLLAMA_HOST 127.0.0.1:11434`, then restart Ollama and remove the firewall rule.

<details><summary>If Krish uses a Mac instead</summary>

```bash
launchctl setenv OLLAMA_HOST "0.0.0.0:11434"
launchctl setenv OLLAMA_KEEP_ALIVE "-1"
```
Then quit and reopen Ollama, click Allow on the firewall prompt, and get the IP with `ipconfig getifaddr en0`.
</details>

---

## Settings (`.env`)

| Setting | What it does |
|---|---|
| `OLLAMA_URL` | Krish's Ollama address. `./connect-krish.sh` sets it for you. Re-read live, so no restart is needed. |
| `OLLAMA_MODEL` | The exact Ollama model tag. Also re-read live. |
| `GEMINI_API_KEY` | Your Gemini key. It stays on the server and never reaches the browser. |
| `GEMINI_MODEL` | The main Gemini model (currently `gemini-3.8-flash`). |
| `GEMINI_FALLBACK_MODELS` | Comma-separated backups, tried in order when the main model is overloaded (503), rate-limited (429), or silent for 10 s. The panel then shows a small "via …" note. |
| `GEMINI_THINKING` | Gemini's thinking level. Default `minimal`, which about halves the time to the first word. If a model rejects it, the app steps down to `low` and then to the model's default. |
| `UNCENSORED_SYSTEM_PROMPT` / `GUARDED_SYSTEM_PROMPT` | Override the built-in system prompts. Both defaults ask for answers of about 200 words. |

Changing any Gemini setting or system prompt needs a restart: press Ctrl+C, then run `./start.sh`.

## Development
To get hot reload, run the backend and frontend in two terminals:
```bash
cd backend && uv run uvicorn main:app --reload --port 8000
```
```bash
cd frontend && npm run dev
```
Then open the Vite URL. `/api` is proxied to port 8000. [dev_notes.md](dev_notes.md) covers the architecture, every design decision, and how to test without real models.
