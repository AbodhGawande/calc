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

A phone isn't updated while Napkin is open on it and the phone is unlocked (an update closes the app) unless it has
--push-updates or less than 12 hours of signing are left — also with --now (add --force to push anyway). A locked
phone is updated even if Napkin was left open on it.
If Napkin has been removed from a phone, it is NOT put back (the phone is skipped until it's installed by hand).

It builds the last commit PUSHED to GitHub (AbodhGawande/calc, main), cloned into its Cache folder — never the
working folder, so a half-finished edit can't reach the phones, and the LaunchAgent never needs access to ~/Documents.
Only the app is installed; the page and history saved on the phone are untouched.

Installed by tools/install-renewer.sh as /Applications/Abodh Apps/Helpers/napkin-renew.py. What it keeps is in
~/Library/Abodh Apps Data/Napkin (the scheme every app follows, ~/Documents/Claude/Abodh Apps Data.md):
  settings.json      which phones it looks after, and how each may be updated (what `add` was told)
  Data/updater.json  its own record of each phone: signing date, installed version, last result
  Logs/renew.log     what it did
  Cache/             the clone, the build, set-aside signing profiles (and the guide's photos, tools/make_intro.py)
Until 2026-10-07 these were in ~/Library/Application Support/Napkin, ~/Library/Logs/Napkin and
~/Library/Caches/Napkin; move_in() moves them over once.
"""
import datetime as dt, fcntl, glob, json, os, plistlib, shutil, subprocess, sys, tempfile, time

HOME = os.path.expanduser("~")
BID = "com.abodh.napkin"
REPO_URL = "https://github.com/AbodhGawande/calc.git"
DATA_HOME = f"{HOME}/Library/Abodh Apps Data/Napkin"
SETTINGS = f"{DATA_HOME}/settings.json"
STATE = f"{DATA_HOME}/Data/updater.json"
LOG = f"{DATA_HOME}/Logs/renew.log"
CACHE = f"{DATA_HOME}/Cache"
OLD_STATE = f"{HOME}/Library/Application Support/Napkin/renew.json"      # where things were until 2026-10-07
OLD_LOGS = f"{HOME}/Library/Logs/Napkin"
OLD_CACHE = f"{HOME}/Library/Caches/Napkin"
CHOSEN = ("name", "pushUpdates", "whenLocked", "lockedOrOpen")           # a phone's settings; the rest is the record
PROFILES = f"{HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles"
SRC = f"{CACHE}/src"
DERIVED = f"{CACHE}/build"
APP = f"{DERIVED}/Build/Products/Release-iphoneos/Napkin.app"
DUE = 3 * 86400            # renew when less than this is left
URGENT = 86400             # with less than a day left, say so if the phone can't be reached
BUSY_OK = 12 * 3600        # with more than this left, wait while Napkin is open on the phone
os.environ["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"


def log(msg):
    for path in (LOG, f"{OLD_LOGS}/renew.log"):      # the old place only if the new one can't be written
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a") as f:
                f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")
            return
        except OSError:
            continue


def notify(msg):
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "Napkin"'], capture_output=True)


def run(args, timeout=600, cwd=None):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, "", "timed out")


def read(path, default):
    try:
        return json.load(open(path))
    except Exception:
        return default


def write(path, value):
    """Write a file whole (never half), and only when it would change."""
    text = json.dumps(value, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    try:
        if open(path).read() == text:
            return
    except Exception:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        f.write(text)
    os.replace(path + ".tmp", path)


def move_in():
    """Once: bring what the updater kept in macOS's general folders into ~/Library/Abodh Apps Data/Napkin.
    Things are moved, never copied, and nothing that wasn't moved is deleted. Whatever can't be moved stays in use
    where it is (see load_state) and is tried again on the next run."""
    moved, problems = [], []

    def move(old, new):
        if not os.path.lexists(old):
            return
        if os.path.lexists(new):
            problems.append(f"{old} was left where it was: {new} already exists")
            return
        try:
            os.makedirs(os.path.dirname(new), exist_ok=True)
            shutil.move(old, new)
            moved.append(f"{old} → {new}")
        except Exception as e:
            problems.append(f"{old} could not be moved: {e}")

    # the one old file held both the phones' settings and the updater's record of them: it becomes two
    if os.path.exists(OLD_STATE) and not os.path.exists(SETTINGS) and not os.path.exists(STATE):
        try:
            save_state(json.load(open(OLD_STATE)), moving=True)
            if load_state() != json.load(open(OLD_STATE)):
                raise ValueError("the new files don't say what the old one did")
            os.remove(OLD_STATE)
            moved.append(f"{OLD_STATE} → {SETTINGS} + {STATE}")
        except Exception as e:
            for f in (SETTINGS, STATE):              # leave no half-made new files: the old one stays in charge
                if os.path.exists(f):
                    os.remove(f)
            problems.append(f"{OLD_STATE} could not be moved: {e}")
    for name in ("renew.log", "renew-errors.log"):
        move(f"{OLD_LOGS}/{name}", f"{DATA_HOME}/Logs/{name}")
    if os.path.isdir(OLD_CACHE):
        for name in sorted(os.listdir(OLD_CACHE)):
            move(f"{OLD_CACHE}/{name}", f"{CACHE}/{name}")
    for line in moved:
        log("moved: " + line)
    for line in problems:
        log("NOT moved: " + line)
    for folder in (OLD_LOGS, OLD_CACHE, os.path.dirname(OLD_STATE)):
        try:
            os.rmdir(folder)                          # only goes if it's empty
            log(f"removed the old folder, now empty: {folder}")
        except OSError:
            pass
    return moved, problems


def still_old():
    """True while the move hasn't worked: the old file stays in charge."""
    return os.path.exists(OLD_STATE) and not os.path.exists(SETTINGS)


def load_state():
    """Every phone looked after: its settings (settings.json) together with the updater's record of it."""
    if still_old():
        return read(OLD_STATE, {"devices": {}})
    record = read(STATE, {})
    st = {k: v for k, v in record.items() if k != "devices"}
    st["devices"] = {u: {**record.get("devices", {}).get(u, {}), **chosen}
                     for u, chosen in read(SETTINGS, {}).get("phones", {}).items()}
    return st


def save_state(st, moving=False):
    if still_old() and not moving:
        return write(OLD_STATE, st)
    devs = st.get("devices", {})
    settings = read(SETTINGS, {})
    settings["phones"] = {u: {k: d[k] for k in CHOSEN if k in d} for u, d in devs.items()}
    write(SETTINGS, settings)
    write(STATE, {**{k: v for k, v in st.items() if k != "devices"},
                  "devices": {u: {k: v for k, v in d.items() if k not in CHOSEN} for u, d in devs.items()}})


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
             "units.js", "engine.js", "rates.js", "convert.js", "help.js", "share.js", "intro.js", "app.js", "intro",
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
                and app_open(u) and not locked(u):        # (a locked phone isn't being used, even with Napkin left open)
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
    for line in move_in()[1]:
        print("not moved:", line)
    try:
        os.makedirs(CACHE, exist_ok=True)
    except OSError:                               # the new home can't be used: carry on in the old cache folder
        CACHE = OLD_CACHE
        SRC, DERIVED = f"{CACHE}/src", f"{CACHE}/build"
        APP = f"{DERIVED}/Build/Products/Release-iphoneos/Napkin.app"
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
