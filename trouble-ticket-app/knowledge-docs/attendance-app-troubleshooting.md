# Attendance App - Troubleshooting Guide

## GPS/Location Issues

### Problem: "GPS coordinates not found" or "Unable to determine location"
**Symptoms:** Cannot check in, app shows location error, map shows wrong position
**Common Causes:** Location services disabled, app lacks GPS permission, poor GPS signal indoors

**Solution Steps:**
1. Open phone Settings → Apps → Attendance App
2. Tap Permissions → Location
3. Select "Allow all the time" (Android) or "Always" (iOS)
4. Enable "Use precise location" if available
5. Restart the Attendance app
6. If indoors, move near a window or step outside briefly

**If issue persists:** Check if phone's GPS works in Google Maps. If Maps also fails, this is a device issue, not an app issue.

### Problem: Check-in location shows wrong address
**Symptoms:** GPS works but recorded location is incorrect by several meters
**Common Causes:** GPS drift, cached old location, poor satellite visibility

**Solution Steps:**
1. Close the Attendance app completely
2. Open Google Maps, wait for blue dot to stabilize
3. Walk around briefly to refresh GPS
4. Return to Attendance app and try again
5. Ensure you're not in a basement or surrounded by tall buildings

## Login Issues

### Problem: "Invalid credentials" error
**Symptoms:** Cannot login despite correct password
**Common Causes:** Caps lock, expired password, account locked

**Solution Steps:**
1. Verify Caps Lock is off
2. Try logging into the web portal to confirm password works
3. If password was recently changed, use the new password
4. After 5 failed attempts, account locks for 15 minutes - wait and retry
5. Contact IT if still unable to login after 30 minutes

### Problem: "Session expired" keeps appearing
**Symptoms:** Logged out frequently, need to re-login multiple times per day
**Common Causes:** App running in background is being killed, unstable internet

**Solution Steps:**
1. Disable battery optimization for Attendance app
2. Settings → Apps → Attendance → Battery → Don't optimize
3. Ensure stable internet connection when using the app
