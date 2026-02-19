## Summary

We need to completely rethink the video import  segment creation UX. The current flow is confusing and brittle; key user needs are: select a segment, run video analysis for that segment, save it, and then immediately go to the practice page for the selected segment.

We also hit a runtime error when attempting a YouTube import (see Reproduction / Logs below). We haven't run this recently  the downloader/network may also be a problem, but the UX should be redesigned to be robust and provide clearer feedback and recovery steps.

## Desired Flow

1. Paste YouTube (or local) video URL / upload file.
2. Display the video with a simple segment-selection UI (start / end handles + preview).
3. User selects segment and clicks **Analyze Segment**.
4. Run video analysis for only that segment (OCR, frame extraction, pitch detection). Show progress and estimated time.
5. When analysis finishes, save the segment as a named practice segment (metadata + derived note timings).
6. Offer a button **Practice Segment** that navigates directly to the practice page with the selected segment loaded.

## Pain Points

- The current import + segment creation flow is unclear and multi-step.
- There's poor feedback while downloads/analysis run; failures are opaque.
- No clear way to re-run analysis for a segment or to retry failed downloads.
- After saving a segment, users should be taken immediately to the practice page for that segment  currently they may get lost.

## Reproduction / Error Log

I attempted to import a YouTube video and got this error when extracting audio (yt-dlp stage):

```
Error invoking remote method 'youtube-extract-audio': Error: Error code: 1 Stderr: ERROR: [download] Got error: HTTPSConnection(host='rr4---sn-5ualdnle.googlevideo.com', port=443): Failed to resolve 'rr4---sn-5ualdnle.googlevideo.com' ([Errno 11004] getaddrinfo failed). Giving up after 10 retries
```

Notes: this looks like a DNS/network resolution failure contacting a googlevideo host. It may be transient or related to environment/network settings. The app should detect and surface this clearly to the user and offer retry options or a fallback (e.g., different downloader settings, prompting user to download video manually).

## Acceptance Criteria

- New import UI that supports segment selection before any heavy processing.
- `Analyze Segment` action that runs analysis only for the selected time range and shows progress + errors.
- Save action that stores segment metadata and derived data in the project data store.
- A direct navigation path from a saved segment to the practice view with that segment loaded.
- Better error handling and user-visible messages for download/network failures, with retry and fallback options.

## Suggestions / Implementation Notes

- Use a simple scrubber with draggable start/end handles for selecting segments.
- Run frame extraction & OCR only for the chosen segment to reduce API usage and speed up iteration.
- On YouTube errors, capture and show the raw downloader error and suggest steps (check network, retry, or paste a direct video file).
- Add a small `import` / `segments` table in the UI showing saved segments and a quick "Practice" button next to each.

## Environment / Context

- Happened while running the app locally (haven't run recently).
- Error occurred during `youtube-extract-audio` (yt-dlp stage)  possibly transient DNS or network issue.

---

Please review and reassign as needed. This needs UX design + frontend work, plus some robustness fixes around the downloader and error surfacing.
