# First deploy walkthrough

Command-by-command path from this local folder to a working staging URL. Do the
steps in order. Replace `<...>` placeholders with your own values.

**What you need**

- A GitHub account and this folder (`C:\Users\khmer\PlantLegacy`).
- Git for Windows (already installed).
- Optional locally: Docker Desktop (to test compose on Windows).
- A free Ubuntu VM (Oracle Cloud Always Free, Google Cloud free tier, AWS free
  tier, Azure free tier — any one with Docker and a public IP).
- HTTPS for the server. GitHub Pages is HTTPS, so an `http://` API will be
  blocked by the browser as mixed content. Use Caddy + DuckDNS, or a Cloudflare
  quick tunnel (both below).

---

## 1. Commit and push to GitHub (Windows PowerShell)

Create an **empty** repository on GitHub first: <https://github.com/new>.
Name it `PlantLegacy`. Do **not** add a README, .gitignore or license.

```powershell
cd C:\Users\khmer\PlantLegacy

git config --global user.name "Your Name"
git config --global user.email "you@example.com"

git add .
git commit -m "T00 + O01: foundation, config, CI, deploy skeleton"
git branch -M main

git remote add origin https://github.com/PlantLegacyGame/PlantLegacy.git
git push -u origin main
```

When Git asks for a password, GitHub no longer accepts your account password.
Use one of:

- **Git Credential Manager** (bundled with Git for Windows): a browser window
  opens; sign in and approve.
- **Personal access token**: GitHub → Settings → Developer settings → Personal
  access tokens → Fine-grained tokens → repository access = only this repo →
  Contents = Read and write. Paste the token as the password.

Check <https://github.com/PlantLegacyGame/PlantLegacy/actions>: the `ci` workflow
should run. Fix any red step before continuing.

---

## 2. Enable GitHub Pages and the staging variable

In the GitHub repository:

1. **Settings → Pages → Build and deployment → Source = GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository
   variable**
   - Name: `STAGING_SERVER_ORIGIN`
   - Value: the HTTPS origin of your server, for example
     `https://plantlegacy.duckdns.org`
   - No trailing slash, no path.
3. After the variable exists, run **Actions → deploy-staging → Re-run all jobs**
   (or push another commit).

Your client URL is:

```text
https://plantlegacygame.github.io/PlantLegacy/
```

If `STAGING_SERVER_ORIGIN` is empty, the page will load but report the server as
unreachable, because it calls `/health` on the Pages host.

---

## 3. Optional: test compose locally with Docker Desktop

Download Docker Desktop for Windows from
<https://www.docker.com/products/docker-desktop/>. Install it, enable the WSL 2
backend when prompted, and restart if asked.

Verify in PowerShell:

```powershell
docker --version
docker compose version
```

Run the stack:

```powershell
cd C:\Users\khmer\PlantLegacy
docker compose -f ops/compose.yml up -d --build
docker compose -f ops/compose.yml ps
curl.exe http://127.0.0.1:8080/health
curl.exe http://127.0.0.1:8080/ready
```

Expected: `/health` returns `"status":"ok"` and `"database":"ok"`; `/ready`
returns 200. Stop it with:

```powershell
docker compose -f ops/compose.yml down
```

Data stays in the `pgdata` volume. `down -v` deletes it (see the password note in
step 6).

---

## 4. Create the VM and install Docker (Ubuntu)

Create an Ubuntu 24.04 LTS VM with at least 1 GB RAM and 20 GB disk. Note its
public IP. In the provider's firewall/security list, allow:

- TCP 22 (SSH)
- TCP 80 and 443 (HTTPS/reverse proxy)
- TCP 8080 only if you are testing directly by IP (close it later)

Connect from PowerShell:

```powershell
ssh ubuntu@<VM_PUBLIC_IP>
```

On the VM, install Docker Engine and the Compose plugin:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker "$USER"
newgrp docker

docker --version
docker compose version
```

If `newgrp` is awkward, log out and back in, then run `docker ps`.

Clone the repository:

```bash
cd ~
git clone https://github.com/PlantLegacyGame/PlantLegacy.git
cd PlantLegacy
```

---

## 5. Give the server HTTPS

Pick **one** option.

### Option A — Caddy + DuckDNS (stable free subdomain)

1. Go to <https://www.duckdns.org>, create a subdomain (for example
   `plantlegacy`), and point it at the VM's public IP.
2. On the VM, install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt update
sudo apt install -y caddy
```

3. Edit `/etc/caddy/Caddyfile`:

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace the contents with (use your DuckDNS name):

```caddyfile
plantlegacy.duckdns.org {
    reverse_proxy 127.0.0.1:8080
}
```

4. Reload and check:

```bash
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Caddy obtains a free Let's Encrypt certificate automatically. Your server origin
is `https://plantlegacy.duckdns.org`.

### Option B — Cloudflare quick tunnel (fastest, temporary URL)

No domain needed, but the URL changes every time the tunnel restarts.

```bash
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel --url http://127.0.0.1:8080
```

It prints a URL like `https://random-words.trycloudflare.com`. Use that as
`STAGING_SERVER_ORIGIN`. Keep the terminal open; stopping it kills the tunnel.

---

## 6. Start the stack on the VM

Create `ops/.env` on the VM (never commit it):

```bash
cd ~/PlantLegacy

cat > ops/.env <<'EOF'
NODE_ENV=staging
POSTGRES_PASSWORD=replace-with-a-long-hex-password
CORS_ORIGINS=https://plantlegacygame.github.io
EOF

chmod 600 ops/.env
```

Generate a safe password with:

```bash
openssl rand -hex 24
```

Use **hex**, not base64: `+`, `/` and `=` break the `DATABASE_URL`.

`CORS_ORIGINS` is the **Pages origin**, scheme + host only — for example
`https://plantlegacygame.github.io`, not the `/PlantLegacy/` path.

Start:

```bash
docker compose --env-file ops/.env -f ops/compose.yml up -d --build
docker compose --env-file ops/.env -f ops/compose.yml ps
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ready
```

Expected: both return 200; `/health` shows `"database":"ok"`.

**Password note.** Postgres reads `POSTGRES_PASSWORD` only when it first
initialises the volume. If you change the password later, the server will fail to
authenticate. Either keep the original password or reset the volume with
`docker compose ... down -v` (this deletes all data).

If you used Option A, test from your PC:

```powershell
curl.exe https://plantlegacy.duckdns.org/health
curl.exe https://plantlegacy.duckdns.org/ready
```

---

## 7. Connect the two halves

1. GitHub → Settings → Secrets and variables → Actions → Variables:
   set `STAGING_SERVER_ORIGIN` to the HTTPS server origin from step 5.
2. On the VM, confirm `CORS_ORIGINS` is the Pages origin, then restart the
   server so it picks up the value:

```bash
docker compose --env-file ops/.env -f ops/compose.yml up -d
```

3. GitHub → Actions → `deploy-staging` → Re-run all jobs.
4. Open `https://plantlegacygame.github.io/PlantLegacy/`.

You should see “Server ok”, the version, uptime, `database: ok`, and
`configs: 73 file(s)`.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser console: CORS policy error | `CORS_ORIGINS` does not include the exact Pages origin. Use `https://plantlegacygame.github.io` (no path), restart the server. |
| Browser console: mixed content | Pages is HTTPS and the API is HTTP. Put HTTPS in front of the server (step 5). |
| Page says “Server unreachable” | `STAGING_SERVER_ORIGIN` is empty or wrong. Fix the repository variable and re-run the deploy workflow. |
| Pages 404 | Settings → Pages → Source must be **GitHub Actions**; check the `deploy-staging` run. |
| `permission denied ... docker.sock` | `sudo usermod -aG docker $USER`, then log out and back in. |
| `port is already allocated` | Something else uses 8080/5432: `sudo ss -ltnp \| grep -E '8080\|5432'`. |
| `password authentication failed` | The `pgdata` volume was created with a different password. Restore the old password or `down -v` (data loss). |
| CI fails at `pnpm install --frozen-lockfile` | `pnpm-lock.yaml` was not committed. Commit it and push. |
| `/ready` is 503 | Postgres is not reachable yet. `docker compose ... logs postgres` and `... logs server`. |

---

## 9. Security checklist

- [ ] `ops/.env` is not committed (`git status` must not list it).
- [ ] `POSTGRES_PASSWORD` is long and random (hex).
- [ ] Only 22/80/443 are open publicly; 5432 is bound to `127.0.0.1`.
- [ ] `CORS_ORIGINS` contains only your client origin.
- [ ] The GitHub token is scoped to this repository.
- [ ] `curl https://<server-origin>/health` works and `http://` is not exposed.
