#!/usr/bin/env python3
"""Napkin on the iPhones — pushes each new version over Wi-Fi, and renews the signing before it runs out
(1 year on the paid developer team; same idea as Chart Drills' ipads.py).

  renew.py status              the phones, when their app's signing runs out, and the last result
  renew.py renew               install on phones that are behind the last pushed version, or whose signing runs out
                               within 3 days (the LaunchAgent runs this every 3 hours)
  renew.py renew --now         reinstall on every phone it can reach, right now
  renew.py renew --now --only <UDID>   just that phone
  renew.py add <UDID> [name] [--when-locked | --locked-or-open] [--push-updates]
                               look after another phone (plug it in and trust this Mac once first);
                               --when-locked = only while the phone is locked (someone else's phone: never while in use);
                               --locked-or-open = only while locked OR while Napkin is running on it (someone else's);
                               --push-updates = (our own phones) install even while Napkin is open (it just closes)

A phone isn't updated while Napkin is open on it (an update closes the app) unless it has --push-updates or less than
12 hours of signing are left — also with --now (add --force to push anyway).
If Napkin has been removed from a phone, it is NOT put back (the phone is skipped until it's installed by hand).

It builds the last commit PUSHED to GitHub (AbodhGawande/calc, main), cloned into ~/Library/Caches/Napkin —
never the working folder, so a half-finished edit can't reach the phones, and the LaunchAgent never needs access to
~/Documents. Only the app is installed; the page and history saved on the phone are untouched.

Installed by tools/install-renewer.sh to ~/Library/Application Support/Napkin/renew.py
State: ~/Library/Application Support/Napkin/renew.json · log: ~/Library/Logs/Napkin/renew.log
"""
import datetime as dt, fcntl, glob, json, os, plistlib, shutil, subprocess, sys, tempfile, time

HOME = os.path.expanduser("~")
BID = "com.abodh.napkin"
REPO_URL = "https://github.com/AbodhGawande/calc.git"
STATE = f"{HOME}/Library/Application Support/Napkin/renew.json"
LOG = f"{HOME}/Library/Logs/Napkin/renew.log"
PROFILES = f"{HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles"
CACHE = f"{HOME}/Library/Caches/Napkin"
SRC = f"{CACHE}/src"
DERIVED = f"{CACHE}/build"
APP = f"{DERIVED}/Build/Products/Release-iphoneos/Napkin.app"
DUE = 3 * 86400            # renew when less than this is left
URGENT = 86400             # with less than a day left, say so if the phone can't be reached
BUSY_OK = 12 * 3600        # with more than this left, wait while Napkin is open on the phone
os.environ["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")


def notify(msg):
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "Napkin"'], capture_output=True)


def run(args, timeout=600, cwd=None):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, "", "timed out")


def load_state():
    try:
        return json.load(open(STATE))
    except Exception:
        return {"devices": {}}


def save_state(st):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    tmp = STATE + ".tmp"
    json.dump(st, open(tmp, "w"), indent=1, sort_keys=True)
    os.replace(tmp, STATE)


def paired_phones():
    """Every paired physical iPhone: {udid: name}."""
    with tempfile.TemporaryDirectory() as d:
        out = f"{d}/devices.json"
        run(["xcrun", "devicectl", "list", "devices", "--json-output", out, "-q"], 60)
        if not os.path.exists(out):
            return {}
        data = json.load(open(out))
    found = {}
    for x in data.get("result", {}).get("devices", []):
        hw = x.get("hardwareProperties", {})
        if hw.get("reality") == "physical" and hw.get("deviceType") == "iPhone":
            found[hw["udid"]] = x.get("deviceProperties", {}).get("name", "iPhone")
    return found


def reachable(udid):
    return run(["xcrun", "devicectl", "device", "info", "details", "--device", udid, "-q"], 60).returncode == 0


def app_open(udid):
    """True if Napkin is running on the phone (open, or still in memory), so an update would close it."""
    with tempfile.TemporaryDirectory() as d:
        out = f"{d}/procs.json"
        run(["xcrun", "devicectl", "device", "info", "processes", "--device", udid, "--json-output", out, "-q"], 60)
        if not os.path.exists(out):
            return False
        procs = json.load(open(out)).get("result", {}).get("runningProcesses", [])
    return any("Napkin.app/Napkin" in p.get("executable", "") for p in procs)


def installed(udid):
    """True/False if Napkin is / isn't on the phone; None if the phone didn't say. Uses the full app list (the
    filtered query sometimes wrongly comes back empty): an empty list means "didn't answer", so it asks up to 3 times.
    It's never put back on a phone where it was removed."""
    for attempt in range(3):
        with tempfile.TemporaryDirectory() as d:
            out = f"{d}/apps.json"
            r = run(["xcrun", "devicectl", "device", "info", "apps", "--device", udid, "--json-output", out, "-q"], 60)
            apps = json.load(open(out)).get("result", {}).get("apps", []) if r.returncode == 0 and os.path.exists(out) else []
        if apps:
            return any(a.get("bundleIdentifier") == BID for a in apps)
        time.sleep(3)
    return None


def locked(udid):
    """True if the phone is locked right now (asking doesn't wake or show anything on the phone)."""
    r = run(["xcrun", "devicectl", "device", "info", "lockState", "--device", udid], 60)
    return r.returncode == 0 and "passcodeRequired: true" in r.stdout


def profile_info(path):
    """(expiry as epoch seconds, provisioned device UDIDs, the whole profile) of a .mobileprovision."""
    r = subprocess.run(["security", "cms", "-D", "-i", path], capture_output=True)
    p = plistlib.loads(r.stdout)
    return p["ExpirationDate"].replace(tzinfo=dt.timezone.utc).timestamp(), set(p.get("ProvisionedDevices", [])), p


def current_profile():
    for f in glob.glob(f"{PROFILES}/*.mobileprovision"):
        try:
            exp, devices, p = profile_info(f)
        except Exception:
            continue
        if p.get("Entitlements", {}).get("application-identifier", "").endswith("." + BID):
            return f, exp, devices
    return None


def fetch_source():
    """The last pushed commit, in a clean clone; returns the short commit id."""
    if not os.path.isdir(f"{SRC}/.git"):
        shutil.rmtree(SRC, ignore_errors=True)
        os.makedirs(CACHE, exist_ok=True)
        r = run(["git", "clone", "-q", REPO_URL, SRC], 300)
    else:
        r = run(["git", "-C", SRC, "fetch", "-q", "origin", "main"], 300)
        if r.returncode == 0:
            r = run(["git", "-C", SRC, "reset", "-q", "--hard", "origin/main"], 60)
            run(["git", "-C", SRC, "clean", "-qfdx"], 60)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout).strip()[:300])
    return run(["git", "-C", SRC, "rev-parse", "--short", "HEAD"], 30).stdout.strip()


def app_tree():
    """Fingerprint of the app's own files in the clone: the web files it bundles + ios/ (README/tools don't count)."""
    r = run(["git", "-C", SRC, "ls-tree", "-r", "HEAD", "--", "index.html", "style.css", "manifest.webmanifest", "icons",
             "units.js", "engine.js", "rates.js", "convert.js", "help.js", "share.js", "app.js",
             "ios/Napkin", "ios/Napkin.xcodeproj", "ios/Napkin-Info.plist", "ios/Napkin.entitlements"], 30)
    if r.returncode or not r.stdout.strip():
        return None
    import hashlib
    return hashlib.sha1(r.stdout.encode()).hexdigest()[:12]


def build(udid=None):
    """Build for any iPhone (a locked phone makes a build aimed at it time out); aimed at one phone only to get a
    phone that's new to the developer account registered."""
    r = run(["xcodebuild", "-project", f"{SRC}/ios/Napkin.xcodeproj", "-scheme", "Napkin",
             "-configuration", "Release", "-destination", f"id={udid}" if udid else "generic/platform=iOS",
             "-derivedDataPath", DERIVED,
             "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration", "-quiet", "build"], 1800)
    errors = [l for l in (r.stdout + r.stderr).splitlines() if "error:" in l]
    return r.returncode == 0, errors


def renew(now_mode):
    st = load_state()
    devs = st.setdefault("devices", {})
    now = time.time()
    st["lastCheck"] = now
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv[:-1] else None
    latest = None                                    # the newest app version on GitHub
    if devs:
        try:
            fetch_source()
            latest = app_tree()
        except Exception as e:
            log(f"couldn't check GitHub for a new version: {e}")
    def newer(d):
        return bool(latest and d.get("appTree") != latest)
    need = [u for u, d in devs.items()
            if (only is None or u == only) and (now_mode or d.get("expires", 0) - now < DUE or newer(d))]
    if not need:
        save_state(st)
        return 0
    todo = []
    for u in need:
        d = devs[u]
        left = d.get("expires", 0) - now
        d["lastTry"] = now
        if (d.get("whenLocked") or d.get("lockedOrOpen")) and reachable(u) and not locked(u) \
                and not (d.get("lockedOrOpen") and app_open(u)):
            d["lastResult"] = "waiting: phone in use"
            log(f"{d.get('name', u)}: in use (unlocked{', Napkin not open' if d.get('lockedOrOpen') else ''}) — trying again later")
            continue
        if not reachable(u):
            if d.get("lastResult") != "not reachable":                 # once, not every 3 hours
                log(f"{d.get('name', u)}: not reachable (asleep, or not on this Wi-Fi) — trying again later")
            d["lastResult"] = "not reachable"
            if left < URGENT and now - d.get("lastNotified", 0) > 6 * 3600:
                d["lastNotified"] = now
                when = "has run out" if left <= 0 else "runs out " + dt.datetime.fromtimestamp(d.get("expires", now)).strftime("%a %b %-d, %-I:%M %p")
                notify(f"The app on {d.get('name', 'the iPhone')} {when}. Bring it onto home Wi-Fi and unlock it.")
            continue
        have = installed(u)
        if have is None:
            d["lastResult"] = "couldn't check the phone's apps"
            log(f"{d.get('name', u)}: couldn't read its app list — trying again later")
            continue
        if have is False:
            if d.get("lastResult") != "app removed from the phone":
                log(f"{d.get('name', u)}: Napkin isn't on this phone any more — not putting it back")
            d["lastResult"] = "app removed from the phone"
            continue
        if left > BUSY_OK and not d.get("pushUpdates") and not d.get("lockedOrOpen") and "--force" not in sys.argv \
                and app_open(u):                                              # also for manual pushes
            if d.get("lastResult") != "waiting: Napkin is open":
                log(f"{d.get('name', u)}: Napkin is open — trying again later")
            d["lastResult"] = "waiting: Napkin is open"
            continue
        todo.append(u)
    if not todo:
        save_state(st)
        return 0

    try:
        commit = fetch_source()
    except Exception as e:
        log(f"couldn't get the source from GitHub: {e}")
        for u in todo:
            devs[u]["lastResult"] = "couldn't get the source"
        save_state(st)
        return 1

    # a fresh signing profile when the current one would leave the phones short (Xcode fetches one on the next build)
    moved = None
    prof = current_profile()
    if prof is None or prof[1] - now < DUE + 12 * 3600:
        if prof:
            os.makedirs(f"{CACHE}/old-profiles", exist_ok=True)
            moved = f"{CACHE}/old-profiles/{os.path.basename(prof[0])}"
            shutil.move(prof[0], moved)
            log("asked Xcode for a fresh signing profile")

    built = False
    result = 0
    for u in todo:
        d = devs[u]
        prof = current_profile()
        new_phone = bool(prof and u not in prof[2])                  # not in the developer account's device list yet
        if not built or new_phone:
            ok, errors = build(u if new_phone else None)
            if not ok:
                log(f"build failed (commit {commit}): " + " | ".join(errors[:3]))
                if moved and current_profile() is None and os.path.exists(moved):
                    shutil.move(moved, f"{PROFILES}/{os.path.basename(moved)}")      # keep the old one working
                for v in todo:
                    devs[v]["lastResult"] = "build failed"
                save_state(st)
                return 1
            built = True
        exp, _, _ = profile_info(f"{APP}/embedded.mobileprovision")
        r = run(["xcrun", "devicectl", "device", "install", "app", "--device", u, APP, "-q"], 900)
        if r.returncode == 0:
            d.update(expires=exp, installed=now, lastResult="renewed", commit=commit, appTree=app_tree())
            log(f"{d.get('name', u)}: installed commit {commit}, signing good until "
                f"{dt.datetime.fromtimestamp(exp):%b %-d, %Y}")
        else:
            d["lastResult"] = "install failed"
            log(f"{d.get('name', u)}: install failed: {(r.stderr or r.stdout).strip()[:300]}")
            result = 1
    save_state(st)
    return result


def status():
    st = load_state()
    if not st.get("devices"):
        print("No phones yet — renew.py add <UDID> [name]")
    for u, d in st.get("devices", {}).items():
        exp = d.get("expires")
        until = dt.datetime.fromtimestamp(exp).strftime("%b %-d, %Y") if exp else "unknown"
        print(f"{d.get('name', u)}  ({u}){'  [only while locked]' if d.get('whenLocked') else ''}{'  [while locked or Napkin open]' if d.get('lockedOrOpen') else ''}{'  [even while open]' if d.get('pushUpdates') else ''}\n  signing good until {until} · last: {d.get('lastResult', '-')}"
              f" · commit {d.get('commit', '-')}")
    if st.get("lastCheck"):
        print(f"last check {dt.datetime.fromtimestamp(st['lastCheck']):%a %-I:%M %p}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd in ("renew", "add"):                   # anything that writes the state: one at a time
        os.makedirs(CACHE, exist_ok=True)
        lock = open(f"{CACHE}/renew.lock", "w")
        fcntl.flock(lock, fcntl.LOCK_EX)
    if cmd == "renew":
        sys.exit(renew("--now" in sys.argv))
    elif cmd == "add" and len(sys.argv) >= 3:
        st = load_state()
        udid = sys.argv[2]
        args = [a for a in sys.argv[3:] if not a.startswith("--")]
        name = args[0] if args else paired_phones().get(udid, "iPhone")
        dev = st.setdefault("devices", {}).setdefault(udid, {})
        dev["name"] = name
        if "--when-locked" in sys.argv:
            dev["whenLocked"] = True
            dev.pop("lockedOrOpen", None)
        if "--locked-or-open" in sys.argv:
            dev["lockedOrOpen"] = True
            dev.pop("whenLocked", None)
        if "--push-updates" in sys.argv:
            dev["pushUpdates"] = True
        save_state(st)
        print(f"added {name} ({udid})"
              + (" · only while locked" if dev.get("whenLocked") else "")
              + (" · only while locked or while Napkin is open" if dev.get("lockedOrOpen") else "")
              + (" · updated even while Napkin is open" if dev.get("pushUpdates") else ""))
    elif cmd == "status":
        status()
    else:
        print(__doc__)
        sys.exit(2)
