#!/bin/zsh
# Installs (or updates) the Tote iPhone-app renewer: copies renew.py out of ~/Documents (so the background job
# never needs access to it) and loads a LaunchAgent that runs `renew.py renew` every 3 hours and at login.
# Undo: launchctl bootout gui/$UID/com.abodh.tote.renew; rm ~/Library/LaunchAgents/com.abodh.tote.renew.plist
set -e
HERE=${0:A:h}
DEST="$HOME/Library/Application Support/Tote"
PLIST="$HOME/Library/LaunchAgents/com.abodh.tote.renew.plist"
mkdir -p "$DEST" "$HOME/Library/Logs/Tote"
cp "$HERE/renew.py" "$DEST/renew.py"
chmod +x "$DEST/renew.py"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.abodh.tote.renew</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/python3</string>
		<string>$DEST/renew.py</string>
		<string>renew</string>
	</array>
	<key>StartInterval</key>
	<integer>10800</integer>
	<key>RunAtLoad</key>
	<true/>
	<key>Nice</key>
	<integer>10</integer>
	<key>StandardErrorPath</key>
	<string>$HOME/Library/Logs/Tote/renew-errors.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$UID/com.abodh.tote.renew" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "renewer installed: every 3 hours · log ~/Library/Logs/Tote/renew.log"
