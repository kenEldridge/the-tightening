# Phase 0 Validation Testing Guide

## Prerequisites

### Hardware Requirements
1. **MIDI Device**: Akai Mini or compatible MIDI controller connected via USB
2. **Audio**: Working system audio output (speakers or headphones)
3. **Computer**: Sufficient resources for Electron app and audio processing

### Software Requirements
- Node.js installed (check with `node --version`)
- All dependencies installed (`npm install` completed)
- Modern browser engine (Chromium-based for Web MIDI API)

## Running the Application

### Method 1: Concurrent (Recommended)
Start both Vite dev server and Electron app together:
```bash
npm run dev:full
```

### Method 2: Separate Terminals
**Terminal 1** - Start Vite dev server:
```bash
npm run dev
```

**Terminal 2** - Wait for "ready in Xms" message, then start Electron:
```bash
npm run electron:dev
```

### Expected Startup
- Vite dev server starts on `http://localhost:5173`
- Electron window opens automatically
- DevTools open in the Electron window
- Phase 0 validation UI loads

## Test Procedures

### Test 1: MIDI Latency (<20ms target)

**Steps:**
1. Wait for application to fully load
2. Check MIDI status indicator at top of window
3. Expected: "Connected: [Your MIDI Device Name]"
4. If not connected, see Troubleshooting section below

**Testing:**
1. Press keys on your MIDI keyboard
2. Observe MIDI event logs appearing in real-time
3. Each log shows: Note name, octave, MIDI number, velocity, and latency in brackets `[X.XXms]`
4. Play at least 50 notes (multiple times across keyboard)
5. Check the "Average MIDI Latency" value displayed

**Success Criteria:**
- ✅ Average latency < 20ms
- Green checkmark appears next to metric
- No dropped events (all key presses logged)
- Latency is consistent (not spiking)

**Troubleshooting:**
- **"No MIDI devices found"**:
  - Ensure MIDI device is connected and powered on
  - Refresh page with Ctrl+R (or Cmd+R on Mac)
  - Try reconnecting USB cable
  - Check Windows Device Manager / Mac Audio MIDI Setup

- **High latency (>20ms)**:
  - Close other audio applications
  - Check USB connection (use USB 2.0 port, not hub if possible)
  - Restart application
  - Check system audio settings for exclusive mode

- **No response to key presses**:
  - Check MIDI permissions in browser/OS
  - Verify device is sending MIDI (test in another MIDI app)
  - Refresh application

### Test 2: Audio Latency (<50ms target)

**Steps:**
1. Click the "Initialize Audio & Play Test Note" button
2. Listen for a C4 test note to play
3. Observe the status message change to "Audio ready - Latency: X.XXms"
4. Press MIDI keys - you should now hear synthesized notes

**Testing:**
1. Play various notes on MIDI keyboard
2. Listen for audio response
3. Verify audio plays in sync with key presses
4. Check the displayed audio latency value

**Success Criteria:**
- ✅ Audio latency < 50ms
- Green checkmark appears next to metric
- Notes play immediately when keys pressed
- No audio glitches, clicks, or pops
- Perceived timing feels responsive

**Troubleshooting:**
- **No sound**:
  - Check system volume
  - Verify audio output device is correct
  - Check browser audio permissions
  - Try clicking "Initialize Audio" button again

- **"Audio Error"**:
  - Refresh page and try again
  - Check no other apps are using exclusive audio mode
  - Verify audio device is working (test with other app)

- **High latency (>50ms)**:
  - **Windows**: Use ASIO drivers if available (check audio interface settings)
  - **Mac**: Core Audio should be low latency by default
  - **Linux**: Use JACK or PipeWire with low-latency settings
  - Close other audio applications
  - Reduce audio buffer size in system settings

- **Audio glitches/clicks**:
  - Increase audio buffer size slightly (trade-off: higher latency)
  - Close background applications
  - Check CPU usage isn't maxed out

### Test 3: Rendering Performance (60fps target)

**Steps:**
1. Observe the blue rectangle falling continuously on the canvas
2. Watch the FPS counter (updates every second)
3. Monitor for at least 30 seconds
4. Note minimum and average FPS values

**Testing:**
1. Let animation run while performing other tests
2. Play MIDI notes while watching FPS
3. Play audio while watching FPS
4. Verify FPS remains stable during all operations

**Success Criteria:**
- ✅ FPS reads 60 (may occasionally drop to 59)
- Average FPS ≥ 55 over 60 seconds
- Green checkmark appears next to metric
- Animation is smooth with no visible stuttering
- FPS doesn't drop during MIDI/audio activity

**Troubleshooting:**
- **Low FPS (<55)**:
  - Close other GPU-intensive applications
  - Check GPU acceleration enabled in browser
  - Update graphics drivers
  - Check CPU usage in Task Manager/Activity Monitor
  - Close unnecessary browser tabs/windows

- **Stuttering animation**:
  - Check for background processes using CPU/GPU
  - Try closing DevTools (F12) to free resources
  - Restart application

- **FPS drops during MIDI input**:
  - This indicates MIDI processing overhead
  - Normal for occasional small drops
  - Consistent drops below 55fps indicate issue

## Integration Testing

### Combined Performance Test
Once all three individual tests pass:

1. Initialize audio (click button)
2. Start playing MIDI notes continuously
3. Observe all three metrics simultaneously:
   - MIDI latency stays <20ms
   - Audio plays without lag
   - FPS stays ≥55
4. Continue for 5 minutes minimum
5. All metrics should remain within targets

**Success Criteria:**
- All three checkmarks remain green
- No crashes or errors
- No memory leaks (check DevTools Memory tab)
- Performance stays stable over time

## Data Collection

### Recording Test Results

Create a test log:
```
Date: YYYY-MM-DD
Time: HH:MM
System Specs:
  - OS: [e.g., Windows 11, macOS 14, Ubuntu 24.04]
  - CPU: [e.g., Intel i7-10700K]
  - RAM: [e.g., 16GB DDR4]
  - GPU: [e.g., NVIDIA GTX 1660]
  - Audio Interface: [e.g., Focusrite Scarlett 2i2, Built-in]

MIDI Device: [e.g., Akai MPK Mini MK3]

Test Results:
--------------
MIDI Latency Test:
  Average: X.XX ms
  Min: X.XX ms
  Max: X.XX ms
  Sample Size: XX events
  Result: PASS / FAIL

Audio Latency Test:
  Measured: X.XX ms
  Audio glitches: Yes / No
  Result: PASS / FAIL

Rendering Test:
  Average FPS: XX
  Min FPS: XX
  Duration: XX seconds
  Result: PASS / FAIL

Integration Test:
  Duration: X minutes
  Stability: Stable / Unstable
  Result: PASS / FAIL

Overall Phase 0 Result: PASS / FAIL

Notes:
[Any observations, issues, or anomalies]
```

### Performance Monitoring (Optional)

Use DevTools for detailed analysis:
1. Open DevTools (F12)
2. Go to Performance tab
3. Click Record
4. Perform all tests
5. Stop recording
6. Analyze:
   - Frame rate timeline
   - Audio callback timing
   - JavaScript execution time
   - Memory usage

## Platform-Specific Optimization

### Windows
- **Audio Drivers**: Install ASIO drivers (ASIO4ALL if no dedicated interface)
- **Audio Settings**:
  - Control Panel → Sound → Properties → Advanced
  - Disable all audio enhancements
  - Set default format to 44.1kHz or 48kHz, 16-bit
- **Buffer Size**: In audio driver settings, set to 128-256 samples
- **Power Plan**: Use "High Performance" power plan

### macOS
- **Core Audio**: Usually optimized by default
- **Sample Rate**: Check Audio MIDI Setup app
  - Ensure sample rate matches device (44.1kHz or 48kHz)
  - Don't mix rates across applications
- **Background Apps**: Close Audio MIDI Setup during testing
- **Permissions**: Grant MIDI and audio permissions when prompted

### Linux
- **Audio System**: Use JACK or PipeWire
- **Real-time Priority**:
  ```bash
  sudo usermod -a -G audio $USER
  # Add to /etc/security/limits.conf:
  # @audio - rtprio 95
  # @audio - memlock unlimited
  ```
- **Low-latency Kernel**: Consider installing (e.g., `linux-lowlatency` on Ubuntu)
- **JACK Settings**:
  - Sample rate: 44.1kHz or 48kHz
  - Buffer size: 128-256 frames
  - Periods: 2-3

## Known Issues

1. **First audio initialization may fail**
   - Solution: Click "Initialize Audio" button again
   - Cause: Browser security requires user gesture

2. **MIDI timing varies by OS**
   - Windows typically 5-15ms higher than Mac
   - Linux depends on ALSA/JACK configuration

3. **USB MIDI vs 5-pin MIDI**
   - USB generally has lower latency
   - 5-pin through interface adds ~1-3ms

4. **Background tasks affect performance**
   - Antivirus scans
   - System updates
   - Cloud sync services
   - Solution: Schedule testing during quiet times

5. **High-DPI displays may show lower FPS**
   - Canvas not optimized for devicePixelRatio
   - May show 55-58fps instead of 60
   - Still acceptable if stable

## Success Criteria Summary

Phase 0 validation **PASSES** when:
- ✅ MIDI average latency < 20ms (sustained over 50+ events)
- ✅ Audio latency < 50ms (consistent measurement)
- ✅ FPS ≥ 55 (sustained for 60+ seconds)
- ✅ All three metrics achieved simultaneously
- ✅ No crashes during 5-minute test session
- ✅ Performance stable and reproducible

Phase 0 validation **FAILS** when:
- ❌ Any metric consistently exceeds threshold
- ❌ Frequent crashes or errors
- ❌ MIDI device not detected
- ❌ Audio doesn't play or has severe glitches
- ❌ Rendering stutters or freezes
- ❌ Metrics degrade over time (memory leaks)

## Next Steps

### If Validation Passes
1. Document exact system configuration
2. Record baseline performance metrics
3. Take screenshots of success dashboard
4. Note any system optimizations required
5. Proceed to Phase 1 feature development planning

### If Validation Fails
1. Document which specific metric(s) failed
2. Identify bottleneck (MIDI, audio, or rendering)
3. Try platform-specific optimizations
4. Test with different hardware if available
5. Consider adjusting target thresholds or minimum requirements
6. For persistent issues:
   - Review alternative libraries
   - Consider architectural changes
   - Evaluate hardware requirements

## Support

For issues not covered in this guide:
- Check DevTools Console for error messages
- Review application logs
- Test with minimal system load
- Try different MIDI devices if available
- Document exact steps to reproduce issue
