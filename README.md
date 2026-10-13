# TwinView

Two people open the same website. One shares their screen. The other watches and can take mouse & keyboard control.

No Node.js build step — static HTML/CSS/JS + PeerJS (WebRTC). Deploy to **Vercel** or **GitHub Pages**.

## How it works

| Role | What they do |
|------|----------------|
| **Host** | Opens TwinView → Share my screen → creates a 6-letter room code → allows screen capture |
| **Guest** | Opens TwinView → Join a room → enters the code → sees the screen → Request control |

Screen video goes **peer-to-peer** (WebRTC). Signaling uses the public PeerJS cloud (no server you manage).

Browsers cannot inject mouse/keyboard into Windows by themselves. For **real control**, the host also runs the local agent in `host-agent/`.

## Local preview

Open `index.html` via a local static server (required for some browser APIs):

```powershell
cd web-remote
# If you have Python:
python -m http.server 5173
```

Then visit `http://localhost:5173`.

Or deploy (recommended) and use the HTTPS URL — screen share needs a secure context.

## Deploy to Vercel

1. Push this `web-remote` folder (or the whole repo) to GitHub.
2. In [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Set **Root Directory** to `web-remote` if the repo root is the parent folder.
4. Framework: **Other** (static). Build command empty. Output: `.`
5. Deploy. Both users open the Vercel URL.

### Deploy only this folder with Vercel CLI

```bash
cd web-remote
npx vercel
```

## Deploy to GitHub Pages

1. Put the contents of `web-remote` on the `gh-pages` branch (or `/docs`), or use Actions to publish this folder.
2. Enable Pages in the repo settings.
3. Open `https://<user>.github.io/<repo>/`.

## Enable remote control (Windows host)

1. On the **host PC**, double-click `host-agent\Start-ControlAgent.bat`  
   (or run `Start-ControlAgent.ps1` in PowerShell).
2. Leave that window open.
3. In TwinView, start sharing. Status should show **Control agent connected**.
4. When the guest clicks **Request control**, approve the prompt.

If binding fails, run once in **Admin** PowerShell:

```powershell
netsh http add urlacl url=http://127.0.0.1:8765/ user=%USERNAME%
```

## Privacy & safety

- Only share with people you trust. Control means they can click and type on your PC.
- Traffic is peer-to-peer after connect; the PeerJS broker sees signaling IDs, not your screen pixels.
- Stop sharing or leave the room to end the session. Close the control agent when finished.

## Requirements

- Chrome or Edge recommended (screen share + WebRTC).
- Host and guest both need network access (UDP/TCP for WebRTC; some strict NATs may need a TURN server for rare cases).
- Control agent: Windows PowerShell (.NET HttpListener + WebSockets).
