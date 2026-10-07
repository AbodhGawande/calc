#!/bin/zsh
# Installs (or updates) the Napkin iPhone-app updater: copies renew.py out of ~/Documents (so the background job
# never needs access to it) to /Applications/Abodh Apps/Helpers/napkin-renew.py, and loads a LaunchAgent that runs
# `napkin-renew.py renew` every 3 hours and at login. What the updater keeps (its phones, record, logs, cache) is in
# ~/Library/Abodh Apps Data/Napkin — see renew.py. On a new Mac: copy that folder over, then run this once.
# Undo: launchctl bootout gui/$UID/com.abodh.napkin.renew; rm ~/Library/LaunchAgents/com.abodh.napkin.renew.plist
set -e
HERE=${0:A:h}
HELPERS="/Applications/Abodh Apps/Helpers"
SCRIPT="$HELPERS/napkin-renew.py"
DATA="$HOME/Library/Abodh Apps Data/Napkin"
OLD="$HOME/Library/Application Support/Napkin/renew.py"      # where the script lived until 2026-10-07
PLIST="$HOME/Library/LaunchAgents/com.abodh.napkin.renew.plist"
launchctl bootout "gui/$UID/com.abodh.napkin.renew" 2>/dev/null || true      # first: nothing runs while files move
mkdir -p "$HELPERS" "$DATA/Logs"
if [[ -f "$OLD" && ! -e "$SCRIPT" ]]; then mv "$OLD" "$SCRIPT"; fi
cp "$HERE/renew.py" "$SCRIPT"
chmod +x "$SCRIPT"
/usr/bin/python3 "$SCRIPT" status       # (its first run also moves anything still in the old places)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.abodh.napkin.renew</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/python3</string>
		<string>$SCRIPT</string>
		<string>renew</string>
	</array>
	<key>StartInterval</key>
	<integer>10800</integer>
	<key>RunAtLoad</key>
	<true/>
	<key>Nice</key>
	<integer>10</integer>
	<key>StandardErrorPath</key>
	<string>$DATA/Logs/renew-errors.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$UID" "$PLIST"
echo "updater installed: every 3 hours · log $DATA/Logs/renew.log"
