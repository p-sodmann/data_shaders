# Kiosk: MARS on a wall display

A small computer with a browser in kiosk mode, opening MARS from the stack in
[deploy/](README.md). The stack can run on the same machine or anywhere on the LAN.

## Hardware

| | Good for | Notes |
|---|---|---|
| **Raspberry Pi 5** (4 or 8 GB) | a 1080p panel at 60 fps; a 4K panel at 30 fps with half-resolution rendering (below) | Raspberry Pi OS (64-bit, Bookworm or later, Wayland/labwc). Use the official 27 W supply and a cooler: the GPU runs all the time. |
| **Mini PC** (Intel N100 or better, any iGPU from the last few years) | 1080p or 4K at 60 fps | Any desktop Linux with Chromium or Chrome. |

*Not yet measured on a Pi 5.* On an Apple M4 Pro the Fleet page with 16 stations takes about
1.8 ms of CPU per frame (step 10). Check your own device as below before you settle on `fps`.

The display needs WebGL2. Open `chrome://gpu` once: *WebGL2* should read "Hardware
accelerated". If it says software only, add `--ignore-gpu-blocklist` to the flags below.

## The URL

```
http://mars.lan:8080/?fps=30&dpr=1&page=7
```

- `fps`: frames per second (default 60, the document's `device.fps`). 30 halves the GPU load and
  still looks smooth for a CRT that only moves slowly.
- `dpr`: the *highest* pixel ratio MARS renders at. It caps the browser's `devicePixelRatio`
  and never raises it.
- `page=7` starts on a page (here *Fleet* in the demo config); `cycle=120` rotates pages every
  120 s instead.
- URL parameters win over the config document for that display only. To set them for every
  display, put them in the document's `device` block.

### Which `fps` and `dpr` for which panel

| Panel | Chromium flag | URL | Rendered at |
|---|---|---|---|
| 1080p | – | defaults (`fps=60`) | 1920 × 1080 |
| 4K, Pi 5 | `--force-device-scale-factor=2` | `?fps=30&dpr=1` | 1920 × 1080, scaled up by the compositor |
| 4K, mini PC | `--force-device-scale-factor=2` | `?dpr=1.5` | 2880 × 1620 |
| 4K, strong GPU | `--force-device-scale-factor=2` | defaults (`dpr=2`) | 3840 × 2160 |

Without `--force-device-scale-factor`, a 4K panel at 100 % scale has a `devicePixelRatio` of 1,
so MARS renders all 3840 × 2160 pixels whatever `dpr` says, and the housing's text is tiny. The
phosphor glow and scanlines hide the upscaling well, so half resolution is the first thing to
try on weak hardware.

**Measure it.** Open the page with a keyboard attached, press `F12`, and run
`__mars.frames()` in the console. It gives the mean and 95th-percentile CPU milliseconds per
frame over the last 240 frames. At 60 fps a frame has 16.7 ms; keep the p95 well below that, or
use `fps=30` (33 ms).

## Chromium in kiosk mode

```bash
chromium --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --disable-features=Translate \
  --check-for-update-interval=31536000 --password-store=basic \
  --force-device-scale-factor=2 \
  'http://mars.lan:8080/?fps=30&dpr=1&page=7'
```

The command is `chromium-browser` on older Raspberry Pi OS releases and `google-chrome` on a
mini PC with Chrome. Leave out `--force-device-scale-factor` on a 1080p panel.

- `--kiosk`: fullscreen, no window frame, no address bar. (`F` in MARS is fullscreen inside a
  normal window instead.)
- `--noerrdialogs`, `--disable-session-crashed-bubble`: no "restore pages?" bar after a power
  cut.
- `--password-store=basic`: no keyring prompt at start.
- `--check-for-update-interval`: no update nag over the display.

**Lock the device** so people walking by can't open the service panel: *Lock* in the
service panel (`E`), or `"locked": true` in the document's `device` block. Hold `SERVICE` for
2 s, or open the URL with `?unlock=1`, to get back in.

## Screen blanking off

- **Raspberry Pi OS:** `sudo raspi-config nonint do_blanking 1` (1 turns blanking off), then
  reboot. The same setting is under *Display Options → Screen Blanking*.
- **X11 desktops:** `xset s off -dpms` in the autostart script, before Chromium.
- **GNOME:** `gsettings set org.gnome.desktop.session idle-delay 0` and
  `gsettings set org.gnome.settings-daemon.plugins.power idle-dim false`.

Some panels go to sleep on their own: switch off the panel's eco or auto-standby setting too.

## Start on boot

1. Log in automatically to the desktop. Raspberry Pi OS:
   `sudo raspi-config nonint do_boot_behaviour B4` (desktop, auto-login).
2. Save the start script as `~/mars-kiosk.sh` and make it executable (`chmod +x`). The loop
   restarts Chromium if it crashes or is closed:

   ```bash
   #!/bin/sh
   URL='http://mars.lan:8080/?fps=30&dpr=1&page=7'
   # Wait for the network and the MARS stack (/healthz answers 200 without auth).
   until curl -fs -o /dev/null http://mars.lan:8080/healthz; do sleep 2; done
   while true; do
     chromium --kiosk --noerrdialogs --disable-infobars --no-first-run \
       --disable-session-crashed-bubble --disable-features=Translate \
       --check-for-update-interval=31536000 --password-store=basic \
       --force-device-scale-factor=2 "$URL"
     sleep 2
   done
   ```

3. Start it with the desktop:
   - **Raspberry Pi OS (labwc):** add the line `/home/pi/mars-kiosk.sh &` to
     `~/.config/labwc/autostart` (create the file if it isn't there).
   - **Other desktops (XDG autostart):** `~/.config/autostart/mars-kiosk.desktop`:

     ```ini
     [Desktop Entry]
     Type=Application
     Name=MARS kiosk
     Exec=/home/pi/mars-kiosk.sh
     X-GNOME-Autostart-enabled=true
     ```

Change `/home/pi` to your user's home directory. To restart the browser once a day (it has been
tested for hours, not weeks), add a cron job: `0 4 * * * pkill -f chromium`. The loop
starts it again, and the display refills its tape from Prometheus within a few seconds.

## Basic auth and kiosks

With `MARS_BASIC_AUTH` set ([README.md](README.md#security)), Chromium asks for the password
once per browser start and keeps it until the browser closes. The restart loop above means you
would type it after every crash or restart, so an unattended wall display is easier on a
trusted network without auth. Keep auth for displays that are reachable from outside that
network.
