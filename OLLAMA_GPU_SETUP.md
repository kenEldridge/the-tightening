# Ollama GPU Server Setup (Windows PC with NVIDIA RTX 2060)

This guide configures a Windows PC with an NVIDIA GPU to run Ollama with llava for fast sheet music OCR. This PC serves as a local GPU inference server that the main development machine connects to over the network.

## Hardware Profile

| Component | Spec | Notes |
|-----------|------|-------|
| RAM | 32GB | More than enough for llava (needs ~5GB) |
| GPU | NVIDIA RTX 2060 | 6GB VRAM - llava runs mostly on GPU |
| Storage | C: low (SSD), D:/E: have TB (HDD) | Models go to D: |
| Network | Same LAN as dev machine | Direct connection |

## Setup Instructions

Run all commands in **PowerShell as Administrator** (not WSL).

### Phase 1: Verify GPU

```powershell
nvidia-smi
```

Should show RTX 2060 with driver info. If this fails, install NVIDIA drivers first.

### Phase 2: Prepare Storage (D: drive)

```powershell
mkdir D:\ollama
mkdir D:\ollama\models
```

### Phase 3: Set Environment Variables (BEFORE installing Ollama)

```powershell
# Models stored on D: drive (not C:)
[System.Environment]::SetEnvironmentVariable("OLLAMA_MODELS", "D:\ollama\models", "Machine")

# Allow network access from other PCs
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "Machine")
```

**Important:** Close and reopen PowerShell after setting these for them to take effect.

### Phase 4: Install Ollama

1. Download from https://ollama.com/download/windows
2. Run installer (installs to AppData, but models will go to D: due to env var)

### Phase 5: Pull llava Model

```powershell
ollama pull llava
```

Downloads ~4.7GB to D:\ollama\models. First load takes 30-60 seconds from HDD, then cached in VRAM.

### Phase 6: Configure Windows Firewall

```powershell
New-NetFirewallRule -DisplayName "Ollama" -Direction Inbound -Port 11434 -Protocol TCP -Action Allow
```

### Phase 7: Get This PC's IP Address

```powershell
ipconfig | findstr "IPv4"
```

Note the IP (e.g., 192.168.1.x or 10.0.0.x) - you'll need this for the dev machine.

## Verification Checklist

Run these to confirm everything works:

```powershell
# Check Ollama version
ollama --version

# List models (should show llava)
ollama list

# Test llava loads (first time slow, then fast)
ollama run llava "describe this image" --verbose
# (Ctrl+D to exit)

# Check GPU memory usage while model is loaded
nvidia-smi
```

## Testing from Dev Machine

From your main development machine (WSL or terminal):

```bash
# Replace with GPU PC's IP address
curl http://192.168.x.x:11434/api/version

# Should return: {"version":"x.x.x"}
```

## Configuring the-tightening

On your dev machine, set the Ollama URL to point to the GPU PC:

```bash
export OLLAMA_API_URL=http://192.168.x.x:11434
```

Or update `src/core/SheetMusicOCR.ts` to use the GPU PC's IP.

## Expected Performance

| Metric | CPU (Azure) | GPU (RTX 2060) |
|--------|-------------|----------------|
| llava inference | 3+ minutes | 10-30 seconds |
| VRAM usage | 0 | ~4-5GB |
| Cost | $0.20/hr | $0 (your hardware) |

## Troubleshooting

**"ollama" not recognized:**
- Close and reopen PowerShell
- Check `where.exe ollama`
- Reinstall if needed

**Model not using GPU:**
- Run `nvidia-smi` while model is loaded
- Should show ollama process using GPU memory
- If not, check NVIDIA drivers

**Can't connect from dev machine:**
- Check firewall rule was created: `Get-NetFirewallRule -DisplayName "Ollama"`
- Verify OLLAMA_HOST is set: `[System.Environment]::GetEnvironmentVariable("OLLAMA_HOST", "Machine")`
- Both PCs on same network/subnet?

**C: drive filling up:**
- Verify OLLAMA_MODELS points to D: before pulling models
- Delete and re-pull if models went to wrong location

## Notes

- Ollama auto-starts at boot and stays running
- Model stays in VRAM for ~5 min of inactivity, then unloads
- First inference after unload takes 30-60s to reload from HDD
- Subsequent inferences are fast while model is loaded
